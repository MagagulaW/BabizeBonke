import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import authRoutes from './routes/auth.routes.js';
import adminRoutes from './routes/admin.routes.js';
import restaurantRoutes from './routes/restaurant.routes.js';
import customerRoutes from './routes/customer.routes.js';
import driverRoutes from './routes/driver.routes.js';
import uploadsRoutes from './routes/uploads.routes.js';
import communicationsRoutes from './routes/communications.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import paymentsRoutes from './routes/payments.routes.js';
import complianceRoutes from './routes/compliance.routes.js';
import payoutsRoutes from './routes/payouts.routes.js';
import realtimeRoutes from './routes/realtime.routes.js';
import publicRoutes from './routes/public.routes.js';
import { initRealtime } from './realtime.js';

const app = express();
const allowedOrigins = String(env.corsOrigin || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (!allowedOrigins.length || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

app.get('/api/health', async (_req, res) => {
  const result = await pool.query('SELECT now() AS db_time');
  res.json({ success: true, data: { status: 'ok', dbTime: result.rows[0].db_time } });
});

app.use('/api/public', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/communications', communicationsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/payouts', payoutsRoutes);
app.use('/api/realtime', realtimeRoutes);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

const server = http.createServer(app);
initRealtime(server);
const host = process.env.HOST || '0.0.0.0';
server.listen(env.port, host, () => console.log(`API running on http://${host}:${env.port}`));
