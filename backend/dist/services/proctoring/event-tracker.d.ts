import type { PoolClient } from 'pg';
import type { BehaviorSample } from './policy.js';
export interface ClosedEpisode {
    id: number;
    eventType: string;
    severity: string;
    startedAt: Date;
    endedAt: Date;
    durationMs: number;
    wasConfirmed: boolean;
}
/**
 * Áp dụng danh sách mẫu hành vi của 1 lần chạy AI vào DB, trong transaction của caller.
 * Trả về các episode VỪA được xác nhận lần đầu (is_confirmed false -> true) ở lần gọi
 * này — dùng để: (a) đẩy cảnh báo realtime cho học sinh/giảng viên, (b) đếm violation
 * cho auto-submit. Không trả episode "đang mở nhưng đã confirmed từ trước" để tránh
 * bắn cảnh báo lặp lại mỗi frame.
 */
export declare function applyBehaviorSamples(client: PoolClient, attemptId: number, samples: BehaviorSample[], now?: Date): Promise<{
    newlyConfirmed: ClosedEpisode[];
    closed: ClosedEpisode[];
}>;
/**
 * Gọi định kỳ để tự đóng các episode "mồ côi"
 */
export declare function closeStaleEpisodes(client: PoolClient, attemptId: number, staleAfterMs: number, now?: Date): Promise<void>;
//# sourceMappingURL=event-tracker.d.ts.map