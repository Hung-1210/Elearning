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
import { getMeetingByCode } from './services/meeting.service.js';
import examRoutes from './routes/exam.routes.js';
import faceAttendanceRoutes from './routes/face-attendance.routes.js';
import aiRoutes from './routes/ai.routes.js';
import { registerMonitorNamespace } from './sockets/monitor.socket.js';
import { registerMeetingIo } from './sockets/attendance.socket.js';
import { ensureFaceAttendanceTables } from './services/face-profile.service.js';
import { ensureAiRagTables } from './services/ai/schema.js';
import { startProctoringJobs } from './jobs/proctoring.jobs.js';
import { startAiJobs } from './jobs/ai.jobs.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001');
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ── Middleware ───────────────────────────────────────────────
app.use(cors({
  origin: [FRONTEND_URL, 'https://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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
app.use('/api', faceAttendanceRoutes);
app.use('/api', aiRoutes);
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

// Register proctoring monitor namespace & meeting attendance io
registerMonitorNamespace(io);
registerMeetingIo(io);

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

  const removeFromRoom = (roomId: string) => {
    const room = rooms.get(roomId);
    if (room) {
      room.delete(socket.id);
      if (room.size === 0) rooms.delete(roomId);
    }
    socket.to(roomId).emit('user-disconnected', socket.id);
    io.to(roomId).emit('room-participants', getRoomParticipants(roomId));
  };

  socket.on('join-room', async (roomId: string, userId: string, userName: string) => {
    try {
      const meeting = await getMeetingByCode(roomId);
      if (meeting && new Date() > new Date(meeting.end_time)) {
        socket.emit('room-ended', {
          message: 'Buổi học này đã quá thời gian kết thúc, không thể tham gia vào phòng.',
          endTime: meeting.end_time,
        });
        return;
      }
    } catch {
      // Nếu lỗi truy vấn tạm thời thì không chặn cứng
    }

    // Rời phòng cũ nếu socket này đã join phòng khác
    if (joinedRoomId && joinedRoomId !== roomId) {
      removeFromRoom(joinedRoomId);
      socket.leave(joinedRoomId);
    }
    joinedRoomId = roomId;
    socket.join(roomId);

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    rooms.get(roomId)!.set(socket.id, { userId, userName });

    console.log(`User ${userName} (${socket.id}) joined room ${roomId}`);

    // Người đã ở trong phòng sẽ là bên tạo offer tới người mới (khớp MeetingRoom.tsx)
    socket.to(roomId).emit('user-connected', socket.id, userName);

    // Cập nhật danh sách người tham gia cho TOÀN BỘ phòng
    io.to(roomId).emit('room-participants', getRoomParticipants(roomId));
  });

  socket.on('leave-room', (roomId: string) => {
    removeFromRoom(roomId);
    socket.leave(roomId);
    if (joinedRoomId === roomId) joinedRoomId = null;
    console.log(`User left room: ${roomId}`);
  });

  // ── Relay WebRTC signaling (khớp tên sự kiện của MeetingRoom.tsx) ──
  socket.on('offer', (to: string, offer: unknown) => {
    io.to(to).emit('offer', socket.id, offer);
  });
  socket.on('answer', (to: string, answer: unknown) => {
    io.to(to).emit('answer', socket.id, answer);
  });
  socket.on('candidate', (to: string, candidate: unknown) => {
    io.to(to).emit('candidate', socket.id, candidate);
  });

  // ── Chat: relay qua socket để không phụ thuộc DataChannel ──
  socket.on('chat-message', (text: unknown) => {
    if (!joinedRoomId || typeof text !== 'string') return;
    const clean = text.trim().slice(0, 2000);
    if (!clean) return;
    const sender = rooms.get(joinedRoomId)?.get(socket.id)?.userName || 'Ẩn danh';
    socket.to(joinedRoomId).emit('chat-message', { sender, text: clean, timestamp: Date.now() });
  });

  socket.on('disconnect', () => {
    if (joinedRoomId) {
      removeFromRoom(joinedRoomId);
      console.log(`Socket ${socket.id} disconnected from room ${joinedRoomId}`);
    }
  });
});

// ── Start ────────────────────────────────────────────────────
async function start() {
  try {
    await testConnection();
    await ensureFaceAttendanceTables();
    await ensureAiRagTables();
    // Start background proctoring & AI ingestion jobs
    startProctoringJobs();
    startAiJobs();

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
