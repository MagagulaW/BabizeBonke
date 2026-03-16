import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { fail, ok } from '../utils/http.js';
import { emitToOrder, emitToRestaurant, emitToUser } from '../realtime.js';
import { sendPushNotification } from '../services/notifications.service.js';

const router = Router();
router.use(requireAuth, requireRoles(['customer', 'platform_admin']));

function userId(req: Request) {
  const id = req.user?.userId;
  if (!id) throw new Error('Missing user');
  return id;
}

async function getOrCreateActiveCart(customerUserId: string, restaurantId: string) {
  const existing = await pool.query(
    `SELECT id FROM carts WHERE customer_user_id = $1 AND restaurant_id = $2 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
    [customerUserId, restaurantId]
  );
  if (existing.rows[0]?.id) return existing.rows[0].id as string;

  const location = await pool.query(`SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary = true LIMIT 1`, [restaurantId]);
  const created = await pool.query(
    `INSERT INTO carts (customer_user_id, restaurant_id, restaurant_location_id, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    [customerUserId, restaurantId, location.rows[0]?.id ?? null]
  );
  return created.rows[0].id as string;
}

async function recalcCart(cartId: string) {
  await pool.query(
    `UPDATE carts c
     SET subtotal_amount = totals.subtotal,
         delivery_fee_amount = CASE WHEN c.delivery_address_id IS NULL THEN 0 ELSE 20 END,
         tax_amount = ROUND((totals.subtotal + CASE WHEN c.delivery_address_id IS NULL THEN 0 ELSE 20 END) * 0.15, 2),
         total_amount = ROUND(totals.subtotal + CASE WHEN c.delivery_address_id IS NULL THEN 0 ELSE 20 END + ROUND((totals.subtotal + CASE WHEN c.delivery_address_id IS NULL THEN 0 ELSE 20 END) * 0.15, 2), 2),
         updated_at = now()
     FROM (
       SELECT COALESCE(SUM(line_total),0)::numeric(12,2) AS subtotal
       FROM cart_items WHERE cart_id = $1
     ) totals
     WHERE c.id = $1`,
    [cartId]
  );
}

router.get('/home', async (req: Request, res: Response) => {
  const customerUserId = userId(req);
  const [restaurants, featuredRestaurants, promotions, recentOrders, activeCart, loyalty] = await Promise.all([
    pool.query(`
      SELECT r.id, r.display_name, r.description, r.status, r.cuisine_tags, r.commission_rate,
             rl.city, rl.province,
             (SELECT ma.file_url FROM media_assets ma WHERE ma.owner_type = 'restaurant' AND ma.owner_id = r.id AND ma.alt_text = 'banner' ORDER BY ma.created_at DESC LIMIT 1) AS banner_url,
             COALESCE(rrs.average_rating, 0) AS average_rating,
             COALESCE(rrs.review_count, 0) AS review_count,
             (SELECT ma.file_url FROM media_assets ma WHERE ma.owner_type = 'restaurant' AND ma.owner_id = r.id AND ma.alt_text = 'logo' ORDER BY ma.created_at DESC LIMIT 1) AS logo_url,
             COUNT(DISTINCT mi.id)::int AS active_items
      FROM restaurants r
      LEFT JOIN restaurant_locations rl ON rl.restaurant_id = r.id AND rl.is_primary = true
      LEFT JOIN restaurant_rating_summary_view rrs ON rrs.restaurant_id = r.id
      LEFT JOIN menu_items mi ON mi.restaurant_id = r.id AND mi.is_active = true AND mi.is_available = true
      WHERE r.is_active = true AND r.status IN ('approved')
      GROUP BY r.id, rl.city, rl.province, rrs.average_rating, rrs.review_count
      ORDER BY r.created_at DESC
    `),
    pool.query(`
      SELECT fr.id, fr.priority, r.id AS restaurant_id, r.display_name, r.description,
             COALESCE(rrs.average_rating, 0) AS average_rating,
             (SELECT ma.file_url FROM media_assets ma WHERE ma.owner_type = 'restaurant' AND ma.owner_id = r.id AND ma.alt_text = 'logo' ORDER BY ma.created_at DESC LIMIT 1) AS logo_url
      FROM featured_restaurants fr
      JOIN restaurants r ON r.id = fr.restaurant_id
      LEFT JOIN restaurant_rating_summary_view rrs ON rrs.restaurant_id = r.id
      WHERE r.is_active = true
        AND r.status IN ('approved')
        AND (fr.starts_at IS NULL OR fr.starts_at <= now())
        AND (fr.ends_at IS NULL OR fr.ends_at >= now())
      ORDER BY fr.priority DESC, fr.created_at DESC
      LIMIT 8
    `),
    pool.query(`
      SELECT id, title, description, banner_image_url, priority
      FROM promotions
      WHERE is_active = true
        AND (starts_at IS NULL OR starts_at <= now())
        AND (ends_at IS NULL OR ends_at >= now())
      ORDER BY priority DESC, created_at DESC
      LIMIT 6
    `),
    pool.query(`
      SELECT o.id, o.status, o.total_amount, o.currency, o.placed_at, r.display_name AS restaurant_name
      FROM orders o
      JOIN restaurants r ON r.id = o.restaurant_id
      WHERE o.customer_user_id = $1
      ORDER BY o.placed_at DESC
      LIMIT 8
    `, [customerUserId]),
    pool.query(`SELECT id, total_amount, currency FROM carts WHERE customer_user_id = $1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1`, [customerUserId]),
    pool.query(`SELECT loyalty_points, preferred_language FROM customer_profiles WHERE user_id = $1 LIMIT 1`, [customerUserId])
  ]);

  return ok(res, {
    restaurants: restaurants.rows,
    featuredRestaurants: featuredRestaurants.rows,
    promotions: promotions.rows,
    recentOrders: recentOrders.rows,
    activeCart: activeCart.rows[0] ?? null,
    loyalty: loyalty.rows[0] ?? { loyalty_points: 0, preferred_language: 'en' }
  });
});


router.get('/deals', async (_req: Request, res: Response) => {
  const [promotions, coupons, restaurantSpecials] = await Promise.all([
    pool.query(`
      SELECT id, title, description, banner_image_url, priority
      FROM promotions
      WHERE is_active = true
        AND (starts_at IS NULL OR starts_at <= now())
        AND (ends_at IS NULL OR ends_at >= now())
      ORDER BY priority DESC, created_at DESC
      LIMIT 8
    `),
    pool.query(`
      SELECT c.id, c.code, c.name, c.description, c.discount_type, c.discount_value, c.min_order_total
      FROM coupons c
      WHERE c.is_active = true
        AND c.scope_type = 'platform'
        AND (c.starts_at IS NULL OR c.starts_at <= now())
        AND (c.ends_at IS NULL OR c.ends_at >= now())
      ORDER BY c.created_at DESC
      LIMIT 12
    `),
    pool.query(`
      SELECT c.id, c.code, c.name, c.description, c.discount_type, c.discount_value, c.min_order_total,
             r.id AS restaurant_id, r.display_name AS restaurant_name,
             (SELECT ma.file_url FROM media_assets ma WHERE ma.owner_type = 'restaurant' AND ma.owner_id = r.id AND ma.alt_text = 'logo' ORDER BY ma.created_at DESC LIMIT 1) AS restaurant_logo_url,
             (SELECT ma.file_url FROM media_assets ma WHERE ma.owner_type = 'restaurant' AND ma.owner_id = r.id AND ma.alt_text = 'banner' ORDER BY ma.created_at DESC LIMIT 1) AS restaurant_banner_url
      FROM coupons c
      JOIN coupon_restaurants cr ON cr.coupon_id = c.id
      JOIN restaurants r ON r.id = cr.restaurant_id
      WHERE c.is_active = true
        AND r.is_active = true
        AND r.status IN ('approved')
        AND (c.starts_at IS NULL OR c.starts_at <= now())
        AND (c.ends_at IS NULL OR c.ends_at >= now())
      ORDER BY c.created_at DESC
      LIMIT 12
    `)
  ]);

  return ok(res, {
    promotions: promotions.rows,
    coupons: coupons.rows,
    restaurantSpecials: restaurantSpecials.rows
  });
});

router.get('/restaurants/:restaurantId', async (req: Request, res: Response) => {
  const restaurantId = String(req.params.restaurantId);
  const [restaurant, categories, items] = await Promise.all([
    pool.query(`
      SELECT r.*, rl.city, rl.province, rl.address_line1, rl.delivery_radius_km,
             COALESCE(rrs.average_rating, 0) AS average_rating,
             COALESCE(rrs.review_count, 0) AS review_count,
             (SELECT ma.file_url FROM media_assets ma WHERE ma.owner_type = 'restaurant' AND ma.owner_id = r.id AND ma.alt_text = 'logo' ORDER BY ma.created_at DESC LIMIT 1) AS logo_url,
             (SELECT ma.file_url FROM media_assets ma WHERE ma.owner_type = 'restaurant' AND ma.owner_id = r.id AND ma.alt_text = 'banner' ORDER BY ma.created_at DESC LIMIT 1) AS banner_url
      FROM restaurants r
      LEFT JOIN restaurant_locations rl ON rl.restaurant_id = r.id AND rl.is_primary = true
      LEFT JOIN restaurant_rating_summary_view rrs ON rrs.restaurant_id = r.id
      WHERE r.id = $1 AND r.is_active = true AND r.status IN ('approved')
      LIMIT 1
    `, [restaurantId]),
    pool.query(`SELECT id, name, description, display_order FROM menu_categories WHERE restaurant_id = $1 AND is_active = true ORDER BY display_order, name`, [restaurantId]),
    pool.query(`SELECT id, category_id, name, description, image_url, base_price, currency, is_vegetarian, is_vegan, is_halal, display_order FROM menu_items WHERE restaurant_id = $1 AND is_active = true AND is_available = true ORDER BY display_order, name`, [restaurantId])
  ]);

  if (!restaurant.rows[0]) return fail(res, 404, 'Restaurant not found');
  return ok(res, { restaurant: restaurant.rows[0], categories: categories.rows, items: items.rows });
});

router.get('/cart', async (req: Request, res: Response) => {
  const customerUserId = userId(req);
  const cartResult = await pool.query(`
    SELECT c.*, r.display_name AS restaurant_name
    FROM carts c
    LEFT JOIN restaurants r ON r.id = c.restaurant_id
    WHERE c.customer_user_id = $1 AND c.status = 'active'
    ORDER BY c.updated_at DESC LIMIT 1
  `, [customerUserId]);

  const cart = cartResult.rows[0];
  if (!cart) return ok(res, null);

  const items = await pool.query(`
    SELECT id, menu_item_id, item_name, quantity, unit_price, line_total, item_snapshot
    FROM cart_items WHERE cart_id = $1 ORDER BY created_at DESC
  `, [cart.id]);
  return ok(res, { ...cart, items: items.rows });
});

router.post('/cart/items', async (req: Request, res: Response) => {
  const customerUserId = userId(req);
  const schema = z.object({ restaurantId: z.string().uuid(), menuItemId: z.string().uuid(), quantity: z.number().int().positive().default(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid cart item');

  const { restaurantId, menuItemId, quantity } = parsed.data;
  const itemResult = await pool.query(
    `SELECT id, restaurant_id, name, base_price, currency FROM menu_items WHERE id = $1 AND restaurant_id = $2 AND is_active = true AND is_available = true`,
    [menuItemId, restaurantId]
  );
  const item = itemResult.rows[0];
  if (!item) return fail(res, 404, 'Menu item not found');

  const cartId = await getOrCreateActiveCart(customerUserId, restaurantId);
  const existing = await pool.query(`SELECT id, quantity FROM cart_items WHERE cart_id = $1 AND menu_item_id = $2 LIMIT 1`, [cartId, menuItemId]);
  if (existing.rows[0]) {
    const newQuantity = Number(existing.rows[0].quantity) + quantity;
    await pool.query(`UPDATE cart_items SET quantity = $2, line_total = $3, updated_at = now() WHERE id = $1`, [existing.rows[0].id, newQuantity, (Number(item.base_price) * newQuantity).toFixed(2)]);
  } else {
    await pool.query(
      `INSERT INTO cart_items (cart_id, menu_item_id, item_name, quantity, unit_price, line_total, item_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [cartId, menuItemId, item.name, quantity, item.base_price, (Number(item.base_price) * quantity).toFixed(2), JSON.stringify(item)]
    );
  }
  await recalcCart(cartId);
  return ok(res, { cartId }, 'Item added to cart');
});

router.patch('/cart/items/:itemId', async (req: Request, res: Response) => {
  const customerUserId = userId(req);
  const schema = z.object({ quantity: z.number().int().positive() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid quantity');
  const itemId = String(req.params.itemId);
  const found = await pool.query(`
    SELECT ci.id, ci.unit_price, ci.cart_id
    FROM cart_items ci
    JOIN carts c ON c.id = ci.cart_id
    WHERE ci.id = $1 AND c.customer_user_id = $2 AND c.status = 'active'
  `, [itemId, customerUserId]);
  const item = found.rows[0];
  if (!item) return fail(res, 404, 'Cart item not found');
  await pool.query(`UPDATE cart_items SET quantity = $2, line_total = $3, updated_at = now() WHERE id = $1`, [itemId, parsed.data.quantity, (Number(item.unit_price) * parsed.data.quantity).toFixed(2)]);
  await recalcCart(item.cart_id);
  return ok(res, true, 'Cart item updated');
});

router.delete('/cart/items/:itemId', async (req: Request, res: Response) => {
  const customerUserId = userId(req);
  const itemId = String(req.params.itemId);
  const found = await pool.query(`
    SELECT ci.cart_id
    FROM cart_items ci
    JOIN carts c ON c.id = ci.cart_id
    WHERE ci.id = $1 AND c.customer_user_id = $2 AND c.status = 'active'
  `, [itemId, customerUserId]);
  const cartId = found.rows[0]?.cart_id as string | undefined;
  if (!cartId) return fail(res, 404, 'Cart item not found');
  await pool.query(`DELETE FROM cart_items WHERE id = $1`, [itemId]);
  await recalcCart(cartId);
  return ok(res, true, 'Cart item removed');
});

router.get('/addresses', async (req: Request, res: Response) => {
  const result = await pool.query(`SELECT id, label, address_line1, address_line2, suburb, city, province, postal_code, delivery_instructions, is_default, ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`, [userId(req)]);
  return ok(res, result.rows);
});

router.post('/addresses', async (req: Request, res: Response) => {
  const schema = z.object({
    label: z.string().min(2),
    addressLine1: z.string().optional().nullable(),
    suburb: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    province: z.string().optional().nullable(),
    addressLine2: z.string().optional().nullable(),
    postalCode: z.string().optional().nullable(),
    deliveryInstructions: z.string().max(500).optional().nullable(),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
    isDefault: z.boolean().default(false)
  }).superRefine((data, ctx) => {
    const hasCoordinates = data.latitude != null && data.longitude != null;
    if (!hasCoordinates && !String(data.addressLine1 || '').trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['addressLine1'], message: 'Address line 1 is required when no location pin is supplied' });
    }
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid address');
  const d = parsed.data;
  const latitude = d.latitude ?? -25.4745;
  const longitude = d.longitude ?? 30.9703;
  const addressLine1 = String(d.addressLine1 || '').trim() || 'Pinned location';
  const city = String(d.city || '').trim() || 'Current location';
  const province = String(d.province || '').trim() || 'GP';
  const result = await pool.query(
    `INSERT INTO user_addresses (user_id, address_type, label, address_line1, address_line2, suburb, city, province, postal_code, country, location, delivery_instructions, is_default)
     VALUES ($1, 'home', $2, $3, $4, $5, $6, $7, $8, 'ZA', ST_SetSRID(ST_MakePoint($9, $10),4326)::geography, $11, $12)
     RETURNING *`,
    [userId(req), d.label, addressLine1, d.addressLine2 ?? null, d.suburb ?? null, city, province, d.postalCode ?? null, longitude, latitude, d.deliveryInstructions ?? null, d.isDefault]
  );
  return ok(res, result.rows[0], 'Address saved');
});

router.post('/checkout', async (req: Request, res: Response) => {
  const customerUserId = userId(req);
  const schema = z.object({
    orderType: z.enum(['delivery', 'pickup']).default('delivery'),
    addressId: z.string().uuid().optional().nullable(),
    specialInstructions: z.string().optional().nullable(),
    tipAmount: z.number().nonnegative().default(0),
    paymentMethod: z.enum(['card','saved_card','cash_on_delivery','eft_bank_transfer']).default('card'),
    paymentMethodId: z.string().uuid().optional().nullable(),
    bankTransferReference: z.string().max(120).optional().nullable(),
    demoCard: z.object({
      cardholderName: z.string().min(2).max(120),
      cardNumberLast4: z.string().regex(/^\d{4}$/),
      expiryMonth: z.number().int().min(1).max(12),
      expiryYear: z.number().int().min(new Date().getFullYear()).max(new Date().getFullYear() + 20),
      brand: z.string().min(2).max(40)
    }).optional().nullable()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid checkout request');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cartResult = await client.query(`SELECT * FROM carts WHERE customer_user_id = $1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`, [customerUserId]);
    const cart = cartResult.rows[0];
    if (!cart) throw new Error('No active cart');
    const cartItems = await client.query(`SELECT * FROM cart_items WHERE cart_id = $1 ORDER BY created_at`, [cart.id]);
    if (!cartItems.rowCount) throw new Error('Cart is empty');

    let addressId = parsed.data.addressId ?? null;
    if (parsed.data.orderType === 'delivery' && !addressId) {
      const defaultAddress = await client.query(`SELECT id FROM user_addresses WHERE user_id = $1 AND is_default = true ORDER BY updated_at DESC LIMIT 1`, [customerUserId]);
      addressId = defaultAddress.rows[0]?.id ?? null;
    }

    const serviceFee = Number(cart.subtotal_amount) > 0 ? 5 : 0;
    const deliveryFee = parsed.data.orderType === 'delivery' ? 20 : 0;
    const taxAmount = Number(((Number(cart.subtotal_amount) + serviceFee + deliveryFee + parsed.data.tipAmount) * 0.15).toFixed(2));
    const totalAmount = Number((Number(cart.subtotal_amount) + serviceFee + deliveryFee + parsed.data.tipAmount + taxAmount).toFixed(2));

    const orderInsert = await client.query(
      `INSERT INTO orders (
        customer_user_id, restaurant_id, restaurant_location_id, order_type, status, delivery_address_id,
        special_instructions, subtotal_amount, service_fee_amount, delivery_fee_amount, tip_amount, tax_amount, total_amount, currency, placed_at
      ) VALUES ($1,$2,$3,$4,'placed',$5,$6,$7,$8,$9,$10,$11,$12,$13,now()) RETURNING *`,
      [customerUserId, cart.restaurant_id, cart.restaurant_location_id, parsed.data.orderType, addressId, parsed.data.specialInstructions ?? null, cart.subtotal_amount, serviceFee, deliveryFee, parsed.data.tipAmount, taxAmount, totalAmount, cart.currency]
    );
    const order = orderInsert.rows[0];

    for (const item of cartItems.rows) {
      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, unit_price, base_total, line_total, item_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [order.id, item.menu_item_id, item.item_name, item.quantity, item.unit_price, item.line_total, item.line_total, JSON.stringify(item.item_snapshot)]
      );
    }

    await client.query(`INSERT INTO order_events (order_id, status, actor_type, event_name, notes) VALUES ($1, 'placed', 'customer', 'order_placed', 'Order placed by customer')`, [order.id]);

    if (parsed.data.orderType === 'delivery') {
      await client.query(
        `INSERT INTO deliveries (order_id, status, pickup_eta_mins, dropoff_eta_mins, driver_payout_estimate)
         VALUES ($1, 'awaiting_dispatch', 15, 25, 35.00)`,
        [order.id]
      );
    }

    let paymentProvider = 'platform_pay';
    let paymentStatus = 'captured';
    let capturedAtClause = 'now()';
    let paymentMethodId = parsed.data.paymentMethodId ?? null;

    if (parsed.data.paymentMethod === 'cash_on_delivery') {
      paymentProvider = 'cash_on_delivery';
      paymentStatus = 'initiated';
      capturedAtClause = 'NULL';
      paymentMethodId = null;
    } else if (parsed.data.paymentMethod === 'eft_bank_transfer') {
      paymentProvider = 'eft_bank_transfer';
      paymentStatus = 'authorized';
      capturedAtClause = 'NULL';
      paymentMethodId = null;
    } else if (parsed.data.paymentMethod === 'saved_card') {
      const savedMethod = await client.query(`SELECT id FROM payment_methods WHERE id = $1 AND user_id = $2 AND is_active = true LIMIT 1`, [paymentMethodId, customerUserId]);
      if (!savedMethod.rows[0]) throw new Error('Saved card not found');
      paymentProvider = 'saved_card';
    } else {
      paymentMethodId = null;
    }

    const paymentInsert = await client.query(
      `INSERT INTO payments (order_id, payment_method_id, provider, amount, currency, status, captured_at, authorized_at)
       VALUES ($1, $2, $3, $4, $5, $6::payment_status, ${capturedAtClause}, CASE WHEN $6::payment_status = 'authorized'::payment_status THEN now() ELSE NULL END)
       RETURNING *`,
      [order.id, paymentMethodId, paymentProvider, totalAmount, cart.currency, paymentStatus]
    );

    await client.query(
      `INSERT INTO payment_attempts (payment_id, attempt_no, provider, amount, status, request_payload, response_payload, finished_at)
       VALUES ($1, 1, $2, $3, $4, $5::jsonb, $6::jsonb, now())`,
      [
        paymentInsert.rows[0].id,
        paymentProvider,
        totalAmount,
        paymentStatus === 'captured' ? 'succeeded' : 'pending',
        JSON.stringify({ orderId: order.id, checkoutMethod: parsed.data.paymentMethod, demoCard: parsed.data.demoCard ?? null }),
        JSON.stringify({ bankTransferReference: parsed.data.bankTransferReference ?? null, status: paymentStatus })
      ]
    );

    await client.query(`UPDATE carts SET status = 'converted', converted_order_id = $2, updated_at = now() WHERE id = $1`, [cart.id, order.id]);
    await client.query('COMMIT');
    emitToRestaurant(order.restaurant_id, 'order:created', { orderId: order.id, status: order.status, orderType: order.order_type, placedAt: order.placed_at });
    return ok(res, { ...order, payment_method: parsed.data.paymentMethod, payment_status: paymentStatus }, 'Order placed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    return fail(res, 400, error instanceof Error ? error.message : 'Checkout failed');
  } finally {
    client.release();
  }
});

router.get('/orders', async (req: Request, res: Response) => {
  const customerUserId = userId(req);
  const result = await pool.query(`
    SELECT o.id, o.status, o.order_type, o.total_amount, o.currency, o.placed_at, o.completed_at,
           r.display_name AS restaurant_name,
           d.status AS delivery_status,
           u.full_name AS driver_name,
           dv.registration_number AS vehicle_registration
    FROM orders o
    JOIN restaurants r ON r.id = o.restaurant_id
    LEFT JOIN deliveries d ON d.order_id = o.id
    LEFT JOIN users u ON u.id = d.current_driver_user_id
    LEFT JOIN LATERAL (
      SELECT registration_number
      FROM driver_vehicles
      WHERE driver_user_id = d.current_driver_user_id
      ORDER BY is_primary DESC, created_at DESC
      LIMIT 1
    ) dv ON true
    WHERE o.customer_user_id = $1
    ORDER BY o.placed_at DESC
  `, [customerUserId]);
  return ok(res, result.rows);
});

router.get('/orders/:orderId/tracking', async (req: Request, res: Response) => {
  const customerUserId = userId(req);
  const orderId = String(req.params.orderId);
  const orderResult = await pool.query(`
    SELECT o.id, o.status, o.order_type, o.total_amount, o.currency, o.placed_at, o.special_instructions,
           r.display_name AS restaurant_name,
           d.id AS delivery_id, d.status AS delivery_status, d.pickup_eta_mins, d.dropoff_eta_mins, d.current_driver_user_id,
           u.full_name AS driver_name, u.phone AS driver_phone,
           dv.registration_number AS vehicle_registration,
           ma.file_url AS driver_image_url
    FROM orders o
    JOIN restaurants r ON r.id = o.restaurant_id
    LEFT JOIN deliveries d ON d.order_id = o.id
    LEFT JOIN users u ON u.id = d.current_driver_user_id
    LEFT JOIN LATERAL (
      SELECT registration_number
      FROM driver_vehicles
      WHERE driver_user_id = d.current_driver_user_id
      ORDER BY is_primary DESC, created_at DESC
      LIMIT 1
    ) dv ON true
    LEFT JOIN LATERAL (
      SELECT file_url
      FROM media_assets
      WHERE owner_type = 'user' AND owner_id = d.current_driver_user_id AND alt_text = 'profile'
      ORDER BY created_at DESC
      LIMIT 1
    ) ma ON true
    WHERE o.id = $1 AND o.customer_user_id = $2
    LIMIT 1
  `, [orderId, customerUserId]);
  const order = orderResult.rows[0];
  if (!order) return fail(res, 404, 'Order not found');

  const [events, latestLocation, chatSummary, routeInfo] = await Promise.all([
    pool.query(`SELECT status, notes, created_at FROM order_events WHERE order_id = $1 ORDER BY created_at DESC LIMIT 20`, [orderId]),
    order.current_driver_user_id ? pool.query(`SELECT ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude, speed_kph, heading_deg, accuracy_m, recorded_at FROM driver_location_history_default WHERE driver_user_id = $1 ORDER BY recorded_at DESC LIMIT 1`, [order.current_driver_user_id]) : Promise.resolve({ rows: [] as any[] }),
    pool.query(`SELECT COUNT(*)::int AS message_count, MAX(created_at) AS last_message_at FROM order_chat_messages WHERE order_id = $1`, [orderId]),
    pool.query(`SELECT ST_Y(rl.location::geometry) AS restaurant_latitude, ST_X(rl.location::geometry) AS restaurant_longitude, ST_Y(ua.location::geometry) AS dropoff_latitude, ST_X(ua.location::geometry) AS dropoff_longitude FROM orders o LEFT JOIN restaurant_locations rl ON rl.id = o.restaurant_location_id LEFT JOIN user_addresses ua ON ua.id = o.delivery_address_id WHERE o.id = $1 LIMIT 1`, [orderId])
  ]);

  return ok(res, {
    order,
    driverLocation: latestLocation.rows[0] ?? null,
    pickupLocation: routeInfo.rows[0]?.restaurant_latitude != null ? { latitude: Number(routeInfo.rows[0].restaurant_latitude), longitude: Number(routeInfo.rows[0].restaurant_longitude) } : null,
    dropoffLocation: routeInfo.rows[0]?.dropoff_latitude != null ? { latitude: Number(routeInfo.rows[0].dropoff_latitude), longitude: Number(routeInfo.rows[0].dropoff_longitude) } : null,
    orderEvents: events.rows.reverse(),
    chatSummary: chatSummary.rows[0] ?? { message_count: 0, last_message_at: null }
  });
});


router.post('/orders/:orderId/cancel', async (req: Request, res: Response) => {
  const customerUserId = userId(req);
  const orderId = String(req.params.orderId);
  const parsed = z.object({ reason: z.string().min(3).max(300), details: z.string().max(600).optional().nullable() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message || 'Invalid cancellation request');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderRes = await client.query(`
      SELECT o.id, o.status, o.restaurant_id, d.id AS delivery_id, d.status AS delivery_status
      FROM orders o
      LEFT JOIN deliveries d ON d.order_id = o.id
      WHERE o.id = $1 AND o.customer_user_id = $2
      FOR UPDATE OF o
    `, [orderId, customerUserId]);
    const order = orderRes.rows[0];
    if (!order) throw new Error('Order not found');
    if (['delivered','cancelled','refunded'].includes(order.status)) throw new Error('This order can no longer be cancelled');
    if (['picked_up','out_for_delivery'].includes(order.status) || ['picked_up','en_route_to_dropoff','arrived_at_dropoff','delivered'].includes(order.delivery_status || '')) {
      throw new Error('This order is already in delivery and can no longer be cancelled from the customer side');
    }

    const nextStatus = ['placed','draft'].includes(order.status) ? 'cancelled' : 'refund_pending';
    await client.query(`UPDATE orders SET status = $2, updated_at = now() WHERE id = $1`, [orderId, nextStatus]);
    if (order.delivery_id) {
      await client.query(`UPDATE deliveries SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1`, [order.delivery_id]);
    }
    await client.query(`
      INSERT INTO order_events (order_id, status, actor_type, actor_user_id, event_name, notes, metadata)
      VALUES ($1, $2, 'customer', $3, 'customer_cancelled', $4, $5::jsonb)
    `, [orderId, nextStatus, customerUserId, parsed.data.reason, JSON.stringify({ reason: parsed.data.reason, details: parsed.data.details ?? null })]);
    const staff = await client.query(`SELECT user_id FROM restaurant_memberships WHERE restaurant_id = $1 AND status = 'active' ORDER BY created_at LIMIT 1`, [order.restaurant_id]);
    await client.query('COMMIT');

    emitToOrder(orderId, 'order:status_changed', { orderId, status: nextStatus, source: 'customer', reason: parsed.data.reason });
    if (staff.rows[0]?.user_id) {
      emitToUser(staff.rows[0].user_id, 'order:status_changed', { orderId, status: nextStatus, source: 'customer', reason: parsed.data.reason });
      await sendPushNotification({ userId: staff.rows[0].user_id, title: 'Order cancellation', body: `Customer requested cancellation: ${parsed.data.reason}`, data: { orderId, type: 'order_status' } });
    }
    return ok(res, { orderId, status: nextStatus }, nextStatus === 'cancelled' ? 'Order cancelled' : 'Cancellation request submitted');
  } catch (error) {
    await client.query('ROLLBACK');
    return fail(res, 400, error instanceof Error ? error.message : 'Cancellation failed');
  } finally {
    client.release();
  }
});

router.post('/orders/:orderId/reviews', async (req: Request, res: Response) => {
  const customerUserId = userId(req);
  const orderId = String(req.params.orderId);
  const parsed = z.object({ target: z.enum(['restaurant', 'driver']), rating: z.number().min(1).max(5), reviewText: z.string().max(1000).optional().nullable() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message || 'Invalid review');

  const delivered = await pool.query(`
    SELECT o.id, o.restaurant_id, d.current_driver_user_id
    FROM orders o
    LEFT JOIN deliveries d ON d.order_id = o.id
    WHERE o.id = $1 AND o.customer_user_id = $2 AND o.status = 'delivered'
    LIMIT 1
  `, [orderId, customerUserId]);
  const record = delivered.rows[0];
  if (!record) return fail(res, 400, 'Only delivered orders can be reviewed');

  if (parsed.data.target === 'restaurant') {
    const result = await pool.query(`INSERT INTO restaurant_reviews (restaurant_id, customer_user_id, order_id, rating, review_text, status) VALUES ($1, $2, $3, $4, $5, 'visible') RETURNING *`, [record.restaurant_id, customerUserId, orderId, parsed.data.rating, parsed.data.reviewText ?? null]);
    return ok(res, result.rows[0], 'Restaurant review added');
  }
  if (!record.current_driver_user_id) return fail(res, 400, 'No driver assigned to this order');
  const result = await pool.query(`INSERT INTO driver_reviews (driver_user_id, customer_user_id, order_id, rating, review_text, status) VALUES ($1, $2, $3, $4, $5, 'visible') RETURNING *`, [record.current_driver_user_id, customerUserId, orderId, parsed.data.rating, parsed.data.reviewText ?? null]);
  return ok(res, result.rows[0], 'Driver review added');
});

router.get('/support/tickets', async (req: Request, res: Response) => {
  const customerUserId = userId(req);
  const result = await pool.query(`SELECT id, ticket_number, subject, priority, status, created_at, updated_at FROM support_tickets WHERE customer_user_id = $1 ORDER BY created_at DESC`, [customerUserId]);
  return ok(res, result.rows);
});

router.post('/support/tickets', async (req: Request, res: Response) => {
  const customerUserId = userId(req);
  const parsed = z.object({ subject: z.string().min(4), message: z.string().min(4), priority: z.enum(['low','normal','high','critical']).default('normal'), orderId: z.string().uuid().optional().nullable() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message || 'Invalid ticket');
  const ticket = await pool.query(`INSERT INTO support_tickets (customer_user_id, order_id, subject, description, priority, status) VALUES ($1, $2, $3, $4, $5, 'open') RETURNING *`, [customerUserId, parsed.data.orderId ?? null, parsed.data.subject, parsed.data.message, parsed.data.priority]);
  await pool.query(`INSERT INTO support_ticket_messages (ticket_id, sender_user_id, message, is_internal) VALUES ($1, $2, $3, false)`, [ticket.rows[0].id, customerUserId, parsed.data.message]);
  return ok(res, ticket.rows[0], 'Support ticket created');
});

export default router;
