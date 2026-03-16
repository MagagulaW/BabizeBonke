import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { fail, ok } from '../utils/http.js';
import { registerPushToken } from '../services/notifications.service.js';

const router = Router();
router.use(requireAuth);

router.post('/devices/register', async (req, res) => {
  const parsed = z.object({ pushToken: z.string().min(8), platform: z.string().optional().nullable() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid push token');
  await registerPushToken(String(req.user?.userId), parsed.data.pushToken, parsed.data.platform ?? null);
  return ok(res, true, 'Device registered');
});

export default router;
