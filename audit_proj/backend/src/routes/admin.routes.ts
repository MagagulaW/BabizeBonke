import { Request, Response, Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { ok, fail } from '../utils/http.js';

const router = Router();
const adminRoles = ['platform_admin', 'finance_admin', 'content_admin', 'support_admin'];
router.use(requireAuth, requireRoles(adminRoles));

router.get('/dashboard', async (_req: Request, res: Response) => {
  const [restaurants, users, orders, revenue, lowStock] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status='approved')::int AS approved,
      COUNT(*) FILTER (WHERE status='pending_review')::int AS pending
      FROM restaurants`),
    pool.query(`SELECT COUNT(*)::int AS total FROM users`),
    pool.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status='placed')::int AS placed,
      COUNT(*) FILTER (WHERE status='preparing')::int AS preparing,
      COUNT(*) FILTER (WHERE status='delivered')::int AS delivered
      FROM orders`),
    pool.query(`SELECT COALESCE(SUM(total_amount),0)::numeric(12,2) AS gross_revenue
      FROM orders WHERE status IN ('confirmed','preparing','ready_for_pickup','picked_up','out_for_delivery','delivered','placed')`),
    pool.query(`SELECT COUNT(*)::int AS low_stock FROM restaurant_inventory_items WHERE stock_quantity <= reorder_threshold`)
  ]);
  const activity = await pool.query(`
    SELECT 'Restaurant approved' AS event, display_name AS subject, created_at AS happened_at FROM restaurants
    UNION ALL
    SELECT 'Order placed' AS event, id::text AS subject, placed_at AS happened_at FROM orders
    ORDER BY happened_at DESC LIMIT 8
  `);
  return ok(res, { restaurants: restaurants.rows[0], users: users.rows[0], orders: orders.rows[0], revenue: revenue.rows[0], inventory: lowStock.rows[0], activity: activity.rows });
});

router.get('/restaurants', async (_req: Request, res: Response) => {
  const result = await pool.query(`
    SELECT r.id, r.display_name, r.legal_name, r.status, r.support_email, r.support_phone, r.commission_rate, r.is_active, r.created_at,
           rl.city, rl.province,
           (SELECT ma.file_url FROM media_assets ma WHERE ma.owner_type = 'restaurant' AND ma.owner_id = r.id AND ma.alt_text = 'logo' ORDER BY ma.created_at DESC LIMIT 1) AS logo_url,
           (SELECT ma.file_url FROM media_assets ma WHERE ma.owner_type = 'restaurant' AND ma.owner_id = r.id AND ma.alt_text = 'banner' ORDER BY ma.created_at DESC LIMIT 1) AS banner_url,
           COUNT(DISTINCT mi.id)::int AS menu_items,
           COUNT(DISTINCT o.id)::int AS orders
    FROM restaurants r
    LEFT JOIN restaurant_locations rl ON rl.restaurant_id = r.id AND rl.is_primary = true
    LEFT JOIN menu_items mi ON mi.restaurant_id = r.id
    LEFT JOIN orders o ON o.restaurant_id = r.id
    GROUP BY r.id, rl.city, rl.province
    ORDER BY r.created_at DESC
  `);
  return ok(res, result.rows);
});

