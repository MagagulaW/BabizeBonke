import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { canAccessRestaurant, requireAuth } from '../middleware/auth.js';
import { fail, ok } from '../utils/http.js';

const router = Router();
router.use(requireAuth);

function currentUserId(req: Request) {
  const id = req.user?.userId;
  if (!id) throw new Error('Missing user');
  return id;
}

router.get('/summary', async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  const roles = req.user?.roles || [];
  const isDriver = roles.includes('driver');
  const restaurantId = req.query.restaurantId ? String(req.query.restaurantId) : req.user?.restaurantIds?.[0];

  const payload: Record<string, unknown> = {};

  if (isDriver) {
    const available = await pool.query(`
      SELECT COALESCE(SUM(d.driver_payout_estimate),0)::numeric(12,2) - COALESCE((
        SELECT SUM(amount) FROM payouts p WHERE p.party_type = 'driver' AND p.party_id = $1 AND p.status IN ('pending','approved','processing','paid')
      ),0)::numeric(12,2) AS available_balance,
      COALESCE(SUM(d.driver_payout_estimate),0)::numeric(12,2) AS gross_earnings
      FROM deliveries d
      WHERE d.current_driver_user_id = $1 AND d.status = 'delivered'
    `, [userId]);
    payload.driver = available.rows[0];
  }

  if (restaurantId && canAccessRestaurant(req, restaurantId)) {
    const available = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN o.total_amount * ((100 - LEAST(GREATEST(r.commission_rate, 10), 15)) / 100.0) ELSE 0 END),0)::numeric(12,2) AS available_balance,
        COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN o.total_amount * (LEAST(GREATEST(r.commission_rate, 10), 15) / 100.0) ELSE 0 END),0)::numeric(12,2) AS app_commission_accrued,
        LEAST(GREATEST(r.commission_rate, 10), 15)::numeric(5,2) AS applied_commission_rate
      FROM restaurants r
      LEFT JOIN orders o ON o.restaurant_id = r.id
      WHERE r.id = $1
      GROUP BY r.commission_rate
    `, [restaurantId]);
    const payouts = await pool.query(`SELECT COALESCE(SUM(amount),0)::numeric(12,2) AS requested_or_paid FROM payouts WHERE party_type = 'restaurant' AND party_id = $1 AND status IN ('pending','approved','processing','paid')`, [restaurantId]);
    const row = available.rows[0] || { available_balance: '0.00', app_commission_accrued: '0.00', applied_commission_rate: '15.00' };
    payload.restaurant = {
      ...row,
      available_balance: (Number(row.available_balance || 0) - Number(payouts.rows[0]?.requested_or_paid || 0)).toFixed(2)
    };
  }

  const app = await pool.query(`
    SELECT 
      COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN o.total_amount ELSE 0 END),0)::numeric(12,2) AS gross_collected,
      COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN o.total_amount * (LEAST(GREATEST(r.commission_rate, 10), 15) / 100.0) ELSE 0 END),0)::numeric(12,2) AS commission_retained,
      COALESCE(SUM(CASE WHEN d.status = 'delivered' THEN d.driver_payout_estimate ELSE 0 END),0)::numeric(12,2) AS driver_obligations
    FROM orders o
    JOIN restaurants r ON r.id = o.restaurant_id
    LEFT JOIN deliveries d ON d.order_id = o.id
  `);
  payload.app = app.rows[0];

  return ok(res, payload);
});

router.get('/bank-accounts', async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  const restaurantId = req.query.restaurantId ? String(req.query.restaurantId) : undefined;
  let holderType: 'user' | 'restaurant' = 'user';
  let holderId = userId;
  if (restaurantId && canAccessRestaurant(req, restaurantId)) {
    holderType = 'restaurant';
    holderId = restaurantId;
  }
  const result = await pool.query(`SELECT id, holder_type, holder_id, account_name, bank_name, account_number_masked, branch_code, account_type, is_primary, is_active FROM bank_accounts WHERE holder_type = $1 AND holder_id = $2 ORDER BY is_primary DESC, created_at DESC`, [holderType, holderId]);
  return ok(res, result.rows);
});

router.post('/bank-accounts', async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  const parsed = z.object({
    holderScope: z.enum(['driver','restaurant']).default('driver'),
    restaurantId: z.string().uuid().optional().nullable(),
    accountName: z.string().min(2),
    bankName: z.string().min(2),
    accountNumber: z.string().min(6).max(30),
    branchCode: z.string().max(20).optional().nullable(),
    accountType: z.string().max(40).optional().nullable(),
    isPrimary: z.boolean().default(true)
  }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message || 'Invalid bank account');
  const d = parsed.data;
  const holderType = d.holderScope === 'restaurant' ? 'restaurant' : 'user';
  const holderId = holderType === 'restaurant' ? d.restaurantId : userId;
  if (holderType === 'restaurant') {
    if (!holderId || !canAccessRestaurant(req, holderId)) return fail(res, 403, 'Forbidden');
  }
  const masked = `${'*'.repeat(Math.max(0, d.accountNumber.length - 4))}${d.accountNumber.slice(-4)}`;
  const result = await pool.query(`
    INSERT INTO bank_accounts (holder_type, holder_id, account_name, bank_name, account_number_masked, branch_code, account_type, provider_token, is_primary)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id, holder_type, holder_id, account_name, bank_name, account_number_masked, branch_code, account_type, is_primary, is_active
  `, [holderType, holderId, d.accountName, d.bankName, masked, d.branchCode ?? null, d.accountType ?? null, `manual:${holderType}:${holderId}:${Date.now()}`, d.isPrimary]);
  return ok(res, result.rows[0], 'Bank account saved');
});


router.get('/history', async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  const roles = req.user?.roles || [];
  const partyType = String(req.query.partyType || (roles.includes('driver') ? 'driver' : 'restaurant'));
  const restaurantId = req.query.restaurantId ? String(req.query.restaurantId) : req.user?.restaurantIds?.[0];
  const partyId = partyType === 'restaurant' ? restaurantId : userId;
  if (partyType === 'restaurant' && (!partyId || !canAccessRestaurant(req, partyId))) return fail(res, 403, 'Forbidden');
  const result = await pool.query(`
    SELECT p.id, p.party_type, p.party_id, p.amount, p.currency, p.status, p.reference, p.created_at, p.updated_at, p.paid_at,
           ba.account_name, ba.bank_name, ba.account_number_masked,
           approver.full_name AS approved_by_name
    FROM payouts p
    LEFT JOIN bank_accounts ba ON ba.id = p.bank_account_id
    LEFT JOIN users approver ON approver.id = p.approved_by_user_id
    WHERE p.party_type = $1 AND p.party_id = $2
    ORDER BY p.created_at DESC
    LIMIT 100
  `, [partyType, partyId]);
  return ok(res, result.rows);
});

router.post('/request', async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  const parsed = z.object({
    partyType: z.enum(['driver','restaurant']),
    restaurantId: z.string().uuid().optional().nullable(),
    amount: z.number().positive(),
    bankAccountId: z.string().uuid().optional().nullable(),
    reference: z.string().max(120).optional().nullable()
  }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message || 'Invalid payout request');
  const d = parsed.data;
  const partyId = d.partyType === 'driver' ? userId : d.restaurantId;
  if (d.partyType === 'restaurant' && (!partyId || !canAccessRestaurant(req, partyId))) return fail(res, 403, 'Forbidden');

  const roles = req.user?.roles || [];
  let available = 0;
  if (d.partyType === 'driver' && roles.includes('driver')) {
    const row = (await pool.query(`SELECT COALESCE(SUM(d.driver_payout_estimate),0)::numeric(12,2) - COALESCE((SELECT SUM(amount) FROM payouts p WHERE p.party_type = 'driver' AND p.party_id = $1 AND p.status IN ('pending','approved','processing','paid')),0)::numeric(12,2) AS available FROM deliveries d WHERE d.current_driver_user_id = $1 AND d.status = 'delivered'`, [userId])).rows[0];
    available = Number(row?.available || 0);
  } else if (d.partyType === 'restaurant' && partyId) {
    const row = (await pool.query(`SELECT COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN o.total_amount * ((100 - LEAST(GREATEST(r.commission_rate, 10), 15)) / 100.0) ELSE 0 END),0)::numeric(12,2) - COALESCE((SELECT SUM(amount) FROM payouts p WHERE p.party_type = 'restaurant' AND p.party_id = $1 AND p.status IN ('pending','approved','processing','paid')),0)::numeric(12,2) AS available FROM restaurants r LEFT JOIN orders o ON o.restaurant_id = r.id WHERE r.id = $1 GROUP BY r.commission_rate`, [partyId])).rows[0];
    available = Number(row?.available || 0);
  }
  if (d.amount > available) return fail(res, 400, 'Requested amount exceeds available balance');

  let bankAccountId = d.bankAccountId ?? null;
  if (!bankAccountId) {
    const primaryAccount = await pool.query(`SELECT id FROM bank_accounts WHERE holder_type = $1 AND holder_id = $2 AND is_primary = true AND is_active = true ORDER BY updated_at DESC LIMIT 1`, [d.partyType === 'restaurant' ? 'restaurant' : 'user', partyId]);
    bankAccountId = primaryAccount.rows[0]?.id ?? null;
  }
  if (!bankAccountId) return fail(res, 400, 'Add a payout bank account before requesting a payout');

  const bankAccountCheck = await pool.query(`SELECT id FROM bank_accounts WHERE id = $1 AND holder_type = $2 AND holder_id = $3 AND is_active = true LIMIT 1`, [bankAccountId, d.partyType === 'restaurant' ? 'restaurant' : 'user', partyId]);
  if (!bankAccountCheck.rows[0]) return fail(res, 400, 'Selected payout bank account is invalid');

  const existingPending = await pool.query(`SELECT id FROM payouts WHERE party_type = $1 AND party_id = $2 AND status IN ('pending','approved','processing') LIMIT 1`, [d.partyType, partyId]);
  if (existingPending.rows[0]) return fail(res, 400, 'You already have a payout request awaiting completion');

  const result = await pool.query(`INSERT INTO payouts (party_type, party_id, bank_account_id, amount, reference, status) VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING *`, [d.partyType, partyId, bankAccountId, d.amount, d.reference ?? null]);
  return ok(res, result.rows[0], 'Payout request submitted');
});

export default router;
