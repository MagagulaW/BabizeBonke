import { Response } from 'express';

export function ok(res: Response, data: unknown, message = 'ok') {
  return res.json({ success: true, message, data });
}

export function fail(res: Response, status: number, message: string) {
  return res.status(status).json({ success: false, message });
}
