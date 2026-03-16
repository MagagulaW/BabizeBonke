import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from './lib';

export const SOCKET_BASE_URL = (import.meta.env.VITE_SOCKET_URL as string | undefined) || API_BASE_URL.replace(/\/api\/?$/, '');

export function connectRealtime(token: string): Socket {
  return io(SOCKET_BASE_URL, {
    transports: ['websocket', 'polling'],
    auth: { token }
  });
}
