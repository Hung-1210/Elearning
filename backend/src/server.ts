import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import https from 'https';
import os from 'os';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

import { testConnection } from './config/database.js';
import authRoutes from './routes/auth.routes.js';
import classRoutes from './routes/class.routes.js';
import exerciseRoutes from './routes/exercise.routes.js';
import documentRoutes from './routes/document.routes.js';
import meetingRoutes from './routes/meeting.routes.js';
import examRoutes from './routes/exam.routes.js';
import { registerMonitorNamespace } from './sockets/monitor.socket.js';
import { startProctoringJobs } from './jobs/proctoring.jobs.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001');
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ── Middleware ───────────────────────────────────────────────
app.use(cors({
  origin: [FRONTEND_URL, 'https://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Serve uploaded files
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

// Ensure private-uploads directory exists (never served via static)
const PRIVATE_UPLOADS_DIR = path.join(process.cwd(), 'private-uploads');
if (!fs.existsSync(PRIVATE_UPLOADS_DIR)) fs.mkdirSync(PRIVATE_UPLOADS_DIR, { recursive: true });

// ── API Routes ───────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/exercises', exerciseRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api', examRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── HTTP/HTTPS Server ────────────────────────────────────────
let server: ReturnType<typeof createServer> | ReturnType<typeof https.createServer>;

const sslKeyPath = process.env.SSL_KEY_PATH;
const sslCertPath = process.env.SSL_CERT_PATH;

if (sslKeyPath && sslCertPath && fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
  const sslCredentials = {
    key: fs.readFileSync(sslKeyPath, 'utf8'),
    cert: fs.readFileSync(sslCertPath, 'utf8'),
  };
  server = https.createServer(sslCredentials, app);
  console.log('🔒 Running with HTTPS');
} else {
  server = createServer(app);
  console.log('⚠️  Running with HTTP (no SSL certs found)');
}

// ── Socket.IO (WebRTC signaling + Proctoring monitor) ─────────
const io = new SocketIOServer(server, {
  cors: {
    origin: [FRONTEND_URL, 'https://localhost:5173'],
    credentials: true,
  },
});

// Register proctoring monitor namespace
registerMonitorNamespace(io);

// Track participants per room: roomId → Map<socketId, { userId, userName }>
const rooms = new Map<string, Map<string, { userId: string; userName: string }>>();

function getRoomParticipants(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.entries()).map(([socketId, info]) => ({
    socketId,
    userId: info.userId,
    userName: info.userName,
  }));
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  let joinedRoomId: string | null = null;

  socket.on('join-room', (roomId: string, userId: string, userName: string) => {
    joinedRoomId = roomId;
    socket.join(roomId);

    // Add participant to room map
    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    rooms.get(roomId)!.set(socket.id, { userId, userName });

    console.log(`User ${userName} (${socket.id}) joined room ${roomId}`);

    // Notify others in room: new user joined
    socket.to(roomId).emit('user-joined', { socketId: socket.id, userId, userName });

    // Send existing participants list back to the newly joined user
    socket.emit('room-participants', getRoomParticipants(roomId));
  });

  socket.on('leave-room', (roomId: string) => {
    if (rooms.has(roomId)) {
      rooms.get(roomId)!.delete(socket.id);
      if (rooms.get(roomId)!.size === 0) rooms.delete(roomId);
    }
    socket.to(roomId).emit('user-left', socket.id);
    socket.leave(roomId);
    console.log(`User left room: ${roomId}`);
  });

  // Relay WebRTC signaling offer/answer/ICE candidate
  socket.on('signal', ({ to, data }: { to: string; data: unknown }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('disconnect', () => {
    if (joinedRoomId && rooms.has(joinedRoomId)) {
      rooms.get(joinedRoomId)!.delete(socket.id);
      if (rooms.get(joinedRoomId)!.size === 0) {
        rooms.delete(joinedRoomId);
      }
      socket.to(joinedRoomId).emit('user-disconnected', socket.id);
      io.to(joinedRoomId).emit('room-participants', getRoomParticipants(joinedRoomId));
      console.log(`Socket ${socket.id} disconnected from room ${joinedRoomId}`);
    }
  });
});

// ── Start ────────────────────────────────────────────────────
async function start() {
  try {
    await testConnection();
    // Start background proctoring jobs (auto submit & evidence cleanup)
    startProctoringJobs();

    server.listen(PORT, () => {
      const ip = getWifiIP();
      const proto = sslKeyPath ? 'https' : 'http';
      console.log(`🚀 Backend running at: ${proto}://${ip ?? 'localhost'}:${PORT}`);
      console.log(`   API base: ${proto}://localhost:${PORT}/api`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

function getWifiIP(): string | null {
  const ifaces = os.networkInterfaces();
  for (const name of ['Wi-Fi', 'en0', 'eth0']) {
    const iface = ifaces[name];
    if (iface) {
      for (const detail of iface) {
        if (detail.family === 'IPv4' && !detail.internal) return detail.address;
      }
    }
  }
  return null;
}

start();
