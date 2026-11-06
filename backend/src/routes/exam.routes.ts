// src/routes/exam.routes.ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { HttpError, sendError } from '../utils/http-error.js';
import {
  requireExamOwnership, requireEnrolledInExamClass, requireAttemptOwner, requireAttemptExamOwnership,
} from '../middleware/proctoring-access.middleware.js';
import * as examService from '../services/exam/exam.service.js';
import * as attemptService from '../services/exam/attempt.service.js';
import * as gradingService from '../services/exam/grading.service.js';
import * as statsService from '../services/proctoring/stats.service.js';
import {
  ingestFrame, ingestBrowserEvent, getIngestionMetrics, queueSupervisorNotice,
  type BrowserEventType,
} from '../services/proctoring/ingestion.service.js';
import { aiReadiness, analyzeFrame, AiServiceError } from '../services/proctoring/ai-client.js';
import { readEvidenceImage, readLatestAttemptFrame } from '../services/proctoring/storage.js';
import { EXAM_PRESETS } from '../services/proctoring/policy.js';
import { computeStudentResultVisibility } from '../services/exam/visibility.js';
import {
  notifyExamStudentsBroadcast, notifyStudentDirectWarning, notifyStudentForceSubmitted,
} from '../sockets/monitor.socket.js';
import { query, queryOne, pool } from '../config/database.js';

import { requireLogin, requireLecturer, requireStudent } from '../middleware/auth.middleware.js';
import { requireClassOwnership, requireClassMembership } from '../middleware/class-access.middleware.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = Router();

const ok = (res: Response, data: any, status = 200) => res.status(status).json({ success: true, data });

// ---------------------------------------------------------------------------
// Rate limiter nhẹ theo cửa sổ trượt (bảo vệ endpoint AI & nhạy cảm)
// ---------------------------------------------------------------------------
const rateBuckets = new Map<string, number[]>();
function rateLimit(opts: { windowMs: number; max: number; key: (req: Request) => string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const k = opts.key(req);
    const now = Date.now();
    const cutoff = now - opts.windowMs;
    const prev = (rateBuckets.get(k) ?? []).filter((t) => t > cutoff);
    if (prev.length >= opts.max) {
      res.status(429).json({ success: false, error: 'Thao tác quá nhanh, vui lòng thử lại sau giây lát.' });
      return;
    }
    prev.push(now);
    rateBuckets.set(k, prev);
    next();
  };
}

async function ensureBankQuestionOwnership(questionId: number, lecturerId: number) {
  const owns = await queryOne(
    `SELECT 1 FROM bank_questions bq
       JOIN classes c ON c.id = bq.class_id
      WHERE bq.id = $1 AND (c.lecturer_id = $2
        OR EXISTS (SELECT 1 FROM class_collaborators cc WHERE cc.class_id = c.id AND cc.lecturer_id = $2))`,
    [questionId, lecturerId],
  );
  if (!owns) throw new HttpError(403, 'Bạn không có quyền chỉnh sửa câu hỏi này');
}

// ===========================================================================
// NGÂN HÀNG CÂU HỎI — /api/classes/:classId/question-bank
// ===========================================================================
router.get('/classes/:classId/question-bank', requireLogin, requireClassMembership, async (req, res) => {
  try {
    const rows = await examService.listBankQuestions(Number(req.params.classId), {
      chapter: req.query.chapter as string,
      difficulty: req.query.difficulty as string,
      questionType: req.query.type as string,
    });
    ok(res, rows);
  } catch (err) { sendError(res, err); }
});

router.post('/classes/:classId/question-bank', requireLogin, requireLecturer, requireClassOwnership, async (req, res) => {
  try {
    const row = await examService.createBankQuestion(Number(req.params.classId), req.user!.userId, req.body);
    ok(res, row, 201);
  } catch (err) { sendError(res, err); }
});

router.put('/question-bank/:id', requireLogin, requireLecturer, async (req, res) => {
  try {
    const qId = Number(req.params.id);
    await ensureBankQuestionOwnership(qId, req.user!.userId);
    ok(res, await examService.updateBankQuestion(qId, req.body));
  } catch (err) { sendError(res, err); }
});

