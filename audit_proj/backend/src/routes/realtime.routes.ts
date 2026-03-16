import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ok } from '../utils/http.js';
import { env } from '../config/env.js';

const router = Router();
router.use(requireAuth);

router.get('/config', async (_req, res) => {
  return ok(res, {
    socketUrl: env.socketOrigin.replace(/\/$/, ''),
    turn: {
      urls: env.turnUrls,
      username: env.turnUsername,
      credential: env.turnCredential
    }
  });
});

export default router;
