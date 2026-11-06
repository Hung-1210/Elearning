// src/services/exam/grading.service.ts
import type { PoolClient } from 'pg';
import { query, queryOne, withTransaction } from '../../config/database.js';
import { HttpError } from '../../utils/http-error.js';

let auditSchemaReady = false;
export async function ensureGradingAuditSchema() {
  if (auditSchemaReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS attempt_grade_audit_logs (
      id               SERIAL PRIMARY KEY,
      attempt_id       INTEGER NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
      exam_question_id INTEGER NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
      changed_by       INTEGER NOT NULL REFERENCES users(id),
      old_score        NUMERIC(6,2),
      new_score        NUMERIC(6,2) NOT NULL,
      old_comment      TEXT,
      new_comment      TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_grade_audit_attempt
      ON attempt_grade_audit_logs(attempt_id, created_at DESC);
  `);
  auditSchemaReady = true;
}

export async function listAttemptsForGrading(examId: number) {
  const exam = await queryOne<any>(
    `SELECT e.id, e.class_id, c.name AS class_name, e.name, e.duration_minutes, e.result_visibility, e.allow_review,
            (SELECT COUNT(*) FROM classes_n_students cs WHERE cs.class_id = e.class_id)::int AS total_enrolled,
            (SELECT COALESCE(SUM(points), 0) FROM exam_questions eq WHERE eq.exam_id = e.id)::numeric AS max_score
       FROM exams e
       JOIN classes c ON c.id = e.class_id
      WHERE e.id = $1`,
    [examId],
  );
  if (!exam) throw new HttpError(404, 'Không tìm thấy đề thi');

  const rows = await query<any>(
    `SELECT a.id AS attempt_id, u.id AS student_id, u.name AS student_name,
            COALESCE(ul.login_id, '') AS login_id,
            a.status, a.total_score, a.max_score,
            a.grading_status, a.submitted_at, a.started_at, a.submit_reason, a.review_verdict,
            (SELECT COALESCE(SUM(aa.score), 0)
               FROM attempt_answers aa
               JOIN exam_questions eq ON eq.id = aa.exam_question_id
              WHERE aa.attempt_id = a.id AND eq.question_type IN ('single_choice', 'multiple_choice'))::numeric AS objective_score,
            (SELECT COALESCE(SUM(aa.score), 0)
               FROM attempt_answers aa
               JOIN exam_questions eq ON eq.id = aa.exam_question_id
              WHERE aa.attempt_id = a.id AND eq.question_type IN ('essay', 'file_upload'))::numeric AS essay_score,
            (SELECT COUNT(*) FROM proctoring_events pe WHERE pe.attempt_id = a.id AND pe.is_confirmed = TRUE)::int AS violation_count
       FROM exam_attempts a
       JOIN users u ON u.id = a.student_id
       LEFT JOIN user_login_id ul ON ul.user_id = u.id
      WHERE a.exam_id = $1 AND a.status = 'submitted'
      ORDER BY a.submitted_at DESC`,
    [examId],
  );

  const submissions = rows.map((r) => {
    const totalScore = Number(r.total_score ?? 0);
    return {
      attempt_id: String(r.attempt_id),
      student_id: String(r.student_id),
      student_name: r.student_name,
      student_code: r.login_id,
      submitted_at: r.submitted_at,
      started_at: r.started_at,
      submit_reason: r.submit_reason,
      objective_score: Number(r.objective_score ?? 0),
      essay_score: Number(r.essay_score ?? 0),
      total_score: totalScore,
      max_score: Number(r.max_score ?? exam.max_score ?? 0),
      final_score: totalScore,
      grading_status: r.grading_status,
      status: r.grading_status === 'graded' ? 'graded' : 'submitted',
      violations_count: Number(r.violation_count ?? 0),
      review_verdict: r.review_verdict,
      needs_manual_grading: r.grading_status === 'needs_manual',
    };
  });

  return { exam, submissions };
}

export async function getAttemptForGrading(attemptId: number) {
  await ensureGradingAuditSchema();
  const rawAttempt = await queryOne<any>(
    `SELECT a.*, u.name AS student_name, COALESCE(ul.login_id, '') AS login_id,
            e.name AS exam_name, e.class_id, c.name AS class_name
       FROM exam_attempts a
       JOIN users u ON u.id = a.student_id
       LEFT JOIN user_login_id ul ON ul.user_id = u.id
       JOIN exams e ON e.id = a.exam_id
       JOIN classes c ON c.id = e.class_id
      WHERE a.id = $1`,
    [attemptId],
  );
  if (!rawAttempt) throw new HttpError(404, 'Không tìm thấy lần làm bài');

  const { reference_embedding: _emb, reference_photo_path: _photo, ...attempt } = rawAttempt;

  const questions = await query<any>(
    `SELECT eq.id, eq.position, eq.question_type, eq.content, eq.explanation, eq.points,
            aa.selected_option_ids, aa.text_answer, aa.file_path, aa.is_correct,
            aa.score, aa.grader_comment, aa.is_flagged, aa.graded_at
       FROM exam_questions eq
       LEFT JOIN attempt_answers aa ON aa.exam_question_id = eq.id AND aa.attempt_id = $2
      WHERE eq.exam_id = $1 ORDER BY eq.position`,
    [attempt.exam_id, attemptId],
  );
  const options = questions.length
    ? await query<any>(
        `SELECT id, exam_question_id, content, is_correct, position FROM exam_question_options
          WHERE exam_question_id = ANY($1) ORDER BY position`,
        [questions.map((q) => q.id)],
      )
    : [];

  const auditLogs = await query<any>(
    `SELECT al.id, al.exam_question_id, al.old_score, al.new_score, al.old_comment, al.new_comment,
            al.created_at, u.name AS grader_name
       FROM attempt_grade_audit_logs al
       JOIN users u ON u.id = al.changed_by
      WHERE al.attempt_id = $1
      ORDER BY al.created_at DESC
      LIMIT 50`,
    [attemptId],
  );

  const enrichedQuestions = questions.map((q) => ({
    ...q,
    options: options.filter((o) => o.exam_question_id === q.id),
  }));

  const answers = enrichedQuestions.map((q) => ({
    question_id: String(q.id),
    question_content: q.content,
    explanation: q.explanation ?? null,
    type: q.question_type as 'single_choice' | 'multiple_choice' | 'essay' | 'file_upload',
    max_points: Number(q.points ?? 0),
    earned_points: Number(q.score ?? 0),
    is_graded: q.graded_at !== null || q.question_type === 'single_choice' || q.question_type === 'multiple_choice',
    student_answer_text: q.text_answer ?? '',
    file_path: q.file_path ?? null,
    student_selected_options: (q.selected_option_ids ?? []).map(String),
    options: q.options.map((o: any) => ({
      id: String(o.id),
      content: o.content,
      is_correct: Boolean(o.is_correct),
    })),
    is_correct: q.is_correct,
    teacher_feedback: q.grader_comment ?? '',
  }));

  return {
    ...attempt,
    questions: enrichedQuestions,
    answers,
    audit_logs: auditLogs,
  };
}

async function applySingleQuestionGrade(
  client: PoolClient,
  attemptId: number,
  examQuestionId: number,
  graderId: number,
  score: number,
  comment?: string,
) {
  if (!Number.isFinite(score)) {
    throw new HttpError(400, 'Điểm chấm không hợp lệ');
  }
  const q = await client.query<{ points: string; question_type: string }>(
    `SELECT points, question_type FROM exam_questions
      WHERE id = $1 AND exam_id = (SELECT exam_id FROM exam_attempts WHERE id = $2)`,
    [examQuestionId, attemptId],
  );
  if (!q.rows[0]) throw new HttpError(404, 'Câu hỏi không thuộc lần làm bài này');
  const maxPoints = Number(q.rows[0].points);
  if (score < 0 || score > maxPoints) {
    throw new HttpError(400, `Điểm câu hỏi phải nằm trong khoảng 0 - ${maxPoints}`);
  }

  const prev = (await client.query<{ score: string | null; grader_comment: string | null }>(
    'SELECT score, grader_comment FROM attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2 FOR UPDATE',
    [attemptId, examQuestionId],
  )).rows[0];

  const oldScore = prev?.score !== null && prev?.score !== undefined ? Number(prev.score) : null;
  const oldComment = prev?.grader_comment ?? null;
  const newComment = comment ?? null;

  await client.query(
    `INSERT INTO attempt_answers (attempt_id, exam_question_id, score, grader_comment, graded_by, graded_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (attempt_id, exam_question_id) DO UPDATE SET
       score = EXCLUDED.score,
       grader_comment = EXCLUDED.grader_comment,
       graded_by = EXCLUDED.graded_by,
       graded_at = NOW()`,
    [attemptId, examQuestionId, score, newComment, graderId],
  );

  const scoreChanged = oldScore === null || Math.abs(oldScore - score) > 1e-6;
  const commentChanged = (oldComment ?? '') !== (newComment ?? '');
  if (scoreChanged || commentChanged) {
    await client.query(
      `INSERT INTO attempt_grade_audit_logs
         (attempt_id, exam_question_id, changed_by, old_score, new_score, old_comment, new_comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [attemptId, examQuestionId, graderId, oldScore, score, oldComment, newComment],
    );
  }
}

async function recalculateAttemptTotals(client: PoolClient, attemptId: number) {
  const totals = await client.query<{ total: string; remaining_manual: number }>(
    `SELECT COALESCE(SUM(COALESCE(score, 0)), 0)::numeric AS total,
            (SELECT COUNT(*) FROM exam_questions eq
              WHERE eq.exam_id = (SELECT exam_id FROM exam_attempts WHERE id = $1)
                AND eq.question_type IN ('essay', 'file_upload')
                AND NOT EXISTS (
                  SELECT 1 FROM attempt_answers aa
                   WHERE aa.attempt_id = $1 AND aa.exam_question_id = eq.id AND aa.graded_at IS NOT NULL
                )
            )::int AS remaining_manual
       FROM attempt_answers WHERE attempt_id = $1`,
    [attemptId],
  );
  const remaining = totals.rows[0].remaining_manual;
  await client.query(
    `UPDATE exam_attempts SET total_score = $2, grading_status = $3, graded_at = NOW() WHERE id = $1`,
    [attemptId, totals.rows[0].total, remaining > 0 ? 'needs_manual' : 'graded'],
  );
}

export async function gradeEssayAnswer(
  attemptId: number, examQuestionId: number, graderId: number, score: number, comment?: string,
) {
  await ensureGradingAuditSchema();
  await withTransaction(async (client) => {
    const attempt = (await client.query('SELECT status FROM exam_attempts WHERE id = $1 FOR UPDATE', [attemptId])).rows[0];
    if (!attempt) throw new HttpError(404, 'Không tìm thấy lần làm bài');
    if (attempt.status !== 'submitted') throw new HttpError(400, 'Chỉ được chấm bài đã nộp');
    await applySingleQuestionGrade(client, attemptId, examQuestionId, graderId, score, comment);
    await recalculateAttemptTotals(client, attemptId);
  });
}

export async function gradeAttemptBatch(
  attemptId: number,
  graderId: number,
  grades: Array<{ question_id: number | string; points: number; feedback?: string }>,
) {
  if (!Array.isArray(grades) || grades.length === 0) {
    throw new HttpError(400, 'Danh sách điểm cần lưu không hợp lệ');
  }
  await ensureGradingAuditSchema();
  await withTransaction(async (client) => {
    const attempt = (await client.query('SELECT status FROM exam_attempts WHERE id = $1 FOR UPDATE', [attemptId])).rows[0];
    if (!attempt) throw new HttpError(404, 'Không tìm thấy lần làm bài');
    if (attempt.status !== 'submitted') throw new HttpError(400, 'Chỉ được chấm bài đã nộp');

    for (const item of grades) {
      const qId = Number(item.question_id);
      if (!Number.isFinite(qId) || qId <= 0) throw new HttpError(400, 'Mã câu hỏi không hợp lệ');
      await applySingleQuestionGrade(client, attemptId, qId, graderId, Number(item.points), item.feedback);
    }
    await recalculateAttemptTotals(client, attemptId);
  });
  return getAttemptForGrading(attemptId);
}
