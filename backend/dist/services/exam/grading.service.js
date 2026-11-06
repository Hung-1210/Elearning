"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAttemptsForGrading = listAttemptsForGrading;
exports.getAttemptForGrading = getAttemptForGrading;
exports.gradeEssayAnswer = gradeEssayAnswer;
// src/services/exam/grading.service.ts
const database_js_1 = require("../../config/database.js");
const http_error_js_1 = require("../../utils/http-error.js");
async function listAttemptsForGrading(examId) {
    return (0, database_js_1.query)(`SELECT a.id AS attempt_id, u.id AS student_id, u.name AS student_name,
            COALESCE(ul.login_id, '') AS login_id,
            a.status, a.total_score, a.max_score,
            a.grading_status, a.submitted_at, a.started_at, a.submit_reason,
            (SELECT COUNT(*) FROM proctoring_events pe WHERE pe.attempt_id = a.id AND pe.is_confirmed = TRUE)::int AS violation_count
       FROM exam_attempts a
       JOIN users u ON u.id = a.student_id
       LEFT JOIN user_login_id ul ON ul.user_id = u.id
      WHERE a.exam_id = $1 AND a.status = 'submitted'
      ORDER BY a.submitted_at DESC`, [examId]);
}
async function getAttemptForGrading(attemptId) {
    const attempt = await (0, database_js_1.queryOne)(`SELECT a.*, u.name AS student_name, COALESCE(ul.login_id, '') AS login_id, e.name AS exam_name
       FROM exam_attempts a
       JOIN users u ON u.id = a.student_id
       LEFT JOIN user_login_id ul ON ul.user_id = u.id
       JOIN exams e ON e.id = a.exam_id
      WHERE a.id = $1`, [attemptId]);
    if (!attempt)
        throw new http_error_js_1.HttpError(404, 'Không tìm thấy lần làm bài');
    const questions = await (0, database_js_1.query)(`SELECT eq.id, eq.question_type, eq.content, eq.explanation, eq.points,
            aa.selected_option_ids, aa.text_answer, aa.file_path, aa.is_correct, aa.score, aa.grader_comment, aa.is_flagged
       FROM exam_questions eq
       LEFT JOIN attempt_answers aa ON aa.exam_question_id = eq.id AND aa.attempt_id = $2
      WHERE eq.exam_id = $1 ORDER BY eq.position`, [attempt.exam_id, attemptId]);
    const options = await (0, database_js_1.query)(`SELECT id, exam_question_id, content, is_correct, position FROM exam_question_options
      WHERE exam_question_id = ANY($1) ORDER BY position`, [questions.map((q) => q.id)]);
    return {
        ...attempt,
        questions: questions.map((q) => ({ ...q, options: options.filter((o) => o.exam_question_id === q.id) })),
    };
}
async function gradeEssayAnswer(attemptId, examQuestionId, graderId, score, comment) {
    await (0, database_js_1.withTransaction)(async (client) => {
        const q = await client.query('SELECT points FROM exam_questions WHERE id = $1 AND exam_id = (SELECT exam_id FROM exam_attempts WHERE id=$2)', [examQuestionId, attemptId]);
        if (!q.rows[0])
            throw new http_error_js_1.HttpError(404, 'Câu hỏi không thuộc lần làm bài này');
        if (score < 0 || score > Number(q.rows[0].points)) {
            throw new http_error_js_1.HttpError(400, `Điểm phải trong khoảng 0 - ${q.rows[0].points}`);
        }
        await client.query(`UPDATE attempt_answers SET score=$3, grader_comment=$4, graded_by=$5, graded_at=NOW()
        WHERE attempt_id=$1 AND exam_question_id=$2`, [attemptId, examQuestionId, score, comment ?? null, graderId]);
        const totals = await client.query(`SELECT SUM(COALESCE(score,0))::numeric AS total,
              (SELECT COUNT(*) FROM exam_questions eq
                WHERE eq.exam_id = (SELECT exam_id FROM exam_attempts WHERE id=$1)
                  AND eq.question_type IN ('essay','file_upload')
                  AND NOT EXISTS (
                    SELECT 1 FROM attempt_answers aa
                     WHERE aa.attempt_id=$1 AND aa.exam_question_id=eq.id AND aa.graded_at IS NOT NULL
                  )
              )::int AS remaining_manual
         FROM attempt_answers WHERE attempt_id = $1`, [attemptId]);
        const remaining = totals.rows[0].remaining_manual;
        await client.query(`UPDATE exam_attempts SET total_score=$2, grading_status=$3, graded_at=NOW() WHERE id=$1`, [attemptId, totals.rows[0].total, remaining > 0 ? 'needs_manual' : 'graded']);
    });
}
//# sourceMappingURL=grading.service.js.map