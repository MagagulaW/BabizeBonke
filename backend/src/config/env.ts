import dotenv from 'dotenv';
dotenv.config();

function required(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export const env = {
  port: Number(required('PORT', '4000')),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  corsOrigin: required('CORS_ORIGIN', 'http://localhost:5173'),
  socketOrigin: required('SOCKET_ORIGIN', process.env.CORS_ORIGIN ?? 'http://localhost:5173'),
  paymentProvider: required('PAYMENT_PROVIDER', 'paystack'),
  paymentPublishableKey: process.env.PAYMENT_PUBLISHABLE_KEY ?? '',
  paymentCheckoutBaseUrl: process.env.PAYMENT_CHECKOUT_BASE_URL ?? '',
  turnUrls: (process.env.TURN_URLS ?? '').split(',').map((x) => x.trim()).filter(Boolean),
  turnUsername: process.env.TURN_USERNAME ?? '',
  turnCredential: process.env.TURN_CREDENTIAL ?? ''
};