router.delete('/question-bank/:id', requireLogin, requireLecturer, async (req, res) => {
  try {
    const qId = Number(req.params.id);
    await ensureBankQuestionOwnership(qId, req.user!.userId);
    await examService.deleteBankQuestion(qId);
    ok(res, { deleted: true });
  } catch (err) { sendError(res, err); }
});

// ===========================================================================
// PRESET GIÁM SÁT & TEST CAMERA THẬT TRONG WIZARD
// ===========================================================================
router.get('/proctoring-presets', requireLogin, (_req, res) => ok(res, EXAM_PRESETS));

router.post(
  '/proctoring/test-frame',
  requireLogin,
  requireLecturer,
  rateLimit({ windowMs: 60_000, max: 30, key: (req) => `test-frame:${req.user?.userId}` }),
  upload.single('frame'),
  async (req, res) => {
    try {
      if (!req.file) throw new HttpError(400, 'Thiếu frame ảnh');
      const requestId = randomUUID();
      res.setHeader('X-Request-Id', requestId);
      const analysis = await analyzeFrame({
        imageBuffer: req.file.buffer,
        referenceEmbedding: null,
        run: {
          face: true,
          headPose: true,
          gaze: req.body?.trackGaze === 'true' || req.body?.trackGaze === true,
          objects: true,
          identity: false,
        },
        requestId,
      });
      ok(res, analysis);
    } catch (err) {
      if (err instanceof AiServiceError) {
        return res.status(503).json({
          success: false,
          error: `AI chưa sẵn sàng (${err.code}): ${err.message}`,
          code: err.code,
        });
      }
      sendError(res, err);
    }
  },
);

// ===========================================================================
// ĐỀ THI (GIẢNG VIÊN) — /api/classes/:classId/exams
// ===========================================================================
router.get('/classes/:classId/exams', requireLogin, requireClassMembership, async (req, res) => {
  try { ok(res, await examService.listExamsForClass(Number(req.params.classId))); }
  catch (err) { sendError(res, err); }
});

router.post('/classes/:classId/exams', requireLogin, requireLecturer, requireClassOwnership, async (req, res) => {
  try { ok(res, await examService.createExam(Number(req.params.classId), req.user!.userId, req.body), 201); }
  catch (err) { sendError(res, err); }
});

router.get('/exams/:examId', requireLogin, requireLecturer, requireExamOwnership, async (req, res) => {
  try { ok(res, await examService.getExamForTeacher(Number(req.params.examId))); }
  catch (err) { sendError(res, err); }
});

router.get('/exams/:examId/student', requireLogin, requireStudent, requireEnrolledInExamClass, async (req, res) => {
  try {
    const exam = await examService.getExamForStudent(Number(req.params.examId));
    const student = await queryOne<{ name: string; login_id: string }>(
      `SELECT u.name, COALESCE(ul.login_id, '') AS login_id
         FROM users u
         LEFT JOIN user_login_id ul ON ul.user_id = u.id
        WHERE u.id = $1`,
      [req.user!.userId],
    );
    ok(res, {
      exam,
      student: student ?? { name: '', login_id: '' },
    });
  } catch (err) { sendError(res, err); }
});

router.put('/exams/:examId', requireLogin, requireLecturer, requireExamOwnership, async (req, res) => {
  try { ok(res, await examService.updateExam(Number(req.params.examId), req.body)); }
  catch (err) { sendError(res, err); }
});

router.post('/exams/:examId/publish', requireLogin, requireLecturer, requireExamOwnership, async (req, res) => {
  try { ok(res, await examService.publishExam(Number(req.params.examId))); }
  catch (err) { sendError(res, err); }
});

router.post('/exams/:examId/close', requireLogin, requireLecturer, requireExamOwnership, async (req, res) => {
  try { ok(res, await examService.closeExam(Number(req.params.examId))); }
  catch (err) { sendError(res, err); }
});

