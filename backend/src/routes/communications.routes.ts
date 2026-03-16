import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { fail, ok } from '../utils/http.js';
import { emitToOrder, emitToUser } from '../realtime.js';
import { sendPushNotification } from '../services/notifications.service.js';

const router = Router();
router.use(requireAuth);

async function resolveOrderAccess(orderId: string, userId: string) {
  const result = await pool.query(`
    SELECT o.id, o.customer_user_id, d.current_driver_user_id,
           u_customer.full_name AS customer_name, u_customer.phone AS customer_phone,
           u_driver.full_name AS driver_name, u_driver.phone AS driver_phone,
           r.display_name AS restaurant_name
    FROM orders o
    LEFT JOIN deliveries d ON d.order_id = o.id
    LEFT JOIN users u_customer ON u_customer.id = o.customer_user_id
    LEFT JOIN users u_driver ON u_driver.id = d.current_driver_user_id
    JOIN restaurants r ON r.id = o.restaurant_id
    WHERE o.id = $1
    LIMIT 1
  `, [orderId]);
  const order = result.rows[0];
  if (!order) return { allowed: false as const, order: null };
  const allowed = [order.customer_user_id, order.current_driver_user_id].includes(userId);
  return { allowed, order };
}

router.get('/orders/:orderId/chat', async (req, res) => {
  const orderId = String(req.params.orderId);
  const userId = String(req.user?.userId);
  const access = await resolveOrderAccess(orderId, userId);
  if (!access.allowed) return fail(res, 403, 'Forbidden');

  const messages = await pool.query(`
    SELECT m.id, m.order_id, m.sender_user_id, m.message_body, m.message_type, m.created_at,
           u.full_name AS sender_name
    FROM order_chat_messages m
    JOIN users u ON u.id = m.sender_user_id
    WHERE m.order_id = $1
    ORDER BY m.created_at ASC
    LIMIT 200
  `, [orderId]);

  return ok(res, {
    contact: {
      customerName: access.order.customer_name,
      customerPhone: access.order.customer_phone,
      driverName: access.order.driver_name,
      driverPhone: access.order.driver_phone,
      restaurantName: access.order.restaurant_name
    },
    messages: messages.rows
  });
});

