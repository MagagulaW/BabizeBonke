import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { canAccessRestaurant, requireAuth } from '../middleware/auth.js';
import { ok, fail } from '../utils/http.js';
import { emitToOrder, emitToUser } from '../realtime.js';
import { sendPushNotification } from '../services/notifications.service.js';

const router = Router();

function normalizeUrlInput(value: unknown) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/uploads/')) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[A-Za-z]{2,}([/?#].*)?$/.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

const flexibleUrl = z.preprocess(
  normalizeUrlInput,
  z.string().refine((value) => value.startsWith('/uploads/') || /^https?:\/\//i.test(value), 'Invalid url').nullable().optional()
);

router.use(requireAuth);

router.get('/:restaurantId/dashboard', async (req: Request, res: Response) => {
  const restaurantId = String(req.params.restaurantId);
  if (!canAccessRestaurant(req, restaurantId)) return fail(res, 403, 'Forbidden');

  const [restaurant, orders, menu, inventory, trend] = await Promise.all([
    pool.query(`SELECT id, display_name, status, commission_rate, accepts_delivery, accepts_pickup FROM restaurants WHERE id = $1`, [restaurantId]),
    pool.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status='placed')::int AS new_orders,
      COUNT(*) FILTER (WHERE status='preparing')::int AS preparing,
      COUNT(*) FILTER (WHERE status='delivered')::int AS delivered,
      COALESCE(SUM(total_amount),0)::numeric(12,2) AS sales
      FROM orders WHERE restaurant_id = $1`, [restaurantId]),
    pool.query(`SELECT COUNT(DISTINCT mc.id)::int AS categories,
      COUNT(*) FILTER (WHERE mi.is_available=true AND mi.is_active=true)::int AS active_items
      FROM menu_items mi
      LEFT JOIN menu_categories mc ON mc.id = mi.category_id
      WHERE mi.restaurant_id = $1`, [restaurantId]),
    pool.query(`SELECT COUNT(*)::int AS tracked_items,
      COUNT(*) FILTER (WHERE stock_quantity <= reorder_threshold)::int AS low_stock
      FROM restaurant_inventory_items WHERE restaurant_id = $1`, [restaurantId]),
    pool.query(`SELECT status, COUNT(*)::int AS total FROM orders WHERE restaurant_id = $1 GROUP BY status ORDER BY total DESC`, [restaurantId])
  ]);

  return ok(res, {
    restaurant: restaurant.rows[0],
    orders: orders.rows[0],
    menu: menu.rows[0],
    inventory: inventory.rows[0],
    trend: trend.rows
  });
});

router.get('/:restaurantId/profile', async (req: Request, res: Response) => {
  const restaurantId = String(req.params.restaurantId);
  if (!canAccessRestaurant(req, restaurantId)) return fail(res, 403, 'Forbidden');

  const [restaurant, location, media] = await Promise.all([
    pool.query(`SELECT id, legal_name, display_name, trading_name, description, support_email, support_phone, website_url, status, onboarding_step, cuisine_tags, commission_rate, prep_time_min_mins, prep_time_max_mins, accepts_delivery, accepts_pickup FROM restaurants WHERE id = $1 LIMIT 1`, [restaurantId]),
    pool.query(`SELECT id, location_name, address_line1, suburb, city, province, postal_code, latitude, longitude, delivery_radius_km FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary = true LIMIT 1`, [restaurantId]),
    pool.query(`SELECT file_url, alt_text FROM media_assets WHERE owner_type = 'restaurant' AND owner_id = $1 ORDER BY created_at DESC`, [restaurantId])
  ]);

  const assets = media.rows.reduce((acc: Record<string, string>, row: { file_url: string; alt_text: string | null }) => {
    if (row.alt_text && !acc[row.alt_text]) acc[row.alt_text] = row.file_url;
    return acc;
  }, {});

  return ok(res, { restaurant: restaurant.rows[0] ?? null, location: location.rows[0] ?? null, logoUrl: assets.logo ?? null, bannerUrl: assets.banner ?? null });
});

router.put('/:restaurantId/profile', async (req: Request, res: Response) => {
  const restaurantId = String(req.params.restaurantId);
  if (!canAccessRestaurant(req, restaurantId)) return fail(res, 403, 'Forbidden');
  const schema = z.object({
    displayName: z.string().min(2),
    legalName: z.string().min(2),
    tradingName: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    supportEmail: z.string().email().optional().nullable(),
    supportPhone: z.string().optional().nullable(),
    websiteUrl: flexibleUrl,
    cuisineTags: z.array(z.string()).default([]),
    prepTimeMinMins: z.number().int().nonnegative().optional().nullable(),
    prepTimeMaxMins: z.number().int().nonnegative().optional().nullable(),
    acceptsPickup: z.boolean().default(true),
    acceptsDelivery: z.boolean().default(true),
    logoUrl: flexibleUrl,
    bannerUrl: flexibleUrl,
    addressLine1: z.string().min(3),
    locationName: z.string().optional().nullable(),
    suburb: z.string().optional().nullable(),
    city: z.string().min(2),
    province: z.string().min(2),
    postalCode: z.string().optional().nullable(),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
    deliveryRadiusKm: z.number().nonnegative().optional().nullable()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid restaurant profile');
  const d = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE restaurants
      SET display_name = $2, legal_name = $3, trading_name = $4, description = $5, support_email = $6, support_phone = $7,
          website_url = $8, cuisine_tags = $9, prep_time_min_mins = $10, prep_time_max_mins = $11,
          accepts_pickup = $12, accepts_delivery = $13, updated_at = now()
      WHERE id = $1`, [restaurantId, d.displayName, d.legalName, d.tradingName ?? null, d.description ?? null, d.supportEmail ?? null, d.supportPhone ?? null, d.websiteUrl ?? null, d.cuisineTags, d.prepTimeMinMins ?? null, d.prepTimeMaxMins ?? null, d.acceptsPickup, d.acceptsDelivery]);
    const existingLocation = await client.query(`SELECT latitude, longitude FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary = true LIMIT 1`, [restaurantId]);
    const latitude = d.latitude ?? existingLocation.rows[0]?.latitude ?? -25.4745;
    const longitude = d.longitude ?? existingLocation.rows[0]?.longitude ?? 30.9703;
    await client.query(`UPDATE restaurant_locations
      SET location_name = $2, address_line1 = $3, suburb = $4, city = $5, province = $6, postal_code = $7,
          location = ST_SetSRID(ST_MakePoint($8, $9),4326)::geography, delivery_radius_km = $10, updated_at = now()
      WHERE restaurant_id = $1 AND is_primary = true`, [restaurantId, d.locationName ?? 'Main Branch', d.addressLine1, d.suburb ?? null, d.city, d.province, d.postalCode ?? null, longitude, latitude, d.deliveryRadiusKm ?? null]);

    await client.query(`DELETE FROM media_assets WHERE owner_type = 'restaurant' AND owner_id = $1 AND alt_text IN ('logo','banner')`, [restaurantId]);
    if (d.logoUrl) await client.query(`INSERT INTO media_assets (owner_type, owner_id, file_url, alt_text, created_by_user_id) VALUES ('restaurant', $1, $2, 'logo', $3)`, [restaurantId, d.logoUrl, req.user?.userId ?? null]);
    if (d.bannerUrl) await client.query(`INSERT INTO media_assets (owner_type, owner_id, file_url, alt_text, created_by_user_id) VALUES ('restaurant', $1, $2, 'banner', $3)`, [restaurantId, d.bannerUrl, req.user?.userId ?? null]);
    await client.query('COMMIT');
    return ok(res, true, 'Restaurant profile updated');
  } catch (error) {
    await client.query('ROLLBACK');
    return fail(res, 400, error instanceof Error ? error.message : 'Restaurant profile update failed');
  } finally {
    client.release();
  }
});

