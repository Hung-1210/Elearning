"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/exam.routes.ts
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const http_error_js_1 = require("../utils/http-error.js");
const proctoring_access_middleware_js_1 = require("../middleware/proctoring-access.middleware.js");
const examService = __importStar(require("../services/exam/exam.service.js"));
const attemptService = __importStar(require("../services/exam/attempt.service.js"));
const gradingService = __importStar(require("../services/exam/grading.service.js"));
const statsService = __importStar(require("../services/proctoring/stats.service.js"));
const ingestion_service_js_1 = require("../services/proctoring/ingestion.service.js");
const storage_js_1 = require("../services/proctoring/storage.js");
const policy_js_1 = require("../services/proctoring/policy.js");
const database_js_1 = require("../config/database.js");
const auth_middleware_js_1 = require("../middleware/auth.middleware.js");
const class_access_middleware_js_1 = require("../middleware/class-access.middleware.js");
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = (0, express_1.Router)();
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
// ===========================================================================
// NGÂN HÀNG CÂU HỎI — /api/classes/:classId/question-bank
// ===========================================================================
router.get('/classes/:classId/question-bank', auth_middleware_js_1.requireLogin, class_access_middleware_js_1.requireClassMembership, async (req, res) => {
    try {
        const rows = await examService.listBankQuestions(Number(req.params.classId), {
            chapter: req.query.chapter,
            difficulty: req.query.difficulty,
            questionType: req.query.type,
        });
        ok(res, rows);
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.post('/classes/:classId/question-bank', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, class_access_middleware_js_1.requireClassOwnership, async (req, res) => {
    try {
        const row = await examService.createBankQuestion(Number(req.params.classId), req.user.userId, req.body);
        ok(res, row, 201);
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.put('/question-bank/:id', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, async (req, res) => {
    try {
        ok(res, await examService.updateBankQuestion(Number(req.params.id), req.body));
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.delete('/question-bank/:id', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, async (req, res) => {
    try {
        await examService.deleteBankQuestion(Number(req.params.id));
        ok(res, { deleted: true });
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
// ===========================================================================
// PRESET GIÁM SÁT
// ===========================================================================
router.get('/proctoring-presets', auth_middleware_js_1.requireLogin, (_req, res) => ok(res, policy_js_1.EXAM_PRESETS));
// ===========================================================================
// ĐỀ THI (GIẢNG VIÊN) — /api/classes/:classId/exams
// ===========================================================================
router.get('/classes/:classId/exams', auth_middleware_js_1.requireLogin, class_access_middleware_js_1.requireClassMembership, async (req, res) => {
    try {
        ok(res, await examService.listExamsForClass(Number(req.params.classId)));
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.post('/classes/:classId/exams', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, class_access_middleware_js_1.requireClassOwnership, async (req, res) => {
    try {
        ok(res, await examService.createExam(Number(req.params.classId), req.user.userId, req.body), 201);
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.get('/exams/:examId', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireExamOwnership, async (req, res) => {
    try {
        ok(res, await examService.getExamForTeacher(Number(req.params.examId)));
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.get('/exams/:examId/student', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireStudent, proctoring_access_middleware_js_1.requireEnrolledInExamClass, async (req, res) => {
    try {
        const exam = await examService.getExamForStudent(Number(req.params.examId));
        const student = await (0, database_js_1.queryOne)(`SELECT u.name, COALESCE(ul.login_id, '') AS login_id
         FROM users u
         LEFT JOIN user_login_id ul ON ul.user_id = u.id
        WHERE u.id = $1`, [req.user.userId]);
        ok(res, {
            exam,
            student: student ?? { name: '', login_id: '' },
        });
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.put('/exams/:examId', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireExamOwnership, async (req, res) => {
    try {
        ok(res, await examService.updateExam(Number(req.params.examId), req.body));
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.post('/exams/:examId/publish', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireExamOwnership, async (req, res) => {
    try {
        ok(res, await examService.publishExam(Number(req.params.examId)));
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.post('/exams/:examId/close', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireExamOwnership, async (req, res) => {
    try {
        ok(res, await examService.closeExam(Number(req.params.examId)));
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.delete('/exams/:examId', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireExamOwnership, async (req, res) => {
    try {
        await examService.deleteExam(Number(req.params.examId));
        ok(res, { deleted: true });
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.put('/exams/:examId/proctoring-settings', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireExamOwnership, async (req, res) => {
    try {
        ok(res, await examService.updateProctoringSettings(Number(req.params.examId), req.body));
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
// --- Câu hỏi trong đề ---
router.post('/exams/:examId/questions/from-bank', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireExamOwnership, async (req, res) => {
    try {
        ok(res, await examService.addQuestionsFromBank(Number(req.params.examId), req.body.bankQuestionIds), 201);
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.post('/exams/:examId/questions', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireExamOwnership, async (req, res) => {
    try {
        ok(res, await examService.addManualQuestion(Number(req.params.examId), req.body), 201);
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.put('/exams/:examId/questions/reorder', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireExamOwnership, async (req, res) => {
    try {
        await examService.reorderQuestions(Number(req.params.examId), req.body.orderedQuestionIds);
        ok(res, { reordered: true });
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.delete('/exams/:examId/questions/:questionId', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireExamOwnership, async (req, res) => {
    try {
        await examService.removeExamQuestion(Number(req.params.examId), Number(req.params.questionId));
        ok(res, { deleted: true });
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
// ===========================================================================
// GIÁM SÁT TRỰC TIẾP + NHẬT KÝ VI PHẠM + CHẤM ĐIỂM (GIẢNG VIÊN)
// ===========================================================================
router.get('/exams/:examId/monitor/live', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireExamOwnership, async (req, res) => {
    try {
        ok(res, await statsService.getLiveMonitorGrid(Number(req.params.examId)));
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.get('/exams/:examId/violations', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireExamOwnership, async (req, res) => {
    try {
        ok(res, await statsService.listExamViolations(Number(req.params.examId), { onlyFlagged: req.query.onlyFlagged === 'true' }));
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.get('/attempts/:attemptId/behavior-stats', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireAttemptExamOwnership, async (req, res) => {
    try {
        ok(res, await statsService.getAttemptBehaviorStats(Number(req.params.attemptId)));
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.get('/attempts/:attemptId/timeline', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireAttemptExamOwnership, async (req, res) => {
    try {
        ok(res, await statsService.getAttemptTimeline(Number(req.params.attemptId)));
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
/** Review từng sự kiện vi phạm */
router.put('/proctoring-events/:eventId/review', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, async (req, res) => {
    try {
        const { status, note } = req.body;
        await (0, database_js_1.query)(`UPDATE proctoring_events
          SET review_status = $2, review_note = $3, reviewed_by = $4, reviewed_at = NOW()
        WHERE id = $1`, [req.params.eventId, status, note ?? null, req.user.userId]);
        ok(res, { updated: true });
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
/** Review kết luận tổng thể attempt */
router.put('/attempts/:attemptId/review', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireAttemptExamOwnership, async (req, res) => {
    try {
        const { verdict, note } = req.body;
        await (0, database_js_1.query)(`UPDATE exam_attempts
          SET review_verdict = $2, review_note = $3, reviewed_by = $4, reviewed_at = NOW()
        WHERE id = $1`, [req.params.attemptId, verdict, note ?? null, req.user.userId]);
        ok(res, { updated: true });
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
/** Stream ảnh bằng chứng */
router.get('/attempts/:attemptId/evidence/:evidenceId', auth_middleware_js_1.requireLogin, async (req, res) => {
    try {
        const ev = await (0, database_js_1.queryOne)('SELECT file_path FROM proctoring_evidence WHERE id = $1 AND attempt_id = $2', [req.params.evidenceId, req.params.attemptId]);
        if (!ev)
            return res.status(404).json({ success: false, error: 'Không tìm thấy ảnh' });
        const buf = await (0, storage_js_1.readEvidenceImage)(ev.file_path);
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(buf);
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.get('/exams/:examId/grading', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireExamOwnership, async (req, res) => {
    try {
        ok(res, await gradingService.listAttemptsForGrading(Number(req.params.examId)));
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.get('/attempts/:attemptId/grading', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireAttemptExamOwnership, async (req, res) => {
    try {
        ok(res, await gradingService.getAttemptForGrading(Number(req.params.attemptId)));
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.put('/attempts/:attemptId/grading/:questionId', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireLecturer, proctoring_access_middleware_js_1.requireAttemptExamOwnership, async (req, res) => {
    try {
        await gradingService.gradeEssayAnswer(Number(req.params.attemptId), Number(req.params.questionId), req.user.userId, Number(req.body.score), req.body.comment);
        ok(res, { graded: true });
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
// ===========================================================================
// PHÍA HỌC SINH
// ===========================================================================
router.get('/classes/:classId/exams/student', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireStudent, class_access_middleware_js_1.requireClassMembership, async (req, res) => {
    try {
        const exams = await examService.listExamsForClass(Number(req.params.classId));
        // Also fetch current student's attempts for each exam
        const studentId = req.user.userId;
        const attempts = await (0, database_js_1.query)(`SELECT a.* FROM exam_attempts a WHERE a.student_id = $1 AND a.exam_id = ANY($2)`, [studentId, exams.map((e) => e.id)]);
        const result = exams.filter((e) => e.status === 'published').map((e) => ({
            ...e,
            myAttempts: attempts.filter((a) => a.exam_id === e.id),
        }));
        ok(res, result);
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.post('/exams/:examId/precheck', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireStudent, proctoring_access_middleware_js_1.requireEnrolledInExamClass, upload.single('image'), async (req, res) => {
    try {
        if (!req.file)
            throw { status: 400, message: 'Thiếu ảnh' };
        ok(res, await attemptService.createPrecheckSession(Number(req.params.examId), req.user.userId, req.file.buffer), 201);
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.post('/exams/:examId/attempts', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireStudent, proctoring_access_middleware_js_1.requireEnrolledInExamClass, async (req, res) => {
    try {
        ok(res, await attemptService.startAttempt(Number(req.params.examId), req.user.userId, req.body.precheckId), 201);
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.get('/attempts/:attemptId', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireStudent, proctoring_access_middleware_js_1.requireAttemptOwner, async (req, res) => {
    try {
        ok(res, await attemptService.getAttemptForStudent(database_js_1.pool, Number(req.params.attemptId)));
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.put('/attempts/:attemptId/answers/:questionId', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireStudent, proctoring_access_middleware_js_1.requireAttemptOwner, async (req, res) => {
    try {
        await attemptService.saveAnswer(Number(req.params.attemptId), Number(req.params.questionId), req.body);
        ok(res, { saved: true });
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
router.post('/attempts/:attemptId/submit', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireStudent, proctoring_access_middleware_js_1.requireAttemptOwner, async (req, res) => {
    try {
        ok(res, await attemptService.submitAttempt(Number(req.params.attemptId), 'manual'));
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
/** Ingestion frame giám sát */
router.post('/attempts/:attemptId/frames', auth_middleware_js_1.requireLogin, auth_middleware_js_1.requireStudent, proctoring_access_middleware_js_1.requireAttemptOwner, upload.single('frame'), async (req, res) => {
    try {
        if (!req.file)
            throw { status: 400, message: 'Thiếu frame' };
        ok(res, await (0, ingestion_service_js_1.ingestFrame)(Number(req.params.attemptId), req.file.buffer));
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
});
exports.default = router;
//# sourceMappingURL=exam.routes.js.map