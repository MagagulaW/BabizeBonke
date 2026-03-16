import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';

export async function login(email: string, password: string) {
  const userResult = await pool.query(
    `SELECT id, email, password_hash, full_name, status, is_active
     FROM users
     WHERE lower(email) = lower($1)
     LIMIT 1`,
    [email.trim().toLowerCase()]
  );

  const user = userResult.rows[0];
  if (!user) return null;
  if (!user.is_active || user.status === 'disabled' || user.status === 'suspended') return null;

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) return null;

  const rolesResult = await pool.query(`SELECT role_code FROM user_roles WHERE user_id = $1`, [user.id]);
  const membershipsResult = await pool.query(
    `SELECT restaurant_id FROM restaurant_memberships WHERE user_id = $1 AND status = 'active'`,
    [user.id]
  );

  const roles = rolesResult.rows.map((row: { role_code: string }) => row.role_code);
  const restaurantIds = membershipsResult.rows.map((row: { restaurant_id: string }) => row.restaurant_id);

  const token = jwt.sign({ userId: user.id, email: user.email, roles, restaurantIds }, env.jwtSecret, { expiresIn: '12h' });

  await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      roles,
      restaurantIds
    }
  };
}
