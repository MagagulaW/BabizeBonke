import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { fail, ok } from '../utils/http.js';
import { emitToOrder, emitToUser, emitToRestaurant } from '../realtime.js';
import { sendPushNotification } from '../services/notifications.service.js';

const router = Router();
router.use(requireAuth, requireRoles(['driver', 'platform_admin']));

function driverUserId(req: Request) {
  const id = req.user?.userId;
  if (!id) throw new Error('Missing user');
  return id;
}

router.get('/dashboard', async (req: Request, res: Response) => {
  const userId = driverUserId(req);
  const [profile, deliveries, earnings, latestLocation] = await Promise.all([
    pool.query(`SELECT * FROM driver_profiles WHERE user_id = $1`, [userId]),
    pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status IN ('assigned','accepted','en_route_to_pickup','arrived_at_pickup','picked_up','en_route_to_dropoff','arrived_at_dropoff'))::int AS active,
             COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered
      FROM deliveries WHERE current_driver_user_id = $1
    `, [userId]),
    pool.query(`SELECT COALESCE(SUM(driver_payout_estimate),0)::numeric(12,2) AS total_earnings FROM deliveries WHERE current_driver_user_id = $1 AND status = 'delivered'`, [userId]),
    pool.query(`SELECT latitude, longitude, recorded_at FROM driver_location_history_default WHERE driver_user_id = $1 ORDER BY recorded_at DESC LIMIT 1`, [userId])
  ]);

  return ok(res, {
    profile: profile.rows[0] ?? null,
    deliveries: deliveries.rows[0],
    earnings: earnings.rows[0],
    latestLocation: latestLocation.rows[0] ?? null
  });
});

router.get('/deliveries', async (req: Request, res: Response) => {
  const userId = driverUserId(req);
  const result = await pool.query(`
    SELECT d.id, d.order_id, d.status, d.pickup_eta_mins, d.dropoff_eta_mins, d.driver_payout_estimate,
           o.status AS order_status, o.total_amount, o.order_type, o.special_instructions, o.placed_at,
           r.display_name AS restaurant_name,
           a.address_line1, a.city, a.province, a.delivery_instructions,
           CASE WHEN d.current_driver_user_id = $1 THEN true ELSE false END AS is_mine,
           CASE WHEN rl.location IS NOT NULL THEN CONCAT('https://www.google.com/maps/dir/?api=1&destination=', ST_Y(rl.location::geometry), ',', ST_X(rl.location::geometry), '&travelmode=driving') ELSE NULL END AS restaurant_nav_url,
           CASE WHEN a.location IS NOT NULL THEN CONCAT('https://www.google.com/maps/dir/?api=1&destination=', ST_Y(a.location::geometry), ',', ST_X(a.location::geometry), '&travelmode=driving') ELSE NULL END AS customer_nav_url
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    JOIN restaurants r ON r.id = o.restaurant_id
    LEFT JOIN user_addresses a ON a.id = o.delivery_address_id
    LEFT JOIN restaurant_locations rl ON rl.id = o.restaurant_location_id
    WHERE d.current_driver_user_id = $1
       OR d.status = 'awaiting_dispatch'
    ORDER BY d.created_at DESC
  `, [userId]);
  return ok(res, result.rows);
});

router.post('/deliveries/:deliveryId/accept', async (req: Request, res: Response) => {
  const userId = driverUserId(req);
  const deliveryId = String(req.params.deliveryId);
  const parsed = z.object({ requestedPayout: z.number().min(0).max(1000).optional().nullable() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message || 'Invalid delivery acceptance');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deliveryRes = await client.query(`SELECT * FROM deliveries WHERE id = $1 FOR UPDATE`, [deliveryId]);
    const delivery = deliveryRes.rows[0];
    if (!delivery) throw new Error('Delivery not found');
    if (delivery.current_driver_user_id && delivery.current_driver_user_id !== userId) throw new Error('Delivery already assigned');
    if (!['awaiting_dispatch','accepted'].includes(delivery.status)) throw new Error('Delivery is no longer available');

    const claim = await client.query(
      `UPDATE deliveries
       SET current_driver_user_id = $2,
           driver_payout_estimate = COALESCE($3, driver_payout_estimate),
           status = 'accepted',
           accepted_at = COALESCE(accepted_at, now()),
           updated_at = now()
       WHERE id = $1
         AND (current_driver_user_id IS NULL OR current_driver_user_id = $2)
         AND status IN ('awaiting_dispatch','accepted')
       RETURNING order_id, driver_payout_estimate`,
      [deliveryId, userId, parsed.data.requestedPayout ?? null]
    );
    if (!claim.rowCount) throw new Error('Delivery already taken by another driver');
    await client.query(`UPDATE driver_profiles SET available_for_dispatch = false, updated_at = now() WHERE user_id = $1`, [userId]);
    await client.query(`INSERT INTO delivery_events (delivery_id, status, actor_user_id, event_name, metadata) VALUES ($1, 'accepted', $2, 'driver_accepted_delivery', $3::jsonb)`, [deliveryId, userId, JSON.stringify({ requestedPayout: parsed.data.requestedPayout ?? null })]);
    await client.query(`INSERT INTO order_events (order_id, status, actor_type, actor_user_id, event_name, notes, metadata) SELECT order_id, 'confirmed', 'driver', $2, 'driver_confirmed', 'Driver accepted delivery', $3::jsonb FROM deliveries WHERE id = $1`, [deliveryId, userId, JSON.stringify({ requestedPayout: parsed.data.requestedPayout ?? null })]);
    const notify = await client.query(`SELECT o.id AS order_id, o.customer_user_id, o.restaurant_id, u.full_name AS driver_name, d.driver_payout_estimate FROM deliveries d JOIN orders o ON o.id = d.order_id JOIN users u ON u.id = $2 WHERE d.id = $1`, [deliveryId, userId]);
    await client.query('COMMIT');
    const info = notify.rows[0];
    if (info) {
      emitToOrder(info.order_id, 'delivery:accepted', { orderId: info.order_id, deliveryId, driverName: info.driver_name, payoutEstimate: info.driver_payout_estimate });
      emitToUser(info.customer_user_id, 'delivery:accepted', { orderId: info.order_id, deliveryId, driverName: info.driver_name, payoutEstimate: info.driver_payout_estimate });
      emitToRestaurant(info.restaurant_id, 'delivery:accepted', { orderId: info.order_id, deliveryId, driverName: info.driver_name, payoutEstimate: info.driver_payout_estimate });
      await sendPushNotification({ userId: info.customer_user_id, title: 'Driver assigned', body: `${info.driver_name} accepted your order.`, data: { orderId: info.order_id, type: 'delivery' } });
    }
    return ok(res, true, 'Delivery accepted');
  } catch (error) {
    await client.query('ROLLBACK');
    return fail(res, 400, error instanceof Error ? error.message : 'Accept failed');
  } finally {
    client.release();
  }
});

router.post('/deliveries/:deliveryId/status', async (req: Request, res: Response) => {
  const userId = driverUserId(req);
  const deliveryId = String(req.params.deliveryId);
  const schema = z.object({ status: z.enum(['accepted','en_route_to_pickup','arrived_at_pickup','picked_up','en_route_to_dropoff','arrived_at_dropoff','delivered','failed']) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid status');

  const map: Record<string, { delivery: string; order?: string; stamp?: string }> = {
    accepted: { delivery: 'accepted', stamp: 'accepted_at' },
    en_route_to_pickup: { delivery: 'en_route_to_pickup' },
    arrived_at_pickup: { delivery: 'arrived_at_pickup', stamp: 'arrived_at_pickup_at' },
    picked_up: { delivery: 'picked_up', order: 'picked_up', stamp: 'picked_up_at' },
    en_route_to_dropoff: { delivery: 'en_route_to_dropoff', order: 'out_for_delivery' },
    arrived_at_dropoff: { delivery: 'arrived_at_dropoff', stamp: 'arrived_at_dropoff_at' },
    delivered: { delivery: 'delivered', order: 'delivered', stamp: 'delivered_at' },
    failed: { delivery: 'failed' }
  };

  const state = map[parsed.data.status];
  const deliveryResult = await pool.query(`SELECT order_id FROM deliveries WHERE id = $1 AND current_driver_user_id = $2`, [deliveryId, userId]);
  const delivery = deliveryResult.rows[0];
  if (!delivery) return fail(res, 404, 'Delivery not found');

  const stampClause = state.stamp ? `, ${state.stamp} = now()` : '';
  await pool.query(`UPDATE deliveries SET status = $2${stampClause}, updated_at = now() WHERE id = $1`, [deliveryId, state.delivery]);
  if (state.order) {
    const orderStamp = state.order === 'delivered' ? ', completed_at = now()' : '';
    await pool.query(`UPDATE orders SET status = $2${orderStamp}, updated_at = now() WHERE id = $1`, [delivery.order_id, state.order]);
  }
  if (parsed.data.status === 'delivered') {
    await pool.query(`UPDATE driver_profiles SET total_deliveries = total_deliveries + 1, available_for_dispatch = true, updated_at = now() WHERE user_id = $1`, [userId]);
  }
  await pool.query(`INSERT INTO delivery_events (delivery_id, status, actor_user_id, event_name) VALUES ($1, $2, $3, $4)`, [deliveryId, state.delivery, userId, `driver_${parsed.data.status}`]);
  if (state.order) {
    await pool.query(`INSERT INTO order_events (order_id, status, actor_type, actor_user_id, event_name, notes) VALUES ($1, $2, 'driver', $3, $4, $5)`, [delivery.order_id, state.order, userId, `driver_${parsed.data.status}`, `Driver updated status to ${parsed.data.status}`]);
  }
  const orderInfo = await pool.query(`SELECT o.customer_user_id, o.restaurant_id, u.full_name AS driver_name FROM orders o LEFT JOIN users u ON u.id = $2 WHERE o.id = $1`, [delivery.order_id, userId]);
  const info = orderInfo.rows[0];
  emitToOrder(delivery.order_id, 'order:status_changed', { orderId: delivery.order_id, status: state.order || state.delivery, deliveryStatus: state.delivery });
  if (info?.customer_user_id) await sendPushNotification({ userId: info.customer_user_id, title: 'Order status updated', body: `Driver status: ${parsed.data.status.replace(/_/g,' ')}`, data: { orderId: delivery.order_id, type: 'order_status' } });
  if (info?.customer_user_id) emitToUser(info.customer_user_id, 'order:status_changed', { orderId: delivery.order_id, status: state.order || state.delivery, deliveryStatus: state.delivery, driverName: info.driver_name });
  if (info?.restaurant_id) emitToRestaurant(info.restaurant_id, 'order:status_changed', { orderId: delivery.order_id, status: state.order || state.delivery, deliveryStatus: state.delivery, driverName: info.driver_name });
  return ok(res, true, 'Delivery status updated');
});

router.get('/deliveries/:deliveryId/live', async (req: Request, res: Response) => {
  const userId = driverUserId(req);
  const deliveryId = String(req.params.deliveryId);
  const result = await pool.query(`
    SELECT d.id, d.status, d.order_id, d.current_driver_user_id, o.status AS order_status,
           a.address_line1, a.city, a.province, a.delivery_instructions, ST_Y(a.location::geometry) AS dropoff_latitude, ST_X(a.location::geometry) AS dropoff_longitude,
           ST_Y(rl.location::geometry) AS restaurant_latitude, ST_X(rl.location::geometry) AS restaurant_longitude
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    LEFT JOIN user_addresses a ON a.id = o.delivery_address_id
    LEFT JOIN restaurant_locations rl ON rl.id = o.restaurant_location_id
    WHERE d.id = $1 AND d.current_driver_user_id = $2
    LIMIT 1
  `, [deliveryId, userId]);
  const deliveryRow = result.rows[0];
  if (!deliveryRow) return fail(res, 404, 'Delivery not found');
  const latestLocation = await pool.query(`SELECT ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude, speed_kph, heading_deg, recorded_at FROM driver_location_history_default WHERE driver_user_id = $1 ORDER BY recorded_at DESC LIMIT 1`, [userId]);
  const restaurantNavUrl = deliveryRow.restaurant_latitude != null && deliveryRow.restaurant_longitude != null ? `https://www.google.com/maps/dir/?api=1&destination=${deliveryRow.restaurant_latitude},${deliveryRow.restaurant_longitude}&travelmode=driving` : null;
  const customerNavUrl = deliveryRow.dropoff_latitude != null && deliveryRow.dropoff_longitude != null ? `https://www.google.com/maps/dir/?api=1&destination=${deliveryRow.dropoff_latitude},${deliveryRow.dropoff_longitude}&travelmode=driving` : null;
  return ok(res, { ...deliveryRow, latestLocation: latestLocation.rows[0] ?? null, restaurantNavUrl, customerNavUrl });
});

router.post('/location', async (req: Request, res: Response) => {
  const userId = driverUserId(req);
  const schema = z.object({ latitude: z.number(), longitude: z.number(), speedKph: z.number().optional().nullable(), headingDeg: z.number().optional().nullable(), accuracyM: z.number().optional().nullable() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid location');
  const d = parsed.data;
  await pool.query(
    `INSERT INTO driver_location_history_default (driver_user_id, location, speed_kph, heading_deg, accuracy_m, recorded_at)
     VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3),4326)::geography, $4, $5, $6, now())`,
    [userId, d.longitude, d.latitude, d.speedKph ?? null, d.headingDeg ?? null, d.accuracyM ?? null]
  );
  await pool.query(`UPDATE driver_profiles SET available_for_dispatch = true, updated_at = now() WHERE user_id = $1`, [userId]);
  const activeOrders = await pool.query(`
    SELECT d.id, d.order_id, d.status, ST_Y(rl.location::geometry) AS restaurant_latitude, ST_X(rl.location::geometry) AS restaurant_longitude,
           ST_Y(ua.location::geometry) AS dropoff_latitude, ST_X(ua.location::geometry) AS dropoff_longitude, o.customer_user_id
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    LEFT JOIN restaurant_locations rl ON rl.id = o.restaurant_location_id
    LEFT JOIN user_addresses ua ON ua.id = o.delivery_address_id
    WHERE d.current_driver_user_id = $1 AND d.status IN ('accepted','en_route_to_pickup','arrived_at_pickup','picked_up','en_route_to_dropoff','arrived_at_dropoff')
  `, [userId]);
  function near(lat1:number, lon1:number, lat2:number|null, lon2:number|null, thresholdMeters:number) {
    if (lat2 == null || lon2 == null) return false;
    const R = 6371000;
    const toRad = (deg:number) => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) <= thresholdMeters;
  }
  for (const row of activeOrders.rows) {
    if ((row.status === 'accepted' || row.status === 'en_route_to_pickup') && near(d.latitude, d.longitude, row.restaurant_latitude, row.restaurant_longitude, 120)) {
      await pool.query(`UPDATE deliveries SET status = 'arrived_at_pickup', arrived_at_pickup_at = COALESCE(arrived_at_pickup_at, now()), updated_at = now() WHERE id = $1 AND status IN ('accepted','en_route_to_pickup')`, [row.id]);
      await pool.query(`INSERT INTO delivery_events (delivery_id, status, actor_user_id, event_name) VALUES ($1, 'arrived_at_pickup', $2, 'driver_arrived_at_pickup_auto')`, [row.id, userId]);
      await pool.query(`INSERT INTO order_events (order_id, status, actor_type, actor_user_id, event_name, notes) VALUES ($1, 'confirmed', 'driver', $2, 'driver_arrived_at_pickup_auto', 'Driver arrived at restaurant')`, [row.order_id, userId]);
    }
    if ((row.status === 'picked_up' || row.status === 'en_route_to_dropoff') && near(d.latitude, d.longitude, row.dropoff_latitude, row.dropoff_longitude, 120)) {
      await pool.query(`UPDATE deliveries SET status = 'arrived_at_dropoff', arrived_at_dropoff_at = COALESCE(arrived_at_dropoff_at, now()), updated_at = now() WHERE id = $1 AND status IN ('picked_up','en_route_to_dropoff')`, [row.id]);
      await pool.query(`INSERT INTO delivery_events (delivery_id, status, actor_user_id, event_name) VALUES ($1, 'arrived_at_dropoff', $2, 'driver_arrived_at_dropoff_auto')`, [row.id, userId]);
      await pool.query(`INSERT INTO order_events (order_id, status, actor_type, actor_user_id, event_name, notes) VALUES ($1, 'out_for_delivery', 'driver', $2, 'driver_arrived_at_dropoff_auto', 'Driver arrived near customer')`, [row.order_id, userId]);
      if (row.customer_user_id) await sendPushNotification({ userId: row.customer_user_id, title: 'Driver is outside', body: 'Your driver has arrived near your delivery pin.', data: { orderId: row.order_id, type: 'delivery' } });
    }
    emitToOrder(row.order_id, 'driver:location_updated', { orderId: row.order_id, latitude: d.latitude, longitude: d.longitude, speedKph: d.speedKph ?? null, headingDeg: d.headingDeg ?? null, recordedAt: new Date().toISOString() });
  }
  return ok(res, true, 'Location updated');
});

router.get('/earnings', async (req: Request, res: Response) => {
  const userId = driverUserId(req);
  const result = await pool.query(`
    SELECT d.id, d.order_id, d.driver_payout_estimate, d.status, d.delivered_at,
           r.display_name AS restaurant_name
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    JOIN restaurants r ON r.id = o.restaurant_id
    WHERE d.current_driver_user_id = $1
    ORDER BY d.created_at DESC
  `, [userId]);
  return ok(res, result.rows);
});

export default router;
