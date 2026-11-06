"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setMonitorIo = setMonitorIo;
exports.getMonitorIo = getMonitorIo;
exports.registerMonitorNamespace = registerMonitorNamespace;
exports.broadcastViolation = broadcastViolation;
exports.broadcastAttemptStatus = broadcastAttemptStatus;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const database_js_1 = require("../config/database.js");
let monitorIoInstance = null;
function setMonitorIo(io) {
    monitorIoInstance = io;
}
function getMonitorIo() {
    return monitorIoInstance;
}
function registerMonitorNamespace(io) {
    setMonitorIo(io);
    const nsp = io.of('/monitor');
    nsp.use((socket, next) => {
        try {
            const token = socket.handshake.auth?.token;
            if (!token)
                return next(new Error('Thiếu token xác thực'));
            const payload = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
            if (!payload.isLecturer)
                return next(new Error('Chỉ giảng viên được phép giám sát'));
            socket.data.userId = payload.userId;
            next();
        }
        catch {
            next(new Error('Token không hợp lệ'));
        }
    });
    nsp.on('connection', (socket) => {
        socket.on('join-exam', async (examId, ack) => {
            const lecturerId = socket.data.userId;
            const owns = await (0, database_js_1.queryOne)(`SELECT 1 FROM exams e JOIN classes c ON c.id = e.class_id
          WHERE e.id = $1 AND (c.lecturer_id = $2
            OR EXISTS (SELECT 1 FROM class_collaborators cc WHERE cc.class_id = c.id AND cc.lecturer_id = $2))`, [examId, lecturerId]);
            if (!owns)
                return ack?.(false, 'Không có quyền giám sát đề thi này');
            socket.join(`exam:${examId}`);
            ack?.(true);
        });
        socket.on('leave-exam', (examId) => socket.leave(`exam:${examId}`));
    });
    return nsp;
}
/** Gọi từ ingestion.service sau khi có newlyConfirmed episode. */
function broadcastViolation(io, examId, payload) {
    const targetIo = io ?? monitorIoInstance;
    targetIo?.of('/monitor').to(`exam:${examId}`).emit('violation', payload);
}
/** Cập nhật badge trạng thái tổng quan (xanh/vàng/đỏ) khi attempt status hoặc recent_critical_count đổi. */
function broadcastAttemptStatus(io, examId, payload) {
    const targetIo = io ?? monitorIoInstance;
    targetIo?.of('/monitor').to(`exam:${examId}`).emit('attempt-status', payload);
}
//# sourceMappingURL=monitor.socket.js.map