router.get('/:restaurantId/orders', async (req: Request, res: Response) => {
  const restaurantId = String(req.params.restaurantId);
  if (!canAccessRestaurant(req, restaurantId)) return fail(res, 403, 'Forbidden');

  const result = await pool.query(`
    SELECT o.id, o.status, o.order_type, o.total_amount, o.currency, o.placed_at, u.full_name AS customer_name
    FROM orders o
    JOIN users u ON u.id = o.customer_user_id
    WHERE o.restaurant_id = $1
    ORDER BY o.placed_at DESC
    LIMIT 200
  `, [restaurantId]);
  return ok(res, result.rows);
});

router.patch('/:restaurantId/orders/:orderId/status', async (req: Request, res: Response) => {
  const restaurantId = String(req.params.restaurantId);
  const orderId = String(req.params.orderId);
  if (!canAccessRestaurant(req, restaurantId)) return fail(res, 403, 'Forbidden');
  const parsed = z.object({ status: z.enum(['placed','confirmed','preparing','ready_for_pickup','picked_up','out_for_delivery','delivered','cancelled']), reason: z.string().max(300).optional().nullable(), estimatedPrepMins: z.number().int().min(0).max(240).optional().nullable() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message || 'Invalid order status');
  const { status, reason, estimatedPrepMins } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentRes = await client.query(`SELECT id, customer_user_id, status AS current_status FROM orders WHERE id = $2 AND restaurant_id = $1 FOR UPDATE`, [restaurantId, orderId]);
    const current = currentRes.rows[0];
    if (!current) throw new Error('Order not found');

    await client.query(`UPDATE orders SET status = $3, updated_at = now() WHERE id = $2 AND restaurant_id = $1`, [restaurantId, orderId, status]);

    let notes = `Restaurant updated order to ${status}`;
    let eventName = `restaurant_${status}`;
    if (status === 'cancelled') {
      notes = reason ? `Restaurant rejected order: ${reason}` : 'Restaurant rejected the order';
      eventName = 'restaurant_rejected';
      await client.query(`UPDATE deliveries SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE order_id = $1 AND status <> 'delivered'`, [orderId]);
    } else if (status === 'preparing' && estimatedPrepMins != null) {
      await client.query(`UPDATE deliveries SET pickup_eta_mins = $2, updated_at = now() WHERE order_id = $1 AND status IN ('awaiting_dispatch','offer_in_progress','assigned','accepted')`, [orderId, estimatedPrepMins]);
      notes = `Restaurant started preparing the order${estimatedPrepMins ? ` · ETA ${estimatedPrepMins} min` : ''}`;
    } else if (status === 'ready_for_pickup') {
      await client.query(`UPDATE deliveries SET status = CASE WHEN status = 'awaiting_dispatch' THEN 'offer_in_progress' ELSE status END, updated_at = now() WHERE order_id = $1`, [orderId]);
      notes = 'Restaurant marked the order ready for pickup';
    }

    await client.query(`INSERT INTO order_events (order_id, status, actor_type, actor_user_id, event_name, notes, metadata) VALUES ($1, $2, 'restaurant', $3, $4, $5, $6::jsonb)`, [orderId, status, req.user?.userId ?? null, eventName, notes, JSON.stringify({ reason: reason ?? null, estimatedPrepMins: estimatedPrepMins ?? null })]);
    await client.query('COMMIT');

    emitToOrder(orderId, 'order:status_changed', { orderId, status, source: 'restaurant', reason: reason ?? null, estimatedPrepMins: estimatedPrepMins ?? null });
    if (current.customer_user_id) {
      emitToUser(current.customer_user_id, 'order:status_changed', { orderId, status, source: 'restaurant', reason: reason ?? null, estimatedPrepMins: estimatedPrepMins ?? null });
      const body = status === 'cancelled'
        ? `Restaurant rejected your order${reason ? `: ${reason}` : '.'}`
        : status === 'ready_for_pickup'
          ? 'Your order is packed and ready for pickup.'
          : status === 'preparing' && estimatedPrepMins != null
            ? `Your order is being prepared. ETA ${estimatedPrepMins} min.`
            : `Your order is now ${status.replace(/_/g, ' ')}.`;
      await sendPushNotification({ userId: current.customer_user_id, title: 'Restaurant update', body, data: { orderId, type: 'order_status' } });
    }
    return ok(res, { id: orderId, status }, 'Order updated');
  } catch (error) {
    await client.query('ROLLBACK');
    return fail(res, 400, error instanceof Error ? error.message : 'Order update failed');
  } finally {
    client.release();
  }
});

