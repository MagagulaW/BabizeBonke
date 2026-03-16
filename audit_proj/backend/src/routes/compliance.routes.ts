import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { fail, ok } from '../utils/http.js';
import { documentUpload, publicFileUrl } from '../utils/uploads.js';

const router = Router();
router.use(requireAuth);

router.post('/driver/documents', requireRoles(['driver','platform_admin']), documentUpload.single('document'), async (req, res) => {
  if (!req.file) return fail(res, 400, 'Document is required');
  const parsed = z.object({ documentType: z.string().min(2), documentNumber: z.string().optional().nullable(), expiresAt: z.string().optional().nullable() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid driver document');
  const fileUrl = publicFileUrl(req, req.file.path);
  const result = await pool.query(
    `INSERT INTO driver_documents (driver_user_id, document_type, document_number, file_url, mime_type, original_name, expires_at, verification_status, uploaded_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$1) RETURNING *`,
    [req.user?.userId, parsed.data.documentType, parsed.data.documentNumber ?? null, fileUrl, req.file.mimetype, req.file.originalname, parsed.data.expiresAt || null]
  );
  return ok(res, result.rows[0], 'Driver document uploaded');
});

router.post('/restaurant/kyc', requireRoles(['restaurant_owner','restaurant_manager','platform_admin']), documentUpload.single('document'), async (req, res) => {
  if (!req.file) return fail(res, 400, 'Document is required');
  const parsed = z.object({ restaurantId: z.string().uuid(), documentType: z.string().min(2), registrationNumber: z.string().optional().nullable(), expiresAt: z.string().optional().nullable() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Invalid KYC document');
  const membership = (req.user?.restaurantIds || []).includes(parsed.data.restaurantId) || (req.user?.roles || []).includes('platform_admin');
  if (!membership) return fail(res, 403, 'Forbidden');
  const fileUrl = publicFileUrl(req, req.file.path);
  const result = await pool.query(
    `INSERT INTO restaurant_kyc_documents (restaurant_id, document_type, registration_number, file_url, mime_type, original_name, expires_at, verification_status, uploaded_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8) RETURNING *`,
    [parsed.data.restaurantId, parsed.data.documentType, parsed.data.registrationNumber ?? null, fileUrl, req.file.mimetype, req.file.originalname, parsed.data.expiresAt || null, req.user?.userId]
  );
  return ok(res, result.rows[0], 'Restaurant KYC uploaded');
});

export default router;
