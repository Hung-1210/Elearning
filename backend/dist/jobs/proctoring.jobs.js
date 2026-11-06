"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startProctoringJobs = startProctoringJobs;
// src/jobs/proctoring.jobs.ts
const database_js_1 = require("../config/database.js");
const attempt_service_js_1 = require("../services/exam/attempt.service.js");
const storage_js_1 = require("../services/proctoring/storage.js");
const AUTO_SUBMIT_INTERVAL_MS = 30_000;
const EVIDENCE_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
function startProctoringJobs() {
    const t1 = setInterval(async () => {
        try {
            const n = await (0, attempt_service_js_1.autoSubmitExpiredAttempts)();
            if (n > 0)
                console.log(`[job:auto-submit] Đã tự nộp ${n} lần làm bài hết giờ`);
        }
        catch (err) {
            console.error('[job:auto-submit] Lỗi:', err);
        }
    }, AUTO_SUBMIT_INTERVAL_MS);
    const t2 = setInterval(async () => {
        try {
            const n = await cleanupExpiredEvidence();
            if (n > 0)
                console.log(`[job:evidence-cleanup] Đã xóa ${n} ảnh bằng chứng hết hạn lưu trữ`);
        }
        catch (err) {
            console.error('[job:evidence-cleanup] Lỗi:', err);
        }
    }, EVIDENCE_CLEANUP_INTERVAL_MS);
    void cleanupExpiredEvidence();
    return () => { clearInterval(t1); clearInterval(t2); };
}
async function cleanupExpiredEvidence() {
    const rows = await (0, database_js_1.query)(`SELECT id, file_path FROM proctoring_evidence WHERE expires_at <= NOW() AND deleted_at IS NULL LIMIT 500`);
    for (const row of rows) {
        await (0, storage_js_1.deleteEvidenceImage)(row.file_path).catch((err) => console.error(`[job:evidence-cleanup] Không xóa được file cho evidence ${row.id}:`, err));
        await (0, database_js_1.query)('UPDATE proctoring_evidence SET deleted_at = NOW() WHERE id = $1', [row.id]);
    }
    return rows.length;
}
//# sourceMappingURL=proctoring.jobs.js.map