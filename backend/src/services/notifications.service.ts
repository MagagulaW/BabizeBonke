import { pool } from '../db/pool.js';

type SendPushInput = {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export async function registerPushToken(userId: string, token: string, platform?: string | null) {
  await pool.query(
    `INSERT INTO user_push_tokens (user_id, push_token, platform, is_active, last_seen_at)
     VALUES ($1,$2,$3,true,now())
     ON CONFLICT (push_token)
     DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, is_active = true, last_seen_at = now(), updated_at = now()`,
    [userId, token, platform ?? null]
  );
}

export async function queueInAppNotification(userId: string, title: string, body: string, metadata: Record<string, unknown> = {}) {
  await pool.query(
    `INSERT INTO notifications (user_id, channel, subject, body, metadata, status, delivered_at)
     VALUES ($1, 'in_app', $2, $3, $4::jsonb, 'delivered', now())`,
    [userId, title, body, JSON.stringify(metadata)]
  );
}

export async function sendPushNotification(input: SendPushInput) {
  await queueInAppNotification(input.userId, input.title, input.body, input.data ?? {});
  const tokens = await pool.query(`SELECT push_token FROM user_push_tokens WHERE user_id = $1 AND is_active = true`, [input.userId]);
  if (!tokens.rowCount) return;

  const messages = tokens.rows.map((row: any) => ({
    to: row.push_token,
    sound: 'default',
    title: input.title,
    body: input.body,
    data: input.data ?? {}
  }));

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages)
    });
    const payload = await response.json().catch(() => ({}));
    await pool.query(
      `INSERT INTO notifications (user_id, channel, subject, body, metadata, status, sent_at, delivered_at)
       VALUES ($1, 'push', $2, $3, $4::jsonb, $5, CASE WHEN $5 IN ('sent','delivered') THEN now() ELSE NULL END, CASE WHEN $5 = 'delivered' THEN now() ELSE NULL END)`,
      [input.userId, input.title, input.body, JSON.stringify({ expo: payload, data: input.data ?? {} }), response.ok ? 'sent' : 'failed']
    );
  } catch (error) {
    await pool.query(
      `INSERT INTO notifications (user_id, channel, subject, body, metadata, status)
       VALUES ($1, 'push', $2, $3, $4::jsonb, 'failed')`,
      [input.userId, input.title, input.body, JSON.stringify({ error: error instanceof Error ? error.message : 'Push failed', data: input.data ?? {} })]
    );
  }
}
