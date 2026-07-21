import { Server } from 'socket.io';

let io = null;

export function initSocket(httpServer, corsOrigin) {
  io = new Server(httpServer, { cors: { origin: corsOrigin } });
  io.on('connection', (socket) => {
    socket.on('join', (room) => { if (typeof room === 'string' && room.length < 100) socket.join(room); });
    socket.on('leave', (room) => socket.leave(room));
  });
  return io;
}

export function getIO() { return io; }

// Broadcast a refresh signal to every consumer of a tournament (overlays, website, admin)
export function notifyRefresh(slug, types = ['all']) {
  if (!io) return;
  const payload = { slug, types, at: Date.now() };
  io.to(slug).emit('refresh', payload);
  io.emit('data:updated', payload);
}
