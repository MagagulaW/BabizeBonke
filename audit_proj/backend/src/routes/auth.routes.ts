import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { login } from '../services/auth.service.js';
import { fail, ok } from '../utils/http.js';
const router = Router();
function normalizeEmail(value) {
    return value.trim().toLowerCase();
}
function normalizePhone(value) {
    return value.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
}
function isStrongPassword(value) {
    return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,64}$/.test(value);
}
function assertStrongPassword(value) {
    if (!isStrongPassword(value)) {
        throw new Error('Password must be 8+ characters and include uppercase, lowercase, number, and symbol');
    }
}
function assertInternationalPhone(value, fieldName = 'Phone number') {
    if (!/^\+[1-9]\d{7,14}$/.test(value)) {
        throw new Error(`${fieldName} must include a valid country code, for example +27821234567`);
    }
}
async function assertUserIdentityAvailable(client, email, phone) {
    const checks = phone
        ? await client.query(`SELECT email, phone FROM users WHERE lower(email) = lower($1) OR phone = $2 LIMIT 1`, [email, phone])
        : await client.query(`SELECT email, phone FROM users WHERE lower(email) = lower($1) LIMIT 1`, [email]);
    const existing = checks.rows[0];
    if (!existing)
        return;
    if (existing.email?.toLowerCase() === email.toLowerCase())
        throw new Error('Email already registered');
    if (phone && existing.phone === phone)
        throw new Error('Phone number already registered');
    throw new Error('Account identity already registered');
}
async function buildSessionForUser(userId) {
    const userResult = await pool.query(`SELECT u.id, u.email, u.full_name, (SELECT ma.file_url FROM media_assets ma WHERE ma.owner_type = 'user' AND ma.owner_id = u.id AND ma.alt_text = 'profile' ORDER BY ma.created_at DESC LIMIT 1) AS profile_image_url FROM users u WHERE u.id = $1 LIMIT 1`, [userId]);
    const user = userResult.rows[0];
    if (!user)
        throw new Error('User not found after registration');
    const rolesResult = await pool.query(`SELECT role_code FROM user_roles WHERE user_id = $1`, [user.id]);
    const membershipsResult = await pool.query(`SELECT restaurant_id FROM restaurant_memberships WHERE user_id = $1 AND status = 'active'`, [user.id]);
    const roles = rolesResult.rows.map((row) => row.role_code);
    const restaurantIds = membershipsResult.rows.map((row) => row.restaurant_id);
    const token = jwt.sign({ userId: user.id, email: user.email, roles, restaurantIds }, env.jwtSecret, { expiresIn: '12h' });
    return {
        token,
        user: {
            id: user.id,
            email: user.email,
            fullName: user.full_name,
            profileImageUrl: user.profile_image_url || null,
            roles,
            restaurantIds
        }
    };
}
router.post('/login', async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password)
        return fail(res, 400, 'Email and password are required');
    const session = await login(normalizeEmail(String(email)), String(password));
    if (!session)
        return fail(res, 401, 'Invalid credentials');
    return ok(res, session, 'Logged in');
});
router.get('/me', requireAuth, async (req, res) => {
    const result = await pool.query(`SELECT id, email, full_name, status, is_active, last_login_at FROM users WHERE id = $1 LIMIT 1`, [req.user?.userId]);
    if (!result.rows[0])
        return fail(res, 404, 'User not found');
    return ok(res, { ...result.rows[0], roles: req.user?.roles ?? [], restaurantIds: req.user?.restaurantIds ?? [] });
});
router.get('/profile', requireAuth, async (req, res) => {
    const result = await pool.query(`SELECT u.id, u.email, u.full_name, u.phone, (SELECT ma.file_url FROM media_assets ma WHERE ma.owner_type = 'user' AND ma.owner_id = u.id AND ma.alt_text = 'profile' ORDER BY ma.created_at DESC LIMIT 1) AS profile_image_url FROM users u WHERE u.id = $1 LIMIT 1`, [req.user?.userId]);
    if (!result.rows[0])
        return fail(res, 404, 'User not found');
    return ok(res, result.rows[0]);
});
router.put('/profile', requireAuth, async (req, res) => {
    const parsed = z.object({
        fullName: z.string().min(3),
        phone: z.string().min(8),
        password: z.string().min(8).optional().or(z.literal('')),
        profileImageUrl: z.string().optional().nullable().or(z.literal(''))
    }).safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, parsed.error.issues[0]?.message || 'Invalid profile update');
    const phone = normalizePhone(parsed.data.phone);
    try {
        assertInternationalPhone(phone);
        if (parsed.data.password)
            assertStrongPassword(parsed.data.password);
        const current = await pool.query(`SELECT email FROM users WHERE id = $1 LIMIT 1`, [req.user?.userId]);
        if (!current.rows[0])
            return fail(res, 404, 'User not found');
        const existing = await pool.query(`SELECT id FROM users WHERE phone = $1 AND id <> $2 LIMIT 1`, [phone, req.user?.userId]);
        if (existing.rows[0])
            return fail(res, 400, 'Phone number already registered');
        const passwordHash = parsed.data.password ? await bcrypt.hash(parsed.data.password, 10) : null;
        await pool.query(`UPDATE users
       SET full_name = $2,
           phone = $3,
           password_hash = COALESCE($4, password_hash),
           updated_at = now()
       WHERE id = $1`, [req.user?.userId, parsed.data.fullName.trim(), phone, passwordHash]);
        await pool.query(`DELETE FROM media_assets WHERE owner_type = 'user' AND owner_id = $1 AND alt_text = 'profile'`, [req.user?.userId]);
        const normalizedProfileImageUrl = normalizeUrlInput(parsed.data.profileImageUrl);
        if (normalizedProfileImageUrl) {
            if (!(String(normalizedProfileImageUrl).startsWith('/uploads/') || /^https?:\/\//i.test(String(normalizedProfileImageUrl))))
                return fail(res, 400, 'Invalid url');
            await pool.query(`INSERT INTO media_assets (owner_type, owner_id, file_url, alt_text, created_by_user_id) VALUES ('user', $1, $2, 'profile', $1)`, [req.user?.userId, normalizedProfileImageUrl]);
        }
        const refreshed = await buildSessionForUser(String(req.user?.userId));
        return ok(res, refreshed, 'Profile updated');
    }
    catch (error) {
        return fail(res, 400, error instanceof Error ? error.message : 'Profile update failed');
    }
});
export default router;
router.post('/register/customer', async (req, res) => {
    const schema = z.object({
        fullName: z.string().min(3),
        email: z.string().email(),
        phone: z.string().min(8),
        password: z.string().min(8),
        preferredLanguage: z.string().optional().nullable(),
        marketingOptIn: z.boolean().default(false)
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, parsed.error.issues[0]?.message || 'Invalid customer registration');
    const d = parsed.data;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const email = normalizeEmail(d.email);
        const phone = normalizePhone(d.phone);
        assertInternationalPhone(phone);
        assertStrongPassword(d.password);
        await assertUserIdentityAvailable(client, email, phone);
        const passwordHash = await bcrypt.hash(d.password, 10);
        const userResult = await client.query(`INSERT INTO users (email, phone, password_hash, full_name, status, email_verified_at, is_active)
       VALUES ($1, $2, $3, $4, 'active', now(), true) RETURNING id`, [email, phone, passwordHash, d.fullName.trim()]);
        const userId = userResult.rows[0].id;
        await client.query(`INSERT INTO user_roles (user_id, role_code) VALUES ($1, 'customer')`, [userId]);
        await client.query(`INSERT INTO customer_profiles (user_id, marketing_opt_in, preferred_language) VALUES ($1, $2, $3)`, [userId, d.marketingOptIn, d.preferredLanguage ?? 'en']);
        await client.query('COMMIT');
        return ok(res, await buildSessionForUser(userId), 'Customer account created');
    }
    catch (error) {
        await client.query('ROLLBACK');
        return fail(res, 400, error instanceof Error ? error.message : 'Customer registration failed');
    }
    finally {
        client.release();
    }
});
router.post('/register/driver', async (req, res) => {
    const schema = z.object({
        fullName: z.string().min(3),
        email: z.string().email(),
        phone: z.string().min(8),
        password: z.string().min(8),
        licenseNumber: z.string().min(4),
        licenseExpiryDate: z.string().optional().nullable(),
        emergencyContactName: z.string().min(3),
        emergencyContactPhone: z.string().min(8),
        nationalIdNumber: z.string().min(6).optional().nullable(),
        vehicleType: z.enum(['bike', 'motorbike', 'car', 'van', 'other']).default('motorbike'),
        vehicleMake: z.string().optional().nullable(),
        vehicleModel: z.string().optional().nullable(),
        vehicleYear: z.coerce.number().int().min(1900).max(2100).optional().nullable(),
        vehicleColor: z.string().optional().nullable(),
        registrationNumber: z.string().min(3),
        profileImageUrl: flexibleUrl
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, parsed.error.issues[0]?.message || 'Invalid driver registration');
    const d = parsed.data;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const email = normalizeEmail(d.email);
        const phone = normalizePhone(d.phone);
        const emergencyPhone = normalizePhone(d.emergencyContactPhone);
        assertInternationalPhone(phone);
        assertInternationalPhone(emergencyPhone, 'Emergency contact phone');
        assertStrongPassword(d.password);
        await assertUserIdentityAvailable(client, email, phone);
        const passwordHash = await bcrypt.hash(d.password, 10);
        const userResult = await client.query(`INSERT INTO users (email, phone, password_hash, full_name, status, email_verified_at, is_active)
       VALUES ($1, $2, $3, $4, 'pending_verification', now(), false) RETURNING id`, [email, phone, passwordHash, d.fullName.trim()]);
        const userId = userResult.rows[0].id;
        await client.query(`INSERT INTO user_roles (user_id, role_code) VALUES ($1, 'driver')`, [userId]);
        await client.query(`INSERT INTO driver_profiles (user_id, onboarding_status, license_number, license_expiry_date, national_id_number, emergency_contact_name, emergency_contact_phone, available_for_dispatch)
       VALUES ($1, 'pending', $2, $3, $4, $5, $6, false)`, [userId, d.licenseNumber, d.licenseExpiryDate || null, d.nationalIdNumber ?? null, d.emergencyContactName, emergencyPhone]);
        await client.query(`INSERT INTO driver_vehicles (driver_user_id, vehicle_type, make, model, year, color, registration_number, status, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', true)`, [userId, d.vehicleType, d.vehicleMake ?? null, d.vehicleModel ?? null, d.vehicleYear ?? null, d.vehicleColor ?? null, d.registrationNumber.trim()]);
        if (d.profileImageUrl) {
            await client.query(`INSERT INTO media_assets (owner_type, owner_id, file_url, alt_text, created_by_user_id) VALUES ('user', $1, $2, 'profile', $1)`, [userId, d.profileImageUrl]);
        }
        await client.query('COMMIT');
        return ok(res, { pendingApproval: true, role: 'driver', message: 'Driver application submitted. An admin must approve it before you can sign in.' }, 'Driver application submitted');
    }
    catch (error) {
        await client.query('ROLLBACK');
        return fail(res, 400, error instanceof Error ? error.message : 'Driver registration failed');
    }
    finally {
        client.release();
    }
});
function normalizeUrlInput(value) {
    if (value == null)
        return null;
    if (typeof value !== 'string')
        return value;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    if (trimmed.startsWith('/uploads/'))
        return trimmed;
    if (/^https?:\/\//i.test(trimmed))
        return trimmed;
    if (/^[\w.-]+\.[A-Za-z]{2,}([/?#].*)?$/.test(trimmed))
        return `https://${trimmed}`;
    return trimmed;
}
const flexibleUrl = z.preprocess(normalizeUrlInput, z.string().refine((value) => value.startsWith('/uploads/') || /^https?:\/\//i.test(value), 'Invalid url').nullable().optional());
router.post('/register/restaurant', async (req, res) => {
    const schema = z.object({
        ownerFullName: z.string().min(3),
        email: z.string().email(),
        phone: z.string().min(8),
        password: z.string().min(8),
        legalName: z.string().min(2),
        displayName: z.string().min(2),
        tradingName: z.string().optional().nullable(),
        description: z.string().optional().nullable(),
        supportEmail: z.string().email().optional().nullable(),
        supportPhone: z.string().min(8).optional().nullable(),
        websiteUrl: flexibleUrl,
        taxNumber: z.string().optional().nullable(),
        registrationNumber: z.string().optional().nullable(),
        cuisineTags: z.array(z.string()).default([]),
        prepTimeMinMins: z.coerce.number().int().nonnegative().optional().nullable(),
        prepTimeMaxMins: z.coerce.number().int().nonnegative().optional().nullable(),
        acceptsPickup: z.boolean().default(true),
        acceptsDelivery: z.boolean().default(true),
        addressLine1: z.string().min(3),
        addressLine2: z.string().optional().nullable(),
        suburb: z.string().optional().nullable(),
        city: z.string().min(2),
        province: z.string().min(2),
        postalCode: z.string().optional().nullable(),
        locationName: z.string().optional().nullable(),
        latitude: z.coerce.number().optional().nullable(),
        longitude: z.coerce.number().optional().nullable(),
        deliveryRadiusKm: z.number().nonnegative().default(10),
        logoUrl: flexibleUrl,
        bannerUrl: flexibleUrl
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, parsed.error.issues[0]?.message || 'Invalid restaurant registration');
    const d = parsed.data;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const email = normalizeEmail(d.email);
        const phone = normalizePhone(d.phone);
        const supportPhone = normalizePhone(d.supportPhone ?? phone);
        assertInternationalPhone(phone);
        assertInternationalPhone(supportPhone, 'Support phone');
        assertStrongPassword(d.password);
        await assertUserIdentityAvailable(client, email, phone);
        const passwordHash = await bcrypt.hash(d.password, 10);
        const userResult = await client.query(`INSERT INTO users (email, phone, password_hash, full_name, status, email_verified_at, is_active)
       VALUES ($1, $2, $3, $4, 'pending_verification', now(), false) RETURNING id`, [email, phone, passwordHash, d.ownerFullName.trim()]);
        const userId = userResult.rows[0].id;
        await client.query(`INSERT INTO user_roles (user_id, role_code) VALUES ($1, 'restaurant_owner')`, [userId]);
        const restaurantResult = await client.query(`INSERT INTO restaurants (legal_name, display_name, trading_name, description, support_email, support_phone, website_url, tax_number, registration_number, status, onboarding_step, cuisine_tags, commission_rate, prep_time_min_mins, prep_time_max_mins, accepts_pickup, accepts_delivery, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending_review', 'submitted', $10, 15, $11, $12, $13, $14, true) RETURNING id`, [d.legalName.trim(), d.displayName.trim(), d.tradingName?.trim() ?? null, d.description?.trim() ?? null, normalizeEmail(d.supportEmail ?? email), supportPhone, d.websiteUrl ?? null, d.taxNumber?.trim() ?? null, d.registrationNumber?.trim() ?? null, d.cuisineTags, d.prepTimeMinMins ?? null, d.prepTimeMaxMins ?? null, d.acceptsPickup, d.acceptsDelivery]);
        const restaurantId = restaurantResult.rows[0].id;
        await client.query(`INSERT INTO restaurant_locations (restaurant_id, location_name, address_line1, address_line2, suburb, city, province, postal_code, country, location, latitude, longitude, delivery_radius_km, is_primary, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ZA',
               CASE WHEN $9 IS NOT NULL AND $10 IS NOT NULL THEN ST_SetSRID(ST_MakePoint($10, $9),4326)::geography ELSE NULL END,
               $9, $10, $11, true, true)`, [restaurantId, d.locationName?.trim() || 'Main Branch', d.addressLine1, d.addressLine2?.trim() ?? null, d.suburb?.trim() ?? null, d.city, d.province, d.postalCode ?? null, d.latitude ?? null, d.longitude ?? null, d.deliveryRadiusKm]);
        await client.query(`INSERT INTO restaurant_memberships (restaurant_id, user_id, role_code, status, is_primary) VALUES ($1, $2, 'restaurant_owner', 'active', true)`, [restaurantId, userId]);
        if (d.logoUrl) {
            await client.query(`INSERT INTO media_assets (owner_type, owner_id, file_url, alt_text, created_by_user_id) VALUES ('restaurant', $1, $2, 'logo', $3)`, [restaurantId, d.logoUrl, userId]);
        }
        if (d.bannerUrl) {
            await client.query(`INSERT INTO media_assets (owner_type, owner_id, file_url, alt_text, created_by_user_id) VALUES ('restaurant', $1, $2, 'banner', $3)`, [restaurantId, d.bannerUrl, userId]);
        }
        await client.query('COMMIT');
        return ok(res, { pendingApproval: true, role: 'restaurant_owner', restaurantId, message: 'Restaurant application submitted. An admin must approve it before you can sign in.' }, 'Restaurant application submitted');
    }
    catch (error) {
        await client.query('ROLLBACK');
        return fail(res, 400, error instanceof Error ? error.message : 'Restaurant registration failed');
    }
    finally {
        client.release();
    }
});
