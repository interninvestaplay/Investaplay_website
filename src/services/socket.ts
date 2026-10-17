import { io, Socket } from 'socket.io-client';
import { getStoredToken } from './api';

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  const token = getStoredToken();
  if (!token) {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    return null;
  }

  if (socket) {
    if (socket.connected) {
      return socket;
    }
    socket.connect();
    return socket;
  }

  socket = io(window.location.origin, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: { token },
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => {
    console.log('[QuizWeb Socket] Connected:', socket?.id);
  });

  socket.on('disconnect', (reason) => {
    console.log('[QuizWeb Socket] Disconnected:', reason);
  });

  socket.on('connect_error', (err) => {
    console.warn('[QuizWeb Socket] Connection error:', err.message);
  });

  return socket;
}

export function closeSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
