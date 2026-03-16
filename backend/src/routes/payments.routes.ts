import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { fail, ok } from '../utils/http.js';
import { env } from '../config/env.js';

const router = Router();
router.use(requireAuth);

function currentUser(req: any) {
  const id = req.user?.userId;
  if (!id) throw new Error('Unauthorized');
  return id as string;
}

router.get('/config', async (_req, res) => {
  return ok(res, {
    provider: env.paymentProvider,
    publishableKey: env.paymentPublishableKey,
    currency: 'ZAR'
  });
});

router.get('/methods/available', async (_req, res) => {
  return ok(res, {
    currency: 'ZAR',
    methods: [
      { code: 'card', label: 'Card', description: 'Pay now with card via secure checkout', requiresOnlineFlow: true },
      { code: 'saved_card', label: 'Saved Card', description: 'Use a saved card for faster checkout', requiresOnlineFlow: true },
      { code: 'cash_on_delivery', label: 'Cash on Delivery', description: 'Pay cash when your order arrives', requiresOnlineFlow: false },
      { code: 'eft_bank_transfer', label: 'EFT / Bank Transfer', description: 'Pay by bank transfer and confirm manually', requiresOnlineFlow: false }
    ]
  });
});

router.get('/methods/saved', async (req, res) => {
  const result = await pool.query(
    `SELECT id, method_type, provider, brand, last4, expires_month, expires_year, is_default, is_active, created_at
     FROM payment_methods
     WHERE user_id = $1 AND method_type = 'card' AND is_active = true
     ORDER BY is_default DESC, created_at DESC`,
    [currentUser(req)]
  );
  return ok(res, result.rows);
});

router.post('/methods/saved/card', async (req, res) => {
  const parsed = z.object({
    provider: z.string().default('manual_card_vault'),
    brand: z.string().min(2).max(40),
    last4: z.string().regex(/^\d{4}$/),
    expiresMonth: z.number().int().min(1).max(12),
    expiresYear: z.number().int().min(new Date().getFullYear()).max(2100),
    providerCustomerReference: z.string().optional().nullable(),
    providerPaymentMethodReference: z.string().optional().nullable(),
    isDefault: z.boolean().default(false)
  }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message || 'Invalid card');
  const d = parsed.data;
  const userId = currentUser(req);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (d.isDefault) await client.query(`UPDATE payment_methods SET is_default = false, updated_at = now() WHERE user_id = $1`, [userId]);
    const result = await client.query(
      `INSERT INTO payment_methods (
        user_id, method_type, provider, provider_customer_reference, provider_payment_method_reference,
        last4, brand, expires_month, expires_year, is_default, is_active
      ) VALUES ($1, 'card', $2, $3, $4, $5, $6, $7, $8, $9, true)
      RETURNING id, method_type, provider, brand, last4, expires_month, expires_year, is_default, is_active, created_at`,
      [userId, d.provider, d.providerCustomerReference ?? null, d.providerPaymentMethodReference ?? null, d.last4, d.brand, d.expiresMonth, d.expiresYear, d.isDefault]
    );
    await client.query('COMMIT');
    return ok(res, result.rows[0], 'Saved card added');
  } catch (error) {
    await client.query('ROLLBACK');
    return fail(res, 400, error instanceof Error ? error.message : 'Failed to save card');
  } finally {
    client.release();
  }
});

router.patch('/methods/saved/:paymentMethodId/default', async (req, res) => {
  const userId = currentUser(req);
  const paymentMethodId = String(req.params.paymentMethodId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(`SELECT id FROM payment_methods WHERE id = $1 AND user_id = $2 AND is_active = true LIMIT 1`, [paymentMethodId, userId]);
    if (!found.rows[0]) throw new Error('Saved card not found');
    await client.query(`UPDATE payment_methods SET is_default = false, updated_at = now() WHERE user_id = $1`, [userId]);
    await client.query(`UPDATE payment_methods SET is_default = true, updated_at = now() WHERE id = $1`, [paymentMethodId]);
    await client.query('COMMIT');
    return ok(res, true, 'Default saved card updated');
  } catch (error) {
    await client.query('ROLLBACK');
    return fail(res, 400, error instanceof Error ? error.message : 'Failed to update default card');
  } finally {
    client.release();
  }
});

router.delete('/methods/saved/:paymentMethodId', async (req, res) => {
  const paymentMethodId = String(req.params.paymentMethodId);
  const result = await pool.query(`UPDATE payment_methods SET is_active = false, is_default = false, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id`, [paymentMethodId, currentUser(req)]);
  if (!result.rows[0]) return fail(res, 404, 'Saved card not found');
  return ok(res, true, 'Saved card removed');
});

