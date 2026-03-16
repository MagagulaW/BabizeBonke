import { Router } from 'express';
import { imageUpload, publicFileUrl } from '../utils/uploads.js';
import { fail, ok } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/public-image', imageUpload.single('image'), async (req, res) => {
  if (!req.file) return fail(res, 400, 'Image file is required');
  return ok(res, {
    url: publicFileUrl(req, req.file.path),
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size
  }, 'Image uploaded');
});

router.post('/image', requireAuth, imageUpload.single('image'), async (req, res) => {
  if (!req.file) return fail(res, 400, 'Image file is required');
  return ok(res, {
    url: publicFileUrl(req, req.file.path),
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    uploadedByUserId: req.user?.userId ?? null
  }, 'Image uploaded');
});

export default router;
