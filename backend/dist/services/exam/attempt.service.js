"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPrecheckSession = createPrecheckSession;
exports.startAttempt = startAttempt;
exports.getAttemptForStudent = getAttemptForStudent;
exports.saveAnswer = saveAnswer;
exports.submitAttempt = submitAttempt;
exports.autoSubmitExpiredAttempts = autoSubmitExpiredAttempts;
const database_js_1 = require("../../config/database.js");
const http_error_js_1 = require("../../utils/http-error.js");
const ai_client_js_1 = require("../proctoring/ai-client.js");
const storage_js_1 = require("../proctoring/storage.js");
const PRECHECK_TTL_MINUTES = 10;
// ===========================================================================
// PRE-CHECK
// ===========================================================================
async function createPrecheckSession(examId, studentId, imageBuffer) {
    const exam = await (0, database_js_1.queryOne)('SELECT start_time, end_time FROM exams WHERE id = $1', [examId]);
    if (!exam)
        throw new http_error_js_1.HttpError(404, 'Không tìm thấy đề thi');
    const now = new Date();
    if (now < new Date(exam.start_time))
        throw new http_error_js_1.HttpError(400, 'Đề thi chưa mở');
    if (now > new Date(exam.end_time))
        throw new http_error_js_1.HttpError(400, 'Đề thi đã đóng');
    const result = await (0, ai_client_js_1.registerFace)(imageBuffer);
    if (!('embedding' in result) || !Array.isArray(result.embedding) || result.embedding.length === 0) {
        throw new http_error_js_1.HttpError(422, 'Không thể xác thực khuôn mặt. Vui lòng chụp lại ảnh rõ mặt và thử lại.');
    }
    const embedding = result.embedding;
    const photoPath = await (0, storage_js_1.saveEvidenceImage)(0, imageBuffer);
    const expiresAt = new Date(Date.now() + PRECHECK_TTL_MINUTES * 60 * 1000);
    const row = await (0, database_js_1.queryOne)(`INSERT INTO exam_precheck_sessions (exam_id, student_id, reference_embedding, reference_photo_path, expires_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`, [examId, studentId, embedding, photoPath, expiresAt]);
    return { precheckId: row.id, expiresAt };
}
// ===========================================================================
// BẮT ĐẦU LÀM BÀI
// ===========================================================================
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
async function startAttempt(examId, studentId, precheckId) {
    return (0, database_js_1.withTransaction)(async (client) => {
        const exam = await one(client, `SELECT * FROM exams WHERE id = $1 FOR SHARE`, [examId]);
        if (!exam)
            throw new http_error_js_1.HttpError(404, 'Không tìm thấy đề thi');
        if (exam.status !== 'published')
            throw new http_error_js_1.HttpError(400, 'Đề thi chưa được xuất bản');
        const now = new Date();
        if (now < new Date(exam.start_time))
            throw new http_error_js_1.HttpError(400, 'Đề thi chưa mở');
        if (now > new Date(exam.end_time))
            throw new http_error_js_1.HttpError(400, 'Đề thi đã đóng');
        // Check if there is already an in_progress attempt
        const existing = await one(client, `SELECT id FROM exam_attempts WHERE exam_id = $1 AND student_id = $2 AND status = 'in_progress'`, [examId, studentId]);
        if (existing) {
            return getAttemptForStudent(client, existing.id);
        }
        let refEmbedding = null;
        let refPhoto = null;
        if (!precheckId) {
            throw new http_error_js_1.HttpError(400, 'Bạn cần hoàn tất bước xác thực khuôn mặt trước khi bắt đầu thi');
        }
        const precheck = await one(client, `SELECT * FROM exam_precheck_sessions WHERE id = $1 FOR UPDATE`, [precheckId]);
        if (precheck && precheck.exam_id === examId && precheck.student_id === studentId &&
            !precheck.consumed_at && new Date(precheck.expires_at) > now) {
            refEmbedding = precheck.reference_embedding;
            refPhoto = precheck.reference_photo_path;
            await client.query('UPDATE exam_precheck_sessions SET consumed_at = $2 WHERE id = $1', [precheckId, now]);
        }
        if (!refEmbedding) {
            throw new http_error_js_1.HttpError(400, 'Phiên xác thực khuôn mặt đã hết hạn hoặc không hợp lệ');
        }
        const attemptCount = await client.query('SELECT COUNT(*)::int AS c FROM exam_attempts WHERE exam_id = $1 AND student_id = $2', [examId, studentId]);
        const nextAttemptNo = attemptCount.rows[0].c + 1;
        if (nextAttemptNo > exam.max_attempts)
            throw new http_error_js_1.HttpError(400, 'Bạn đã dùng hết số lần làm bài cho phép');
        const questions = (await client.query('SELECT id FROM exam_questions WHERE exam_id = $1 ORDER BY position', [examId])).rows;
        if (questions.length === 0)
            throw new http_error_js_1.HttpError(400, 'Đề thi chưa có câu hỏi');
        let questionOrder = questions.map((q) => q.id);
        if (exam.shuffle_questions)
            questionOrder = shuffle(questionOrder);
        const optionOrder = {};
        if (exam.shuffle_options) {
            const opts = (await client.query('SELECT id, exam_question_id FROM exam_question_options WHERE exam_question_id = ANY($1)', [questionOrder])).rows;
            for (const qId of questionOrder) {
                const ids = opts.filter((o) => o.exam_question_id === qId).map((o) => o.id);
                optionOrder[qId] = shuffle(ids);
            }
        }
        const deadline = new Date(Math.min(now.getTime() + exam.duration_minutes * 60 * 1000, new Date(exam.end_time).getTime()));
        const attempt = await one(client, `INSERT INTO exam_attempts
         (exam_id, student_id, attempt_no, started_at, deadline_at, question_order, option_order,
          reference_embedding, reference_photo_path, max_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
         (SELECT COALESCE(SUM(points),0) FROM exam_questions WHERE exam_id = $1))
       RETURNING *`, [examId, studentId, nextAttemptNo, now, deadline, questionOrder, JSON.stringify(optionOrder),
            refEmbedding, refPhoto]);
        return getAttemptForStudent(client, attempt.id);
    });
}
async function one(client, sql, params) {
    const { rows } = await client.query(sql, params);
    return rows[0] ?? null;
}
// ===========================================================================
// ĐỌC ATTEMPT
// ===========================================================================
async function getAttemptForStudent(clientOrPool, attemptId) {
    const attempt = await clientOrPool.query('SELECT * FROM exam_attempts WHERE id = $1', [attemptId]);
    const row = attempt.rows[0];
    if (!row)
        throw new http_error_js_1.HttpError(404, 'Không tìm thấy lần làm bài');
    const exam = (await clientOrPool.query(`SELECT e.name, e.description, e.duration_minutes, e.result_visibility, e.allow_review, e.end_time,
            u.name AS student_name, COALESCE(ul.login_id, '') AS login_id
       FROM exams e
       JOIN users u ON u.id = $2
       LEFT JOIN user_login_id ul ON ul.user_id = u.id
      WHERE e.id = $1`, [row.exam_id, row.student_id])).rows[0];
    const settings = (await clientOrPool.query('SELECT * FROM exam_proctoring_settings WHERE exam_id = $1', [row.exam_id])).rows[0];
    const questionRows = (await clientOrPool.query(`SELECT id, question_type, content, points FROM exam_questions WHERE exam_id = $1`, [row.exam_id])).rows;
    const byId = new Map(questionRows.map((q) => [q.id, q]));
    const optionRows = (await clientOrPool.query(`SELECT id, exam_question_id, content FROM exam_question_options WHERE exam_question_id = ANY($1)`, [row.question_order])).rows;
    const answers = (await clientOrPool.query(`SELECT exam_question_id, selected_option_ids, text_answer, file_path, is_flagged, is_correct, score, grader_comment
       FROM attempt_answers WHERE attempt_id = $1`, [attemptId])).rows;
    const canSeeResult = row.status !== 'in_progress' &&
        (exam.result_visibility === 'immediately' || new Date() >= new Date(exam.end_time));
    const answerByQ = new Map(answers.map((a) => [a.exam_question_id, canSeeResult ? a : {
            exam_question_id: a.exam_question_id,
            selected_option_ids: a.selected_option_ids,
            text_answer: a.text_answer,
            file_path: a.file_path,
            is_flagged: a.is_flagged,
        }]));
    const optionOrder = row.option_order ?? {};
    const orderedQuestions = row.question_order.map((qId, index) => {
        const q = byId.get(qId) || {};
        const ids = optionOrder[qId] ?? optionRows.filter((o) => o.exam_question_id === qId).map((o) => o.id);
        const options = ids.map((oid) => optionRows.find((o) => o.id === oid)).filter(Boolean)
            .map((o) => ({ id: o.id, content: o.content }));
        return { ...q, indexNumber: index + 1, options, answer: answerByQ.get(qId) ?? null };
    });
    const remainingSeconds = Math.max(0, Math.floor((new Date(row.deadline_at).getTime() - Date.now()) / 1000));
    return { ...row, exam, proctoringSettings: settings, remainingSeconds, questions: orderedQuestions };
}
// ===========================================================================
// TRẢ LỜI CÂU HỎI
// ===========================================================================
async function saveAnswer(attemptId, examQuestionId, payload) {
    await (0, database_js_1.withTransaction)(async (client) => {
        const attempt = await one(client, 'SELECT * FROM exam_attempts WHERE id = $1 FOR UPDATE', [attemptId]);
        if (!attempt)
            throw new http_error_js_1.HttpError(404, 'Không tìm thấy lần làm bài');
        if (attempt.status !== 'in_progress')
            throw new http_error_js_1.HttpError(400, 'Bài đã nộp, không thể sửa câu trả lời');
        if (new Date(attempt.deadline_at) < new Date())
            throw new http_error_js_1.HttpError(400, 'Đã hết thời gian làm bài');
        if (!attempt.question_order.includes(examQuestionId)) {
            throw new http_error_js_1.HttpError(400, 'Câu hỏi không thuộc lần làm bài này');
        }
        if (payload.selectedOptionIds?.length) {
            const valid = await client.query('SELECT id FROM exam_question_options WHERE exam_question_id = $1 AND id = ANY($2)', [examQuestionId, payload.selectedOptionIds]);
            if (valid.rows.length !== payload.selectedOptionIds.length) {
                throw new http_error_js_1.HttpError(400, 'Có lựa chọn không hợp lệ cho câu hỏi này');
            }
        }
        await client.query(`INSERT INTO attempt_answers (attempt_id, exam_question_id, selected_option_ids, text_answer, file_path, is_flagged)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (attempt_id, exam_question_id) DO UPDATE SET
         selected_option_ids = COALESCE(EXCLUDED.selected_option_ids, attempt_answers.selected_option_ids),
         text_answer = COALESCE(EXCLUDED.text_answer, attempt_answers.text_answer),
         file_path = COALESCE(EXCLUDED.file_path, attempt_answers.file_path),
         is_flagged = COALESCE(EXCLUDED.is_flagged, attempt_answers.is_flagged),
         answered_at = NOW()`, [attemptId, examQuestionId, payload.selectedOptionIds ?? null, payload.textAnswer ?? null,
            payload.filePath ?? null, payload.isFlagged ?? null]);
    });
}
// ===========================================================================
// NỘP BÀI + TỰ ĐỘNG CHẤM TRẮC NGHIỆM
// ===========================================================================
async function submitAttempt(attemptId, reason) {
    return (0, database_js_1.withTransaction)(async (client) => {
        const attempt = await one(client, 'SELECT * FROM exam_attempts WHERE id = $1 FOR UPDATE', [attemptId]);
        if (!attempt)
            throw new http_error_js_1.HttpError(404, 'Không tìm thấy lần làm bài');
        if (attempt.status === 'submitted')
            return attempt;
        await client.query(`UPDATE proctoring_events SET ended_at = last_seen_at
        WHERE attempt_id = $1 AND ended_at IS NULL AND is_confirmed = TRUE`, [attemptId]);
        await client.query(`DELETE FROM proctoring_events WHERE attempt_id = $1 AND ended_at IS NULL AND is_confirmed = FALSE`, [attemptId]);
        const gradeResult = await autoGradeObjectiveQuestions(client, attempt.exam_id, attemptId);
        const hasUngraded = await client.query(`SELECT 1 FROM exam_questions eq
        WHERE eq.exam_id = $1 AND eq.question_type IN ('essay','file_upload')
          AND EXISTS (SELECT 1 FROM attempt_answers aa WHERE aa.attempt_id = $2 AND aa.exam_question_id = eq.id)
        LIMIT 1`, [attempt.exam_id, attemptId]);
        await client.query(`UPDATE exam_attempts SET
         status='submitted', submitted_at=NOW(), submit_reason=$2,
         total_score=$3, grading_status=$4
       WHERE id=$1`, [attemptId, reason, gradeResult.totalScore,
            hasUngraded.rows.length ? 'needs_manual' : 'graded']);
        return one(client, 'SELECT * FROM exam_attempts WHERE id = $1', [attemptId]);
    });
}
async function autoGradeObjectiveQuestions(client, examId, attemptId) {
    const questions = (await client.query(`SELECT id, question_type, points FROM exam_questions WHERE exam_id = $1
       AND question_type IN ('single_choice','multiple_choice')`, [examId])).rows;
    let totalScore = 0;
    for (const q of questions) {
        const correctOptions = (await client.query('SELECT id FROM exam_question_options WHERE exam_question_id = $1 AND is_correct = TRUE', [q.id])).rows.map((r) => r.id).sort();
        const answer = (await client.query('SELECT selected_option_ids FROM attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2', [attemptId, q.id])).rows[0];
        const selected = (answer?.selected_option_ids ?? []).slice().sort();
        const isCorrect = selected.length === correctOptions.length &&
            selected.every((id, i) => id === correctOptions[i]);
        const score = isCorrect ? Number(q.points) : 0;
        totalScore += score;
        if (answer) {
            await client.query('UPDATE attempt_answers SET is_correct=$3, score=$4 WHERE attempt_id=$1 AND exam_question_id=$2', [attemptId, q.id, isCorrect, score]);
        }
        else {
            await client.query(`INSERT INTO attempt_answers (attempt_id, exam_question_id, selected_option_ids, is_correct, score)
         VALUES ($1,$2,'{}',FALSE,0)`, [attemptId, q.id]);
        }
    }
    return { totalScore };
}
// ===========================================================================
// JOB: tự động nộp bài khi hết giờ
// ===========================================================================
async function autoSubmitExpiredAttempts() {
    const expired = await (0, database_js_1.query)(`SELECT id FROM exam_attempts WHERE status = 'in_progress' AND deadline_at <= NOW()`);
    for (const row of expired) {
        await submitAttempt(row.id, 'time_up').catch((err) => {
            console.error(`[auto-submit] Lỗi khi tự nộp attempt ${row.id}:`, err);
        });
    }
    return expired.length;
}
//# sourceMappingURL=attempt.service.js.map