// src/sockets/monitor.socket.ts
import type { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { queryOne } from '../config/database.js';

interface JwtPayload { userId: number; isLecturer: boolean }

let monitorIoInstance: Server | null = null;

export function setMonitorIo(io: Server) {
  monitorIoInstance = io;
}

export function getMonitorIo(): Server | null {
  return monitorIoInstance;
}

export function registerMonitorNamespace(io: Server) {
  setMonitorIo(io);
  const nsp = io.of('/monitor');

  nsp.use((socket: Socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('Thiếu token xác thực'));
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
      if (!payload.isLecturer) return next(new Error('Chỉ giảng viên được phép giám sát'));
      (socket.data as any).userId = payload.userId;
      next();
    } catch {
      next(new Error('Token không hợp lệ'));
    }
  });

  nsp.on('connection', (socket) => {
    socket.on('join-exam', async (rawExamId: number | string | { examId?: number; exam_id?: number }, ack?: (ok: boolean, error?: string) => void) => {
      const examId = typeof rawExamId === 'object' ? Number(rawExamId?.examId ?? rawExamId?.exam_id) : Number(rawExamId);
      if (!Number.isFinite(examId) || examId <= 0) return ack?.(false, 'Mã đề thi không hợp lệ');
      const lecturerId = (socket.data as any).userId as number;
      const owns = await queryOne(
        `SELECT 1 FROM exams e JOIN classes c ON c.id = e.class_id
          WHERE e.id = $1 AND (c.lecturer_id = $2
            OR EXISTS (SELECT 1 FROM class_collaborators cc WHERE cc.class_id = c.id AND cc.lecturer_id = $2))`,
        [examId, lecturerId],
      );
      if (!owns) return ack?.(false, 'Không có quyền giám sát đề thi này');
      socket.join(`exam:${examId}`);
      ack?.(true);
    });

    socket.on('leave-exam', (examId: number | string) => socket.leave(`exam:${Number(examId)}`));
  });

  // Namespace dành riêng cho thí sinh đang làm bài (nhận nhắc nhở / thông báo toàn phòng / thu bài tức thời)
  const studentNsp = io.of('/exam-session');
  studentNsp.use((socket: Socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('Thiếu token xác thực'));
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
      if (payload.isLecturer) return next(new Error('Phiên này chỉ dành cho thí sinh'));
      (socket.data as any).userId = payload.userId;
      next();
    } catch {
      next(new Error('Token không hợp lệ'));
    }
  });

  studentNsp.on('connection', (socket) => {
    socket.on('join-attempt', async (rawAttemptId: number | string, ack?: (ok: boolean, error?: string) => void) => {
      const attemptId = Number(rawAttemptId);
      if (!Number.isFinite(attemptId) || attemptId <= 0) return ack?.(false, 'Mã lần làm bài không hợp lệ');
      const studentId = (socket.data as any).userId as number;
      const attempt = await queryOne<{ exam_id: number; status: string }>(
        'SELECT exam_id, status FROM exam_attempts WHERE id = $1 AND student_id = $2',
        [attemptId, studentId],
      );
      if (!attempt) return ack?.(false, 'Không có quyền truy cập lần làm bài này');
      socket.join(`attempt:${attemptId}`);
      socket.join(`exam-students:${attempt.exam_id}`);
      ack?.(true);
    });
  });

  return nsp;
}

export interface ViolationBroadcastPayload {
  eventId?: number;
  attemptId: number;
  studentId: number;
  studentName: string;
  studentCode?: string;
  eventType: string;
  severity: string;
  messageVi: string;
  occurredAt: string;
  violationCount?: number;
}

/** Gọi từ ingestion.service sau khi có newlyConfirmed episode. */
export function broadcastViolation(io: Server | null, examId: number, payload: ViolationBroadcastPayload) {
  const targetIo = io ?? monitorIoInstance;
  targetIo?.of('/monitor').to(`exam:${examId}`).emit('violation', payload);
}

/** Cập nhật trạng thái lần làm bài (bắt đầu / đã nộp / tự động nộp / giảng viên thu bài). */
export function broadcastAttemptStatus(
  io: Server | null,
  examId: number,
  payload: { attemptId: number; status: string; submitReason?: string },
) {
  const targetIo = io ?? monitorIoInstance;
  targetIo?.of('/monitor').to(`exam:${examId}`).emit('attempt-status', payload);
}

/** Nhịp tim frame & tiến độ thật của thí sinh cho lưới Live Monitor. */
export function broadcastFrameHeartbeat(
  io: Server | null,
  examId: number,
  payload: {
    attemptId: number;
    lastFrameAt: string;
    progressAnswered: number;
    totalQuestions: number;
    faceCount: number | null;
    aiStatus: 'ok' | 'degraded';
  },
) {
  const targetIo = io ?? monitorIoInstance;
  targetIo?.of('/monitor').to(`exam:${examId}`).emit('frame-heartbeat', payload);
}

/** AI service lỗi/quá tải — để giảng viên biết dữ liệu giám sát đang không đầy đủ (KHÔNG phải vi phạm). */
export function broadcastAiStatus(
  io: Server | null, examId: number,
  payload: { attemptId: number; studentId: number; status: 'degraded' | 'ok'; code: string; detail: string; at: string },
) {
  const targetIo = io ?? monitorIoInstance;
  targetIo?.of('/monitor').to(`exam:${examId}`).emit('ai-status', payload);
}

export interface SupervisorNoticePayload {
  id: string;
  scope: 'broadcast' | 'direct';
  message: string;
  sentAt: string;
}

export function notifyExamStudentsBroadcast(examId: number, payload: SupervisorNoticePayload) {
  monitorIoInstance?.of('/exam-session').to(`exam-students:${examId}`).emit('supervisor-notice', payload);
}

export function notifyStudentDirectWarning(attemptId: number, payload: SupervisorNoticePayload) {
  monitorIoInstance?.of('/exam-session').to(`attempt:${attemptId}`).emit('supervisor-notice', payload);
}

export function notifyStudentForceSubmitted(attemptId: number, reasonMessage: string) {
  monitorIoInstance?.of('/exam-session').to(`attempt:${attemptId}`).emit('force-submitted', {
    attemptId,
    message: reasonMessage,
    submittedAt: new Date().toISOString(),
  });
}