router.delete('/exams/:examId', requireLogin, requireLecturer, requireExamOwnership, async (req, res) => {
  try { await examService.deleteExam(Number(req.params.examId)); ok(res, { deleted: true }); }
  catch (err) { sendError(res, err); }
});

router.put('/exams/:examId/proctoring-settings', requireLogin, requireLecturer, requireExamOwnership, async (req, res) => {
  try { ok(res, await examService.updateProctoringSettings(Number(req.params.examId), req.body)); }
  catch (err) { sendError(res, err); }
});

// --- Câu hỏi trong đề ---
router.post('/exams/:examId/questions/from-bank', requireLogin, requireLecturer, requireExamOwnership, async (req, res) => {
  try { ok(res, await examService.addQuestionsFromBank(Number(req.params.examId), req.body.bankQuestionIds), 201); }
  catch (err) { sendError(res, err); }
});

router.post('/exams/:examId/questions', requireLogin, requireLecturer, requireExamOwnership, async (req, res) => {
  try { ok(res, await examService.addManualQuestion(Number(req.params.examId), req.body), 201); }
  catch (err) { sendError(res, err); }
});

router.put('/exams/:examId/questions/reorder', requireLogin, requireLecturer, requireExamOwnership, async (req, res) => {
  try { await examService.reorderQuestions(Number(req.params.examId), req.body.orderedQuestionIds); ok(res, { reordered: true }); }
  catch (err) { sendError(res, err); }
});

router.delete('/exams/:examId/questions/:questionId', requireLogin, requireLecturer, requireExamOwnership, async (req, res) => {
  try { await examService.removeExamQuestion(Number(req.params.examId), Number(req.params.questionId)); ok(res, { deleted: true }); }
  catch (err) { sendError(res, err); }
});

// ===========================================================================
// GIÁM SÁT TRỰC TIẾP + NHẬT KÝ VI PHẠM + CHẤM ĐIỂM (GIẢNG VIÊN)
// ===========================================================================
router.get('/exams/:examId/monitor/live', requireLogin, requireLecturer, requireExamOwnership, async (req, res) => {
  try { ok(res, await statsService.getLiveMonitorGrid(Number(req.params.examId))); }
  catch (err) { sendError(res, err); }
});

router.post('/exams/:examId/monitor/broadcast', requireLogin, requireLecturer, requireExamOwnership, async (req, res) => {
  try {
    const examId = Number(req.params.examId);
    const message = String(req.body?.message ?? '').trim();
    if (!message) throw new HttpError(400, 'Nội dung thông báo không được để trống');
    const notice = { id: randomUUID(), scope: 'broadcast' as const, message, sentAt: new Date().toISOString() };
    const activeAttempts = await query<{ id: number }>(
      `SELECT id FROM exam_attempts WHERE exam_id = $1 AND status = 'in_progress'`,
      [examId],
    );
    for (const a of activeAttempts) queueSupervisorNotice(a.id, notice);
    notifyExamStudentsBroadcast(examId, notice);
    ok(res, { sent: true, recipients: activeAttempts.length, notice });
  } catch (err) { sendError(res, err); }
});

router.post('/attempts/:attemptId/monitor/warn', requireLogin, requireLecturer, requireAttemptExamOwnership, async (req, res) => {
  try {
    const attemptId = Number(req.params.attemptId);
    const message = String(req.body?.message ?? '').trim();
    if (!message) throw new HttpError(400, 'Nội dung nhắc nhở không được để trống');
    const notice = { id: randomUUID(), scope: 'direct' as const, message, sentAt: new Date().toISOString() };
    queueSupervisorNotice(attemptId, notice);
    notifyStudentDirectWarning(attemptId, notice);
    ok(res, { sent: true, notice });
  } catch (err) { sendError(res, err); }
});

router.post('/attempts/:attemptId/force-submit', requireLogin, requireLecturer, requireAttemptExamOwnership, async (req, res) => {
  try {
    const attemptId = Number(req.params.attemptId);
    const reasonMessage = String(req.body?.reason ?? 'Giám thị đã thu bài thi do vi phạm quy chế phòng thi.').trim();
    const submitted = await attemptService.submitAttempt(attemptId, 'lecturer');
    notifyStudentForceSubmitted(attemptId, reasonMessage);
    ok(res, { submitted: true, attempt: submitted });
  } catch (err) { sendError(res, err); }
});

