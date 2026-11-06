import type { Server } from 'socket.io';
export declare function setMonitorIo(io: Server): void;
export declare function getMonitorIo(): Server | null;
export declare function registerMonitorNamespace(io: Server): import("socket.io").Namespace<import("socket.io").DefaultEventsMap, import("socket.io").DefaultEventsMap, import("socket.io").DefaultEventsMap, any>;
export interface ViolationBroadcastPayload {
    attemptId: number;
    studentId: number;
    studentName: string;
    eventType: string;
    severity: string;
    messageVi: string;
    occurredAt: string;
}
/** Gọi từ ingestion.service sau khi có newlyConfirmed episode. */
export declare function broadcastViolation(io: Server | null, examId: number, payload: ViolationBroadcastPayload): void;
/** Cập nhật badge trạng thái tổng quan (xanh/vàng/đỏ) khi attempt status hoặc recent_critical_count đổi. */
export declare function broadcastAttemptStatus(io: Server | null, examId: number, payload: {
    attemptId: number;
    status: string;
}): void;
//# sourceMappingURL=monitor.socket.d.ts.map