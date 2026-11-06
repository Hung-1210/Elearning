import { type BehaviorType } from './policy.js';
export interface BehaviorStat {
    type: BehaviorType;
    messageVi: string;
    count: number;
    totalDurationSec: number;
}
/** Đúng dữ liệu cho card "Quay đầu TRÁI 5 lần · 23 giây" trong Nhật ký Vi phạm. */
export declare function getAttemptBehaviorStats(attemptId: number): Promise<BehaviorStat[]>;
/** Timeline cho biểu đồ thanh ngang theo thời gian làm bài (mục "Nhật ký Vi phạm"). */
export declare function getAttemptTimeline(attemptId: number): Promise<any[]>;
/** Danh sách vi phạm toàn lớp/đề thi (bảng chính trong trang Nhật ký Vi phạm). */
export declare function listExamViolations(examId: number, filters: {
    onlyFlagged?: boolean;
}): Promise<any[]>;
/** Trạng thái tổng quan cho lưới Giám sát Trực tiếp (badge xanh/vàng/đỏ mỗi ô học sinh). */
export declare function getLiveMonitorGrid(examId: number): Promise<any[]>;
//# sourceMappingURL=stats.service.d.ts.map