router.post('/checkout/session', async (req, res) => {
  const parsed = z.object({
    orderId: z.string().uuid(),
    paymentMethod: z.enum(['card', 'saved_card', 'cash_on_delivery', 'eft_bank_transfer']).default('card'),
    paymentMethodId: z.string().uuid().optional().nullable()
  }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid order');
  const orderRes = await pool.query(`SELECT id, customer_user_id, total_amount, currency FROM orders WHERE id = $1 LIMIT 1`, [parsed.data.orderId]);
  const order = orderRes.rows[0];
  if (!order) return fail(res, 404, 'Order not found');
  if (order.customer_user_id !== req.user?.userId) return fail(res, 403, 'Forbidden');

  let paymentMethodId: string | null = null;
  let provider = env.paymentProvider;
  if (parsed.data.paymentMethod === 'saved_card') {
    if (!parsed.data.paymentMethodId) return fail(res, 400, 'Saved card is required');
    const pm = await pool.query(`SELECT id FROM payment_methods WHERE id = $1 AND user_id = $2 AND is_active = true LIMIT 1`, [parsed.data.paymentMethodId, currentUser(req)]);
    if (!pm.rows[0]) return fail(res, 404, 'Saved card not found');
    paymentMethodId = pm.rows[0].id;
    provider = 'saved_card';
  } else if (parsed.data.paymentMethod === 'cash_on_delivery') {
    provider = 'cash_on_delivery';
  } else if (parsed.data.paymentMethod === 'eft_bank_transfer') {
    provider = 'eft_bank_transfer';
  }

  const paymentRes = await pool.query(
    `INSERT INTO payments (order_id, payment_method_id, provider, amount, currency, status)
     VALUES ($1, $2, $3, $4, $5, $6::payment_status) RETURNING *`,
    [order.id, paymentMethodId, provider, order.total_amount, order.currency, parsed.data.paymentMethod === 'cash_on_delivery' ? 'initiated' : 'initiated']
  );
  const payment = paymentRes.rows[0];
  await pool.query(
    `INSERT INTO payment_attempts (payment_id, attempt_no, provider, amount, status, request_payload)
     VALUES ($1, 1, $2, $3, 'pending', $4::jsonb)`,
    [payment.id, provider, order.total_amount, JSON.stringify({ orderId: order.id, mode: parsed.data.paymentMethod })]
  );

  return ok(res, {
    paymentId: payment.id,
    provider,
    amount: payment.amount,
    currency: payment.currency,
    clientSecret: provider === 'cash_on_delivery' || provider === 'eft_bank_transfer' ? null : `demo_${payment.id}`,
    nextActionUrl: provider === 'card' ? (env.paymentCheckoutBaseUrl ? `${env.paymentCheckoutBaseUrl}?payment_id=${payment.id}` : null) : null,
    instructions: provider === 'cash_on_delivery'
      ? 'Collect cash from the customer on delivery.'
      : provider === 'eft_bank_transfer'
        ? 'Customer must transfer payment and then confirm the bank reference.'
        : null
  }, 'Payment session created');
});

router.post('/payments/:paymentId/confirm', async (req, res) => {
  const paymentId = String(req.params.paymentId);
  const parsed = z.object({ providerReference: z.string().min(3).optional().nullable(), status: z.enum(['authorized','captured','failed']).default('captured') }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid payment confirmation');

  const paymentRes = await pool.query(
    `SELECT p.*, o.customer_user_id, o.id AS order_id FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = $1 LIMIT 1`,
    [paymentId]
  );
  const payment = paymentRes.rows[0];
  if (!payment) return fail(res, 404, 'Payment not found');
  if (payment.customer_user_id !== req.user?.userId && !(req.user?.roles || []).includes('platform_admin')) return fail(res, 403, 'Forbidden');

  const status = parsed.data.status;
  await pool.query(
    `UPDATE payments SET status = $2::payment_status, provider_payment_reference = COALESCE($3, provider_payment_reference), authorized_at = CASE WHEN $2::payment_status='authorized'::payment_status THEN now() ELSE authorized_at END, captured_at = CASE WHEN $2::payment_status='captured'::payment_status THEN now() ELSE captured_at END, failed_at = CASE WHEN $2::payment_status='failed'::payment_status THEN now() ELSE failed_at END, updated_at = now() WHERE id = $1`,
    [paymentId, status, parsed.data.providerReference ?? null]
  );
  await pool.query(
    `UPDATE payment_attempts SET status = $2, provider_attempt_reference = COALESCE($3, provider_attempt_reference), finished_at = now(), response_payload = $4::jsonb WHERE payment_id = $1 AND attempt_no = 1`,
    [paymentId, status === 'failed' ? 'failed' : 'succeeded', parsed.data.providerReference ?? null, JSON.stringify({ status })]
  );
  return ok(res, true, `Payment ${status}`);
});

export default router;
