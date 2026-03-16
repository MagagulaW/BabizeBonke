import { Router } from 'express';
import { pool } from '../db/pool.js';
import { ok } from '../utils/http.js';

const router = Router();

router.get('/storefront', async (_req, res) => {
  const [featuredRestaurants, promotions] = await Promise.all([
    pool.query(`
      SELECT r.id, r.display_name, r.description, (SELECT ma.file_url FROM media_assets ma WHERE ma.owner_type = 'restaurant' AND ma.owner_id = r.id AND ma.alt_text = 'logo' ORDER BY ma.created_at DESC LIMIT 1) AS logo_url,
             (SELECT ma.file_url FROM media_assets ma WHERE ma.owner_type = 'restaurant' AND ma.owner_id = r.id AND ma.alt_text = 'banner' ORDER BY ma.created_at DESC LIMIT 1) AS banner_url,
             COALESCE(AVG(rr.rating), 4.6)::numeric(4,2) AS average_rating,
             COUNT(rr.id)::int AS review_count,
             rl.city, rl.province
      FROM restaurants r
      LEFT JOIN restaurant_locations rl ON rl.restaurant_id = r.id AND rl.is_primary = true
      LEFT JOIN restaurant_reviews rr ON rr.restaurant_id = r.id AND rr.status = 'visible'
      WHERE r.is_active = true AND r.status IN ('approved')
      GROUP BY r.id, rl.city, rl.province
      ORDER BY COUNT(rr.id) DESC, r.updated_at DESC
      LIMIT 6
    `),
    pool.query(`
      SELECT id, title, description, banner_image_url
      FROM promotions
      WHERE is_active = true AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at >= now())
      ORDER BY priority DESC, created_at DESC
      LIMIT 3
    `)
  ]);

  res.json({ success: true, data: { featuredRestaurants: featuredRestaurants.rows, promotions: promotions.rows } });
});

export default router;