router.patch('/restaurants/:id/status', async (req: Request, res: Response) => {
  const allowed = ['draft','pending_review','approved','rejected','suspended','closed'];
  const status = String(req.body?.status || '');
  if (!allowed.includes(status)) return fail(res, 400, 'Invalid restaurant status');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`UPDATE restaurants SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id, status]);
    if (!result.rowCount) { await client.query('ROLLBACK'); return fail(res, 404, 'Restaurant not found'); }
    if (status === 'approved') {
      await client.query(`UPDATE users u SET is_active = true, status = 'active'::account_status, updated_at = now() WHERE u.id IN (SELECT rm.user_id FROM restaurant_memberships rm WHERE rm.restaurant_id = $1)`, [req.params.id]);
      await client.query(`UPDATE restaurant_memberships SET status = 'active'::membership_status, updated_at = now() WHERE restaurant_id = $1`, [req.params.id]);
    }
    await client.query('COMMIT');
    return ok(res, result.rows[0], 'Restaurant status updated');
  } catch (error) {
    await client.query('ROLLBACK');
    return fail(res, 400, error instanceof Error ? error.message : 'Restaurant status update failed');
  } finally { client.release(); }
});

router.get('/drivers', async (_req: Request, res: Response) => {
  const result = await pool.query(`
    SELECT u.id, u.full_name, u.email, u.phone, u.is_active, dp.onboarding_status, dp.available_for_dispatch, dp.rating, dp.total_deliveries,
           dp.license_number, dp.license_expiry_date, dp.national_id_number, dp.emergency_contact_name, dp.emergency_contact_phone,
           dv.vehicle_type, dv.make, dv.model, dv.year, dv.color, dv.registration_number
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id AND ur.role_code = 'driver'
    LEFT JOIN driver_profiles dp ON dp.user_id = u.id
    LEFT JOIN driver_vehicles dv ON dv.driver_user_id = u.id AND dv.is_primary = true
    ORDER BY u.created_at DESC
  `);
  return ok(res, result.rows);
});

router.patch('/drivers/:id/status', async (req: Request, res: Response) => {
  const allowed = ['pending','approved','rejected','suspended'];
  const status = String(req.body?.status || '');
  if (!allowed.includes(status)) return fail(res, 400, 'Invalid driver status');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`UPDATE driver_profiles SET onboarding_status = $2, available_for_dispatch = CASE WHEN $2 = 'approved' THEN available_for_dispatch ELSE false END, updated_at = now() WHERE user_id = $1 RETURNING *`, [req.params.id, status]);
    if (!result.rowCount) { await client.query('ROLLBACK'); return fail(res, 404, 'Driver not found'); }
    await client.query(`UPDATE users SET is_active = $2, status = CASE WHEN $2 THEN 'active'::account_status ELSE status END, updated_at = now() WHERE id = $1`, [req.params.id, status === 'approved']);
    await client.query('COMMIT');
    return ok(res, result.rows[0], 'Driver status updated');
  } catch (error) {
    await client.query('ROLLBACK');
    return fail(res, 400, error instanceof Error ? error.message : 'Driver status update failed');
  } finally { client.release(); }
});

router.get('/customers', async (_req: Request, res: Response) => {
  const result = await pool.query(`
    SELECT u.id, u.full_name, u.email, cp.loyalty_points, cp.preferred_language, COUNT(DISTINCT o.id)::int AS orders
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id AND ur.role_code = 'customer'
    LEFT JOIN customer_profiles cp ON cp.user_id = u.id
    LEFT JOIN orders o ON o.customer_user_id = u.id
    GROUP BY u.id, cp.loyalty_points, cp.preferred_language
    ORDER BY u.created_at DESC
  `);
  return ok(res, result.rows);
});

router.get('/users', async (_req: Request, res: Response) => {
  const result = await pool.query(`
    SELECT u.id, u.full_name, u.email, u.phone, u.status, u.is_active, u.created_at,
           COALESCE(array_agg(ur.role_code) FILTER (WHERE ur.role_code IS NOT NULL), '{}') AS roles
    FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id
    GROUP BY u.id ORDER BY u.created_at DESC LIMIT 200
  `);
  return ok(res, result.rows);
});

router.get('/orders', async (_req: Request, res: Response) => {
  const result = await pool.query(`
    SELECT o.id, o.status, o.order_type, o.total_amount, o.currency, o.placed_at, c.full_name AS customer_name, r.display_name AS restaurant_name
    FROM orders o JOIN users c ON c.id = o.customer_user_id JOIN restaurants r ON r.id = o.restaurant_id
    ORDER BY o.placed_at DESC LIMIT 200
  `);
  return ok(res, result.rows);
});

export default router;
