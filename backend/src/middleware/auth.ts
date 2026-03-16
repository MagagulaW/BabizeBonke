import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { fail } from '../utils/http.js';

type JwtUserPayload = {
  userId: string;
  email: string;
  roles: string[];
  restaurantIds: string[];
};

type AuthedRequest = Request & { user?: JwtUserPayload };

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authedReq = req as AuthedRequest;
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return fail(res, 401, 'Missing token');

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as JwtUserPayload;
    authedReq.user = decoded;
    next();
  } catch {
    return fail(res, 401, 'Invalid or expired token');
  }
}

export function requireRoles(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authedReq = req as AuthedRequest;
    const userRoles = authedReq.user?.roles ?? [];
    if (!roles.some((role) => userRoles.includes(role))) return fail(res, 403, 'Forbidden');
    next();
  };
}

export function canAccessRestaurant(req: Request, restaurantId: string) {
  const authedReq = req as AuthedRequest;
  const roles = authedReq.user?.roles ?? [];
  if (roles.some((r: string) => ['platform_admin', 'finance_admin', 'content_admin', 'support_admin'].includes(r))) return true;
  return (authedReq.user?.restaurantIds ?? []).includes(restaurantId);
}