router.get('/attempts/:attemptId/live-snapshot', requireLogin, requireLecturer, requireAttemptExamOwnership, async (req, res) => {
  try {
    const attemptId = Number(req.params.attemptId);
    const att = await queryOne<{ reference_photo_path: string | null }>(
      'SELECT reference_photo_path FROM exam_attempts WHERE id = $1',
      [attemptId],
    );
    const buf = await readLatestAttemptFrame(attemptId, att?.reference_photo_path);
    if (!buf) return res.status(404).json({ success: false, error: 'Chưa có hình ảnh camera' });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  } catch (err) { sendError(res, err); }
});

router.get('/exams/:examId/violations', requireLogin, requireLecturer, requireExamOwnership, async (req, res) => {
  try { ok(res, await statsService.listExamViolations(Number(req.params.examId), { onlyFlagged: req.query.onlyFlagged === 'true' })); }
  catch (err) { sendError(res, err); }
});

router.get('/attempts/:attemptId/behavior-stats', requireLogin, requireLecturer, requireAttemptExamOwnership, async (req, res) => {
  try { ok(res, await statsService.getAttemptBehaviorStats(Number(req.params.attemptId))); }
  catch (err) { sendError(res, err); }
});

router.get('/attempts/:attemptId/timeline', requireLogin, requireLecturer, requireAttemptExamOwnership, async (req, res) => {
  try { ok(res, await statsService.getAttemptTimeline(Number(req.params.attemptId))); }
  catch (err) { sendError(res, err); }
});

/** Review từng sự kiện vi phạm — giảng viên phải là chủ/collaborator của lớp chứa đề thi đó. */
const REVIEW_STATUSES = ['pending', 'confirmed_cheating', 'dismissed'];
router.put('/proctoring-events/:eventId/review', requireLogin, requireLecturer, async (req, res) => {
  try {
    const rawStatus = req.body?.status === 'confirmed' ? 'confirmed_cheating' : req.body?.status;
    const note = req.body?.note;
    if (!REVIEW_STATUSES.includes(rawStatus)) throw new HttpError(400, 'Trạng thái review không hợp lệ');
    const owns = await queryOne(
      `SELECT 1 FROM proctoring_events pe
         JOIN exam_attempts a ON a.id = pe.attempt_id
         JOIN exams e ON e.id = a.exam_id
         JOIN classes c ON c.id = e.class_id
        WHERE pe.id = $1 AND (c.lecturer_id = $2
          OR EXISTS (SELECT 1 FROM class_collaborators cc WHERE cc.class_id = c.id AND cc.lecturer_id = $2))`,
      [req.params.eventId, req.user!.userId],
    );
    if (!owns) throw new HttpError(403, 'Bạn không có quyền review sự kiện này');
    await query(
      `UPDATE proctoring_events
          SET review_status = $2, review_note = $3, reviewed_by = $4, reviewed_at = NOW()
        WHERE id = $1`,
      [req.params.eventId, rawStatus, note ?? null, req.user!.userId],
    );
    ok(res, { updated: true, review_status: rawStatus });
  } catch (err) { sendError(res, err); }
});

/** Review kết luận tổng thể attempt */
const ATTEMPT_VERDICTS = ['unreviewed', 'clean', 'suspected', 'confirmed_cheating'];
router.put('/attempts/:attemptId/review', requireLogin, requireLecturer, requireAttemptExamOwnership, async (req, res) => {
  try {
    const rawVerdict = req.body?.verdict;
    const verdict =
      rawVerdict === 'suspicious'
        ? 'suspected'
        : rawVerdict === 'cheating'
          ? 'confirmed_cheating'
          : rawVerdict;
    const note = req.body?.note;
    if (!ATTEMPT_VERDICTS.includes(verdict)) throw new HttpError(400, 'Kết luận review không hợp lệ');
    await query(
      `UPDATE exam_attempts
          SET review_verdict = $2, review_note = $3, reviewed_by = $4, reviewed_at = NOW()
        WHERE id = $1`,
      [req.params.attemptId, verdict, note ?? null, req.user!.userId],
    );
    ok(res, { updated: true, verdict });
  } catch (err) { sendError(res, err); }
});

