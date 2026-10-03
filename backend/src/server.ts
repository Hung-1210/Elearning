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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve uploaded files
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

// ── API Routes ───────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/exercises', exerciseRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/meetings', meetingRoutes);

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

// ── Socket.IO (WebRTC signaling) ─────────────────────────────
const io = new SocketIOServer(server, {
  cors: {
    origin: [FRONTEND_URL, 'https://localhost:5173'],
    credentials: true,
  },
});

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

    // Notify existing peers about the new user (send socket.id so they can create peer connections)
    socket.to(roomId).emit('user-connected', socket.id, userName);

    // Send full participant list to everyone in the room
    io.to(roomId).emit('room-participants', getRoomParticipants(roomId));

    console.log(`User ${userName} (${socket.id}) joined room ${roomId}`);

    // WebRTC signaling — all routing via socket.id
    socket.on('offer', (targetSocketId: string, offer: unknown) => {
      socket.to(targetSocketId).emit('offer', socket.id, offer);
    });

    socket.on('answer', (targetSocketId: string, answer: unknown) => {
      socket.to(targetSocketId).emit('answer', socket.id, answer);
    });

    socket.on('candidate', (targetSocketId: string, candidate: unknown) => {
      socket.to(targetSocketId).emit('candidate', socket.id, candidate);
    });

    socket.on('disconnect', () => {
      if (joinedRoomId) {
        const room = rooms.get(joinedRoomId);
        if (room) {
          room.delete(socket.id);
          if (room.size === 0) rooms.delete(joinedRoomId);
        }
        socket.to(joinedRoomId).emit('user-disconnected', socket.id);
        io.to(joinedRoomId).emit('room-participants', getRoomParticipants(joinedRoomId));
        console.log(`Socket ${socket.id} disconnected from room ${joinedRoomId}`);
      }
    });
  });
});


// ── Start ────────────────────────────────────────────────────
async function start() {
  try {
    await testConnection();
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