router.post('/orders/:orderId/chat', async (req, res) => {
  const orderId = String(req.params.orderId);
  const userId = String(req.user?.userId);
  const access = await resolveOrderAccess(orderId, userId);
  if (!access.allowed) return fail(res, 403, 'Forbidden');

  const parsed = z.object({ message: z.string().min(1).max(2000) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid message');

  const result = await pool.query(`
    INSERT INTO order_chat_messages (order_id, sender_user_id, message_body, message_type)
    VALUES ($1, $2, $3, 'text')
    RETURNING *
  `, [orderId, userId, parsed.data.message.trim()]);

  const payload = { orderId, message: result.rows[0] };
  emitToOrder(orderId, 'chat:new_message', payload);
  const targetUserId = access.order.customer_user_id === userId ? access.order.current_driver_user_id : access.order.customer_user_id;
  if (targetUserId) {
    emitToUser(targetUserId, 'chat:new_message', payload);
    await sendPushNotification({ userId: targetUserId, title: 'New order message', body: parsed.data.message.trim().slice(0, 120), data: { orderId, type: 'chat' } });
  }

  return ok(res, result.rows[0], 'Message sent');
});

router.get('/orders/:orderId/call/active', async (req, res) => {
  const orderId = String(req.params.orderId);
  const userId = String(req.user?.userId);
  const access = await resolveOrderAccess(orderId, userId);
  if (!access.allowed) return fail(res, 403, 'Forbidden');

  const result = await pool.query(`
    SELECT * FROM call_sessions
    WHERE order_id = $1 AND status IN ('requested','ringing','connected')
    ORDER BY created_at DESC
    LIMIT 1
  `, [orderId]);
  return ok(res, result.rows[0] ?? null);
});

router.post('/orders/:orderId/call/start', async (req, res) => {
  const orderId = String(req.params.orderId);
  const callerUserId = String(req.user?.userId);
  const access = await resolveOrderAccess(orderId, callerUserId);
  if (!access.allowed) return fail(res, 403, 'Forbidden');
  const targetUserId = access.order.customer_user_id === callerUserId ? access.order.current_driver_user_id : access.order.customer_user_id;
  if (!targetUserId) return fail(res, 400, 'No target user is assigned yet');

  await pool.query(`UPDATE call_sessions SET status = 'ended', ended_at = now(), updated_at = now() WHERE order_id = $1 AND status IN ('requested','ringing','connected')`, [orderId]);
  const created = await pool.query(`
    INSERT INTO call_sessions (order_id, caller_user_id, callee_user_id, status, requested_at)
    VALUES ($1, $2, $3, 'requested', now())
    RETURNING *
  `, [orderId, callerUserId, targetUserId]);

  emitToOrder(orderId, 'call:started', created.rows[0]);
  emitToUser(targetUserId, 'call:started', created.rows[0]);
  await sendPushNotification({ userId: targetUserId, title: 'Incoming call', body: 'You have an in-app call for an active order.', data: { orderId, callId: created.rows[0].id, type: 'call' } });
  return ok(res, created.rows[0], 'Call started');
});

router.post('/calls/:callId/offer', async (req, res) => {
  const callId = String(req.params.callId);
  const userId = String(req.user?.userId);
  const parsed = z.object({ sdp: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid offer');
  const result = await pool.query(`
    UPDATE call_sessions
    SET offer_sdp = $2, status = 'ringing', updated_at = now()
    WHERE id = $1 AND caller_user_id = $3
    RETURNING *
  `, [callId, parsed.data.sdp, userId]);
  if (!result.rowCount) return fail(res, 404, 'Call not found');
  emitToOrder(result.rows[0].order_id, 'call:updated', result.rows[0]);
  emitToUser(result.rows[0].callee_user_id, 'call:updated', result.rows[0]);
  return ok(res, result.rows[0], 'Offer saved');
});

router.post('/calls/:callId/answer', async (req, res) => {
  const callId = String(req.params.callId);
  const userId = String(req.user?.userId);
  const parsed = z.object({ sdp: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid answer');
  const result = await pool.query(`
    UPDATE call_sessions
    SET answer_sdp = $2, status = 'connected', answered_at = now(), connected_at = now(), updated_at = now()
    WHERE id = $1 AND callee_user_id = $3
    RETURNING *
  `, [callId, parsed.data.sdp, userId]);
  if (!result.rowCount) return fail(res, 404, 'Call not found');
  emitToOrder(result.rows[0].order_id, 'call:updated', result.rows[0]);
  emitToUser(result.rows[0].caller_user_id, 'call:updated', result.rows[0]);
  return ok(res, result.rows[0], 'Answer saved');
});

router.post('/calls/:callId/candidate', async (req, res) => {
  const callId = String(req.params.callId);
  const userId = String(req.user?.userId);
  const parsed = z.object({ candidate: z.any() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid candidate');

  const current = await pool.query(`SELECT * FROM call_sessions WHERE id = $1 LIMIT 1`, [callId]);
  const call = current.rows[0];
  if (!call) return fail(res, 404, 'Call not found');
  if (![call.caller_user_id, call.callee_user_id].includes(userId)) return fail(res, 403, 'Forbidden');
  const field = call.caller_user_id === userId ? 'caller_ice_candidates' : 'callee_ice_candidates';
  const updated = await pool.query(`
    UPDATE call_sessions
    SET ${field} = COALESCE(${field}, '[]'::jsonb) || $2::jsonb, updated_at = now()
    WHERE id = $1
    RETURNING *
  `, [callId, JSON.stringify([parsed.data.candidate])]);
  emitToOrder(updated.rows[0].order_id, 'call:updated', updated.rows[0]);
  return ok(res, updated.rows[0], 'Candidate saved');
});

router.get('/calls/:callId', async (req, res) => {
  const callId = String(req.params.callId);
  const userId = String(req.user?.userId);
  const result = await pool.query(`SELECT * FROM call_sessions WHERE id = $1 LIMIT 1`, [callId]);
  const call = result.rows[0];
  if (!call) return fail(res, 404, 'Call not found');
  if (![call.caller_user_id, call.callee_user_id].includes(userId)) return fail(res, 403, 'Forbidden');
  return ok(res, call);
});

router.post('/calls/:callId/end', async (req, res) => {
  const callId = String(req.params.callId);
  const userId = String(req.user?.userId);
  const result = await pool.query(`
    UPDATE call_sessions
    SET status = 'ended', ended_at = now(), updated_at = now()
    WHERE id = $1 AND ($2 IN (caller_user_id, callee_user_id))
    RETURNING *
  `, [callId, userId]);
  if (!result.rowCount) return fail(res, 404, 'Call not found');
  emitToOrder(result.rows[0].order_id, 'call:ended', result.rows[0]);
  return ok(res, result.rows[0], 'Call ended');
});

export default router;