/** Stream ảnh bằng chứng — chỉ giảng viên có quyền trên đề thi chứa attempt (ảnh khuôn mặt là dữ liệu nhạy cảm). */
router.get('/attempts/:attemptId/evidence/:evidenceId', requireLogin, requireLecturer, requireAttemptExamOwnership, async (req, res) => {
  try {
    const ev = await queryOne<{ file_path: string }>(
      'SELECT file_path FROM proctoring_evidence WHERE id = $1 AND attempt_id = $2 AND deleted_at IS NULL',
      [req.params.evidenceId, req.params.attemptId],
    );
    if (!ev) return res.status(404).json({ success: false, error: 'Không tìm thấy ảnh' });
    const buf = await readEvidenceImage(ev.file_path);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  } catch (err) { sendError(res, err); }
});

/** Trạng thái AI cho giảng viên: AI chưa chạy / thiếu model / sẵn sàng + số liệu ingestion thật. */
router.get('/proctoring/ai-status', requireLogin, requireLecturer, async (_req, res) => {
  try { ok(res, { readiness: await aiReadiness(), ingestion: getIngestionMetrics() }); }
  catch (err) { sendError(res, err); }
});

router.get('/exams/:examId/grading', requireLogin, requireLecturer, requireExamOwnership, async (req, res) => {
  try { ok(res, await gradingService.listAttemptsForGrading(Number(req.params.examId))); }
  catch (err) { sendError(res, err); }
});

router.get('/attempts/:attemptId/grading', requireLogin, requireLecturer, requireAttemptExamOwnership, async (req, res) => {
  try { ok(res, await gradingService.getAttemptForGrading(Number(req.params.attemptId))); }
  catch (err) { sendError(res, err); }
});

router.put('/attempts/:attemptId/grading', requireLogin, requireLecturer, requireAttemptExamOwnership, async (req, res) => {
  try {
    const updated = await gradingService.gradeAttemptBatch(
      Number(req.params.attemptId), req.user!.userId, req.body.grades,
    );
    ok(res, updated);
  } catch (err) { sendError(res, err); }
});

router.put('/attempts/:attemptId/grading/:questionId', requireLogin, requireLecturer, requireAttemptExamOwnership, async (req, res) => {
  try {
    await gradingService.gradeEssayAnswer(
      Number(req.params.attemptId), Number(req.params.questionId), req.user!.userId, Number(req.body.score), req.body.comment,
    );
    ok(res, { graded: true });
  } catch (err) { sendError(res, err); }
});

// ===========================================================================
// PHÍA HỌC SINH
// ===========================================================================
router.get('/classes/:classId/exams/student', requireLogin, requireStudent, requireClassMembership, async (req, res) => {
  try {
    const exams = await examService.listExamsForClass(Number(req.params.classId));
    const studentId = req.user!.userId;
    const examIds = exams.map((e: any) => e.id);
    const attempts = examIds.length
      ? await query<any>(
          `SELECT ea.id, ea.exam_id, ea.student_id, ea.attempt_no, ea.status, ea.submit_reason,
                  ea.started_at, ea.deadline_at, ea.submitted_at, ea.total_score, ea.max_score, ea.grading_status,
                  (SELECT COUNT(*) FROM proctoring_events pe
                    WHERE pe.attempt_id = ea.id AND pe.is_confirmed = TRUE)::int AS violation_count
             FROM exam_attempts ea
            WHERE ea.student_id = $1 AND ea.exam_id = ANY($2)
            ORDER BY ea.attempt_no DESC`,
          [studentId, examIds],
        )
      : [];
    const now = new Date();
    const result = exams.filter((e: any) => e.status !== 'draft').map((e: any) => ({
      ...e,
      myAttempts: attempts
        .filter((a) => a.exam_id === e.id)
        .map((a) => {
          const vis = computeStudentResultVisibility({
            attemptStatus: a.status,
            resultVisibility: e.result_visibility,
            allowReview: e.allow_review,
            examEndTime: e.end_time,
            now,
          });
          return {
            ...a,
            resultVisible: vis.canSeeScore,
            total_score: vis.canSeeScore ? a.total_score : null,
          };
        }),
    }));
    ok(res, result);
  } catch (err) { sendError(res, err); }
});