router.get('/:restaurantId/categories', async (req: Request, res: Response) => {
  const restaurantId = String(req.params.restaurantId);
  if (!canAccessRestaurant(req, restaurantId)) return fail(res, 403, 'Forbidden');
  const result = await pool.query(`SELECT * FROM menu_categories WHERE restaurant_id = $1 ORDER BY display_order, name`, [restaurantId]);
  return ok(res, result.rows);
});

router.post('/:restaurantId/categories', async (req: Request, res: Response) => {
  const restaurantId = String(req.params.restaurantId);
  if (!canAccessRestaurant(req, restaurantId)) return fail(res, 403, 'Forbidden');
  const schema = z.object({ name: z.string().min(2), description: z.string().optional().nullable(), displayOrder: z.number().int().default(0) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid category');

  const result = await pool.query(`
    INSERT INTO menu_categories (restaurant_id, name, description, display_order)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [restaurantId, parsed.data.name, parsed.data.description ?? null, parsed.data.displayOrder]);
  return ok(res, result.rows[0], 'Category created');
});

router.put('/:restaurantId/categories/:categoryId', async (req: Request, res: Response) => {
  const restaurantId = String(req.params.restaurantId);
  const categoryId = String(req.params.categoryId);
  if (!canAccessRestaurant(req, restaurantId)) return fail(res, 403, 'Forbidden');
  const schema = z.object({ name: z.string().min(2), description: z.string().optional().nullable(), displayOrder: z.number().int().default(0), isActive: z.boolean().default(true) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid category');

  const result = await pool.query(`
    UPDATE menu_categories
    SET name=$3, description=$4, display_order=$5, is_active=$6, updated_at=now()
    WHERE id=$2 AND restaurant_id=$1
    RETURNING *
  `, [restaurantId, categoryId, parsed.data.name, parsed.data.description ?? null, parsed.data.displayOrder, parsed.data.isActive]);
  if (!result.rowCount) return fail(res, 404, 'Category not found');
  return ok(res, result.rows[0], 'Category updated');
});

router.delete('/:restaurantId/categories/:categoryId', async (req: Request, res: Response) => {
  const restaurantId = String(req.params.restaurantId);
  const categoryId = String(req.params.categoryId);
  if (!canAccessRestaurant(req, restaurantId)) return fail(res, 403, 'Forbidden');
  await pool.query(`DELETE FROM menu_categories WHERE id=$2 AND restaurant_id=$1`, [restaurantId, categoryId]);
  return ok(res, true, 'Category deleted');
});

router.get('/:restaurantId/items', async (req: Request, res: Response) => {
  const restaurantId = String(req.params.restaurantId);
  if (!canAccessRestaurant(req, restaurantId)) return fail(res, 403, 'Forbidden');

  const result = await pool.query(`
    SELECT mi.*, mc.name AS category_name
    FROM menu_items mi
    LEFT JOIN menu_categories mc ON mc.id = mi.category_id
    WHERE mi.restaurant_id = $1
    ORDER BY mi.display_order, mi.name
  `, [restaurantId]);
  return ok(res, result.rows);
});

router.post('/:restaurantId/items', async (req: Request, res: Response) => {
  const restaurantId = String(req.params.restaurantId);
  if (!canAccessRestaurant(req, restaurantId)) return fail(res, 403, 'Forbidden');
  const schema = z.object({
    name: z.string().min(2),
    description: z.string().optional().nullable(),
    imageUrl: z.string().url().optional().nullable(),
    categoryId: z.string().uuid().optional().nullable(),
    basePrice: z.number().nonnegative(),
    sku: z.string().optional().nullable(),
    isAvailable: z.boolean().default(true),
    isVegetarian: z.boolean().default(false),
    isVegan: z.boolean().default(false),
    isHalal: z.boolean().default(false),
    displayOrder: z.number().int().default(0)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid menu item');
  const d = parsed.data;

  const result = await pool.query(`
    INSERT INTO menu_items (restaurant_id, category_id, name, description, image_url, sku, base_price, is_available, is_vegetarian, is_vegan, is_halal, display_order)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *
  `, [restaurantId, d.categoryId ?? null, d.name, d.description ?? null, d.imageUrl ?? null, d.sku ?? null, d.basePrice, d.isAvailable, d.isVegetarian, d.isVegan, d.isHalal, d.displayOrder]);
  return ok(res, result.rows[0], 'Item created');
});

router.put('/:restaurantId/items/:itemId', async (req: Request, res: Response) => {
  const restaurantId = String(req.params.restaurantId);
  const itemId = String(req.params.itemId);
  if (!canAccessRestaurant(req, restaurantId)) return fail(res, 403, 'Forbidden');
  const schema = z.object({
    name: z.string().min(2),
    description: z.string().optional().nullable(),
    imageUrl: z.string().url().optional().nullable(),
    categoryId: z.string().uuid().optional().nullable(),
    basePrice: z.number().nonnegative(),
    sku: z.string().optional().nullable(),
    isAvailable: z.boolean().default(true),
    isVegetarian: z.boolean().default(false),
    isVegan: z.boolean().default(false),
    isHalal: z.boolean().default(false),
    isActive: z.boolean().default(true),
    displayOrder: z.number().int().default(0)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid menu item');
  const d = parsed.data;

  const result = await pool.query(`
    UPDATE menu_items SET category_id=$3, name=$4, description=$5, image_url=$6, sku=$7, base_price=$8,
      is_available=$9, is_vegetarian=$10, is_vegan=$11, is_halal=$12, is_active=$13, display_order=$14, updated_at=now()
    WHERE restaurant_id=$1 AND id=$2
    RETURNING *
  `, [restaurantId, itemId, d.categoryId ?? null, d.name, d.description ?? null, d.imageUrl ?? null, d.sku ?? null, d.basePrice, d.isAvailable, d.isVegetarian, d.isVegan, d.isHalal, d.isActive, d.displayOrder]);
  if (!result.rowCount) return fail(res, 404, 'Menu item not found');
  return ok(res, result.rows[0], 'Item updated');
});

router.delete('/:restaurantId/items/:itemId', async (req: Request, res: Response) => {
  const restaurantId = String(req.params.restaurantId);
  const itemId = String(req.params.itemId);
  if (!canAccessRestaurant(req, restaurantId)) return fail(res, 403, 'Forbidden');
  await pool.query(`DELETE FROM menu_items WHERE restaurant_id=$1 AND id=$2`, [restaurantId, itemId]);
  return ok(res, true, 'Item deleted');
});

router.get('/:restaurantId/inventory', async (req: Request, res: Response) => {
  const restaurantId = String(req.params.restaurantId);
  if (!canAccessRestaurant(req, restaurantId)) return fail(res, 403, 'Forbidden');
  const result = await pool.query(`
    SELECT id, item_name, sku, stock_quantity, reorder_threshold, unit, is_active, last_counted_at
    FROM restaurant_inventory_items
    WHERE restaurant_id = $1
    ORDER BY item_name
  `, [restaurantId]);
  return ok(res, result.rows);
});

export default router;
