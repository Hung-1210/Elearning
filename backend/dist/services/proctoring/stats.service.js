"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAttemptBehaviorStats = getAttemptBehaviorStats;
exports.getAttemptTimeline = getAttemptTimeline;
exports.listExamViolations = listExamViolations;
exports.getLiveMonitorGrid = getLiveMonitorGrid;
// src/services/proctoring/stats.service.ts
const database_js_1 = require("../../config/database.js");
const policy_js_1 = require("./policy.js");
/** Đúng dữ liệu cho card "Quay đầu TRÁI 5 lần · 23 giây" trong Nhật ký Vi phạm. */
async function getAttemptBehaviorStats(attemptId) {
    const rows = await (0, database_js_1.query)(`SELECT event_type, COUNT(*)::text AS cnt, SUM(duration_ms)::text AS total_ms
       FROM proctoring_events
      WHERE attempt_id = $1 AND is_confirmed = TRUE
      GROUP BY event_type`, [attemptId]);
    return rows.map((r) => ({
        type: r.event_type,
        messageVi: policy_js_1.BEHAVIOR_META[r.event_type]?.messageVi ?? r.event_type,
        count: Number(r.cnt),
        totalDurationSec: Math.round(Number(r.total_ms || '0') / 100) / 10,
    }));
}
/** Timeline cho biểu đồ thanh ngang theo thời gian làm bài (mục "Nhật ký Vi phạm"). */
async function getAttemptTimeline(attemptId) {
    return (0, database_js_1.query)(`SELECT id, event_type, severity, started_at, ended_at, duration_ms, review_status
       FROM proctoring_events WHERE attempt_id = $1 AND is_confirmed = TRUE
      ORDER BY started_at`, [attemptId]);
}
/** Danh sách vi phạm toàn lớp/đề thi (bảng chính trong trang Nhật ký Vi phạm). */
async function listExamViolations(examId, filters) {
    const rows = await (0, database_js_1.query)(`SELECT a.id AS attempt_id, u.name AS student_name, u.id AS student_id,
            pe.id AS event_id, pe.event_type, pe.severity, pe.started_at, pe.duration_ms, pe.review_status,
            ev.id AS evidence_id
       FROM exam_attempts a
       JOIN users u ON u.id = a.student_id
       JOIN proctoring_events pe ON pe.attempt_id = a.id AND pe.is_confirmed = TRUE
       LEFT JOIN proctoring_evidence ev ON ev.event_id = pe.id
      WHERE a.exam_id = $1
      ORDER BY pe.started_at DESC`, [examId]);
    return filters.onlyFlagged ? rows.filter((r) => r.review_status !== 'dismissed') : rows;
}
/** Trạng thái tổng quan cho lưới Giám sát Trực tiếp (badge xanh/vàng/đỏ mỗi ô học sinh). */
async function getLiveMonitorGrid(examId) {
    return (0, database_js_1.query)(`SELECT a.id AS attempt_id, u.id AS student_id, u.name AS student_name, a.status,
            a.last_frame_at, a.deadline_at, a.total_score, a.max_score,
            (SELECT COUNT(*) FROM proctoring_events pe
              WHERE pe.attempt_id = a.id AND pe.is_confirmed = TRUE
                AND pe.severity = 'critical' AND pe.started_at > NOW() - INTERVAL '2 minutes')::int
              AS recent_critical_count,
            (SELECT COUNT(*) FROM proctoring_events pe
              WHERE pe.attempt_id = a.id AND pe.is_confirmed = TRUE
                AND pe.started_at > NOW() - INTERVAL '2 minutes')::int AS recent_any_count
       FROM exam_attempts a JOIN users u ON u.id = a.student_id
      WHERE a.exam_id = $1
      ORDER BY u.name`, [examId]);
}
//# sourceMappingURL=stats.service.js.map