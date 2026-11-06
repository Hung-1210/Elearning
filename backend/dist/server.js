"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const https_1 = __importDefault(require("https"));
const os_1 = __importDefault(require("os"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const database_js_1 = require("./config/database.js");
const auth_routes_js_1 = __importDefault(require("./routes/auth.routes.js"));
const class_routes_js_1 = __importDefault(require("./routes/class.routes.js"));
const exercise_routes_js_1 = __importDefault(require("./routes/exercise.routes.js"));
const document_routes_js_1 = __importDefault(require("./routes/document.routes.js"));
const meeting_routes_js_1 = __importDefault(require("./routes/meeting.routes.js"));
const exam_routes_js_1 = __importDefault(require("./routes/exam.routes.js"));
const monitor_socket_js_1 = require("./sockets/monitor.socket.js");
const proctoring_jobs_js_1 = require("./jobs/proctoring.jobs.js");
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT || '3001');
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
// ── Middleware ───────────────────────────────────────────────
app.use((0, cors_1.default)({
    origin: [FRONTEND_URL, 'https://localhost:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
app.use((0, cookie_parser_1.default)());
// Serve uploaded files
const UPLOADS_DIR = path_1.default.join(process.cwd(), 'uploads');
if (!fs_1.default.existsSync(UPLOADS_DIR))
    fs_1.default.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express_1.default.static(UPLOADS_DIR));
// Ensure private-uploads directory exists (never served via static)
const PRIVATE_UPLOADS_DIR = path_1.default.join(process.cwd(), 'private-uploads');
if (!fs_1.default.existsSync(PRIVATE_UPLOADS_DIR))
    fs_1.default.mkdirSync(PRIVATE_UPLOADS_DIR, { recursive: true });
// ── API Routes ───────────────────────────────────────────────
app.use('/api/auth', auth_routes_js_1.default);
app.use('/api/classes', class_routes_js_1.default);
app.use('/api/exercises', exercise_routes_js_1.default);
app.use('/api/documents', document_routes_js_1.default);
app.use('/api/meetings', meeting_routes_js_1.default);
app.use('/api', exam_routes_js_1.default);
// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// ── HTTP/HTTPS Server ────────────────────────────────────────
let server;
const sslKeyPath = process.env.SSL_KEY_PATH;
const sslCertPath = process.env.SSL_CERT_PATH;
if (sslKeyPath && sslCertPath && fs_1.default.existsSync(sslKeyPath) && fs_1.default.existsSync(sslCertPath)) {
    const sslCredentials = {
        key: fs_1.default.readFileSync(sslKeyPath, 'utf8'),
        cert: fs_1.default.readFileSync(sslCertPath, 'utf8'),
    };
    server = https_1.default.createServer(sslCredentials, app);
    console.log('🔒 Running with HTTPS');
}
else {
    server = (0, http_1.createServer)(app);
    console.log('⚠️  Running with HTTP (no SSL certs found)');
}
// ── Socket.IO (WebRTC signaling + Proctoring monitor) ─────────
const io = new socket_io_1.Server(server, {
    cors: {
        origin: [FRONTEND_URL, 'https://localhost:5173'],
        credentials: true,
    },
});
// Register proctoring monitor namespace
(0, monitor_socket_js_1.registerMonitorNamespace)(io);
// Track participants per room: roomId → Map<socketId, { userId, userName }>
const rooms = new Map();
function getRoomParticipants(roomId) {
    const room = rooms.get(roomId);
    if (!room)
        return [];
    return Array.from(room.entries()).map(([socketId, info]) => ({
        socketId,
        userId: info.userId,
        userName: info.userName,
    }));
}
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    let joinedRoomId = null;
    socket.on('join-room', (roomId, userId, userName) => {
        joinedRoomId = roomId;
        socket.join(roomId);
        // Add participant to room map
        if (!rooms.has(roomId))
            rooms.set(roomId, new Map());
        rooms.get(roomId).set(socket.id, { userId, userName });
        console.log(`User ${userName} (${socket.id}) joined room ${roomId}`);
        // Notify others in room: new user joined
        socket.to(roomId).emit('user-joined', { socketId: socket.id, userId, userName });
        // Send existing participants list back to the newly joined user
        socket.emit('room-participants', getRoomParticipants(roomId));
    });
    socket.on('leave-room', (roomId) => {
        if (rooms.has(roomId)) {
            rooms.get(roomId).delete(socket.id);
            if (rooms.get(roomId).size === 0)
                rooms.delete(roomId);
        }
        socket.to(roomId).emit('user-left', socket.id);
        socket.leave(roomId);
        console.log(`User left room: ${roomId}`);
    });
    // Relay WebRTC signaling offer/answer/ICE candidate
    socket.on('signal', ({ to, data }) => {
        io.to(to).emit('signal', { from: socket.id, data });
    });
    socket.on('disconnect', () => {
        if (joinedRoomId && rooms.has(joinedRoomId)) {
            rooms.get(joinedRoomId).delete(socket.id);
            if (rooms.get(joinedRoomId).size === 0) {
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
        await (0, database_js_1.testConnection)();
        // Start background proctoring jobs (auto submit & evidence cleanup)
        (0, proctoring_jobs_js_1.startProctoringJobs)();
        server.listen(PORT, () => {
            const ip = getWifiIP();
            const proto = sslKeyPath ? 'https' : 'http';
            console.log(`🚀 Backend running at: ${proto}://${ip ?? 'localhost'}:${PORT}`);
            console.log(`   API base: ${proto}://localhost:${PORT}/api`);
        });
    }
    catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}
function getWifiIP() {
    const ifaces = os_1.default.networkInterfaces();
    for (const name of ['Wi-Fi', 'en0', 'eth0']) {
        const iface = ifaces[name];
        if (iface) {
            for (const detail of iface) {
                if (detail.family === 'IPv4' && !detail.internal)
                    return detail.address;
            }
        }
    }
    return null;
}
start();
//# sourceMappingURL=server.js.map