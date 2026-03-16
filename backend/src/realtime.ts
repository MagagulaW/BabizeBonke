import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from './config/env.js';

type JwtUserPayload = {
  userId: string;
  email: string;
  roles: string[];
  restaurantIds: string[];
};

let io: Server | null = null;

export function initRealtime(server: any) {
  io = new Server(server, {
    cors: { origin: env.corsOrigin, credentials: true }
  });

  io.use((socket, next) => {
    const token = String(socket.handshake.auth?.token || socket.handshake.query?.token || '');
    if (!token) return next(new Error('Missing token'));
    try {
      const decoded = jwt.verify(token, env.jwtSecret) as JwtUserPayload;
      (socket.data as any).user = decoded;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = (socket.data as any).user as JwtUserPayload;
    socket.join(`user:${user.userId}`);
    for (const role of user.roles || []) socket.join(`role:${role}`);
    for (const restaurantId of user.restaurantIds || []) socket.join(`restaurant:${restaurantId}`);

    socket.on('order:join', (orderId: string) => {
      if (orderId) socket.join(`order:${orderId}`);
    });
    socket.on('order:leave', (orderId: string) => {
      if (orderId) socket.leave(`order:${orderId}`);
    });
  });

  return io;
}

export function emitToOrder(orderId: string, event: string, payload: unknown) {
  io?.to(`order:${orderId}`).emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToRestaurant(restaurantId: string, event: string, payload: unknown) {
  io?.to(`restaurant:${restaurantId}`).emit(event, payload);
}
