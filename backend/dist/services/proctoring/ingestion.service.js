"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestFrame = ingestFrame;
// src/services/proctoring/ingestion.service.ts
const database_js_1 = require("../../config/database.js");
const http_error_js_1 = require("../../utils/http-error.js");
const ai_client_js_1 = require("./ai-client.js");
const policy_js_1 = require("./policy.js");
const exam_service_js_1 = require("../exam/exam.service.js");
const event_tracker_js_1 = require("./event-tracker.js");
const storage_js_1 = require("./storage.js");
const attempt_service_js_1 = require("../exam/attempt.service.js");
const monitor_socket_js_1 = require("../../sockets/monitor.socket.js");
async function ingestFrame(attemptId, imageBuffer) {
    const attempt = await (0, database_js_1.queryOne)(`SELECT a.*, u.name AS student_name FROM exam_attempts a JOIN users u ON u.id = a.student_id WHERE a.id = $1`, [attemptId]);
    if (!attempt)
        throw new http_error_js_1.HttpError(404, 'Không tìm thấy lần làm bài');
    if (attempt.status !== 'in_progress')
        throw new http_error_js_1.HttpError(400, 'Lần làm bài đã kết thúc');
    const settingsRow = await (0, database_js_1.queryOne)('SELECT * FROM exam_proctoring_settings WHERE exam_id = $1', [attempt.exam_id]);
    const settings = (0, exam_service_js_1.mapSettingsRow)(settingsRow);
    if (!settings.enabled)
        return { warnings: [], shouldAutoSubmit: false };
    const now = new Date();
    // Tự đóng episode "mồ côi" nếu khoảng cách so với frame trước quá xa
    if (attempt.last_frame_at) {
        const gapMs = now.getTime() - new Date(attempt.last_frame_at).getTime();
        if (gapMs > (0, policy_js_1.cameraGapThresholdMs)(settings)) {
            await (0, database_js_1.withTransaction)((client) => (0, event_tracker_js_1.closeStaleEpisodes)(client, attemptId, 0, new Date(attempt.last_frame_at)));
        }
    }
    const identityCheckDue = !attempt.last_identity_check_at ||
        (now.getTime() - new Date(attempt.last_identity_check_at).getTime()) >= settings.identityRecheckIntervalSec * 1000;
    const run = (0, policy_js_1.buildRunFlags)(settings, !!attempt.reference_embedding, identityCheckDue);
    let analysis;
    try {
        analysis = await (0, ai_client_js_1.analyzeFrame)({ imageBuffer, referenceEmbedding: attempt.reference_embedding, run });
    }
    catch (err) {
        await (0, database_js_1.query)('UPDATE exam_attempts SET ai_error_count = ai_error_count + 1, last_frame_at = $2 WHERE id = $1', [attemptId, now]);
        console.error(`[ingestion] AI service lỗi cho attempt ${attemptId}:`, err);
        return { warnings: [], shouldAutoSubmit: false };
    }
    const samples = (0, policy_js_1.evaluateAnalysis)(analysis, settings, run);
    const { newlyConfirmed } = await (0, database_js_1.withTransaction)(async (client) => {
        const r = await (0, event_tracker_js_1.applyBehaviorSamples)(client, attemptId, samples, now);
        await client.query(`UPDATE exam_attempts SET last_frame_at=$2, frame_count = frame_count + 1
         ${run.identity ? ', last_identity_check_at = $2' : ''} WHERE id=$1`, [attemptId, now]);
        // Lưu ảnh bằng chứng cho MỖI episode vừa được xác nhận lần đầu
        for (const ev of r.newlyConfirmed) {
            const relPath = await (0, storage_js_1.saveEvidenceImage)(attemptId, imageBuffer);
            const expiresAt = new Date(now.getTime() + settings.evidenceRetentionDays * 86400_000);
            await client.query(`INSERT INTO proctoring_evidence (event_id, attempt_id, file_path, size_bytes, captured_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6)`, [ev.id, attemptId, relPath, imageBuffer.length, now, expiresAt]);
        }
        return r;
    });
    const warnings = newlyConfirmed.map((ev) => ({
        type: ev.eventType, severity: ev.severity,
        messageVi: policy_js_1.BEHAVIOR_META[ev.eventType]?.messageVi ?? ev.eventType,
    }));
    // Broadcast realtime events to lecturer monitor room via Socket.IO
    const io = (0, monitor_socket_js_1.getMonitorIo)();
    for (const w of warnings) {
        (0, monitor_socket_js_1.broadcastViolation)(io, attempt.exam_id, {
            attemptId,
            studentId: attempt.student_id,
            studentName: attempt.student_name,
            eventType: w.type,
            severity: w.severity,
            messageVi: w.messageVi,
            occurredAt: now.toISOString(),
        });
    }
    let shouldAutoSubmit = false;
    if (settings.violationAction === 'auto_submit' && newlyConfirmed.some((e) => e.severity === 'critical')) {
        const criticalCount = await (0, database_js_1.queryOne)(`SELECT COUNT(*)::text AS c FROM proctoring_events
        WHERE attempt_id = $1 AND is_confirmed = TRUE AND severity = 'critical'`, [attemptId]);
        if (Number(criticalCount?.c ?? '0') >= settings.autoSubmitAfterViolations) {
            shouldAutoSubmit = true;
            await (0, attempt_service_js_1.submitAttempt)(attemptId, 'proctoring');
            (0, monitor_socket_js_1.broadcastAttemptStatus)(io, attempt.exam_id, { attemptId, status: 'submitted' });
        }
    }
    return { warnings, shouldAutoSubmit };
}
//# sourceMappingURL=ingestion.service.js.map