router.post(
  '/exams/:examId/precheck',
  requireLogin,
  requireStudent,
  requireEnrolledInExamClass,
  rateLimit({ windowMs: 60_000, max: 15, key: (req) => `precheck:${req.user?.userId}:${req.params.examId}` }),
  upload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) throw new HttpError(400, 'Thiếu ảnh');
      ok(res, await attemptService.createPrecheckSession(Number(req.params.examId), req.user!.userId, req.file.buffer), 201);
    } catch (err) { sendError(res, err); }
  },
);

router.post(
  '/exams/:examId/attempts',
  requireLogin,
  requireStudent,
  requireEnrolledInExamClass,
  rateLimit({ windowMs: 60_000, max: 12, key: (req) => `start-attempt:${req.user?.userId}:${req.params.examId}` }),
  async (req, res) => {
    try {
      ok(res, await attemptService.startAttempt(Number(req.params.examId), req.user!.userId, req.body?.precheckId), 201);
    } catch (err) { sendError(res, err); }
  },
);

router.get('/attempts/:attemptId', requireLogin, requireStudent, requireAttemptOwner, async (req, res) => {
  try {
    ok(res, await attemptService.getAttemptForStudent(pool, Number(req.params.attemptId)));
  } catch (err) { sendError(res, err); }
});

router.put('/attempts/:attemptId/answers/:questionId', requireLogin, requireStudent, requireAttemptOwner, async (req, res) => {
  try {
    await attemptService.saveAnswer(Number(req.params.attemptId), Number(req.params.questionId), req.body);
    ok(res, { saved: true });
  } catch (err) { sendError(res, err); }
});

router.post('/attempts/:attemptId/submit', requireLogin, requireStudent, requireAttemptOwner, async (req, res) => {
  try { ok(res, await attemptService.submitAttempt(Number(req.params.attemptId), 'manual')); }
  catch (err) { sendError(res, err); }
});

/** Ghi nhận sự kiện trình duyệt (tab_hidden, window_blur, fullscreen_exit, camera_lost). */
router.post(
  '/attempts/:attemptId/events',
  requireLogin,
  requireStudent,
  requireAttemptOwner,
  rateLimit({ windowMs: 60_000, max: 60, key: (req) => `events:${req.params.attemptId}` }),
  async (req, res) => {
    try {
      const eventType = String(req.body?.eventType ?? '') as BrowserEventType;
      const active = req.body?.active !== false;
      const requestId = randomUUID();
      res.setHeader('X-Request-Id', requestId);
      ok(res, await ingestBrowserEvent(Number(req.params.attemptId), eventType, active, requestId));
    } catch (err) { sendError(res, err); }
  },
);

/** Ingestion frame giám sát. requestId (correlation ID) sinh ở đây, đi suốt Node → AI → DB (ai_payload). */
router.post(
  '/attempts/:attemptId/frames',
  requireLogin,
  requireStudent,
  requireAttemptOwner,
  rateLimit({ windowMs: 60_000, max: 60, key: (req) => `frames:${req.params.attemptId}` }),
  upload.single('frame'),
  async (req, res) => {
    try {
      if (!req.file) throw new HttpError(400, 'Thiếu frame');
      const requestId = randomUUID();
      res.setHeader('X-Request-Id', requestId);
      ok(res, await ingestFrame(Number(req.params.attemptId), req.file.buffer, requestId));
    } catch (err) { sendError(res, err); }
  },
);

export default router;
