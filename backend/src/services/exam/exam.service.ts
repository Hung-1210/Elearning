// src/services/exam/exam.service.ts
import type { PoolClient } from 'pg';
import { pool, query, queryOne, withTransaction } from '../../config/database.js';
import { HttpError } from '../../utils/http-error.js';
import { DEFAULT_SETTINGS, GAZE_PRESETS, resolveProctoringSettings, type ProctoringSettings } from '../proctoring/policy.js';

// ===========================================================================
// NGÂN HÀNG CÂU HỎI
// ===========================================================================
export type QuestionType = 'single_choice' | 'multiple_choice' | 'essay' | 'file_upload';

export interface BankQuestionInput {
  questionType: QuestionType;
  content: string;
  explanation?: string;
  defaultPoints?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  chapter?: string;
  tags?: string[];
  options?: Array<{ content: string; isCorrect?: boolean; is_correct?: boolean }>;
}

const VALID_QUESTION_TYPES: ReadonlySet<string> = new Set([
  'single_choice',
  'multiple_choice',
  'essay',
  'file_upload',
]);

export function normalizeAndValidateQuestionPayload(input: {
  questionType: string;
  content: string;
  explanation?: string | null;
  points?: number;
  difficulty?: string;
  chapter?: string | null;
  tags?: string[];
  options?: Array<{ content: string; isCorrect?: boolean; is_correct?: boolean }>;
}) {
  if (!VALID_QUESTION_TYPES.has(input.questionType)) {
    throw new HttpError(400, 'Loại câu hỏi không hợp lệ');
  }
  const questionType = input.questionType as QuestionType;
  const content = String(input.content ?? '').trim();
  if (!content) {
    throw new HttpError(400, 'Nội dung câu hỏi không được để trống');
  }

  const rawPoints = input.points !== undefined ? Number(input.points) : 1;
  if (!Number.isFinite(rawPoints) || rawPoints <= 0 || rawPoints > 9999) {
    throw new HttpError(400, 'Điểm câu hỏi phải lớn hơn 0');
  }
  const points = Math.round(rawPoints * 100) / 100;

  const difficulty: 'easy' | 'medium' | 'hard' =
    input.difficulty === 'easy' || input.difficulty === 'hard' ? input.difficulty : 'medium';

  const explanation = input.explanation?.trim() ? input.explanation.trim() : null;
  const chapter = input.chapter?.trim() ? input.chapter.trim().slice(0, 100) : null;
  const tags = Array.isArray(input.tags)
    ? input.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  if (questionType === 'essay' || questionType === 'file_upload') {
    return { questionType, content, explanation, points, difficulty, chapter, tags, options: [] };
  }

  const cleanedOptions = (input.options ?? [])
    .map((o) => ({
      content: String(o?.content ?? '').trim(),
      isCorrect: Boolean(o?.isCorrect ?? o?.is_correct),
    }))
    .filter((o) => o.content.length > 0);

  if (cleanedOptions.length < 2) {
    throw new HttpError(400, 'Câu hỏi trắc nghiệm cần tối thiểu 2 lựa chọn có nội dung');
  }
  const correctCount = cleanedOptions.filter((o) => o.isCorrect).length;
  if (correctCount === 0) {
    throw new HttpError(400, 'Cần tích chọn ít nhất 1 đáp án đúng');
  }
  if (questionType === 'single_choice' && correctCount > 1) {
    throw new HttpError(400, 'Câu hỏi 1 đáp án đúng (single_choice) không được có nhiều hơn 1 lựa chọn đúng');
  }

  return {
    questionType,
    content,
    explanation,
    points,
    difficulty,
    chapter,
    tags,
    options: cleanedOptions,
  };
}

export async function createBankQuestion(classId: number, lecturerId: number, input: BankQuestionInput) {
  const normalized = normalizeAndValidateQuestionPayload({
    questionType: input.questionType,
    content: input.content,
    explanation: input.explanation,
    points: input.defaultPoints ?? 1,
    difficulty: input.difficulty,
    chapter: input.chapter,
    tags: input.tags,
    options: input.options,
  });

  const questionId = await withTransaction(async (client) => {
    const q = await client.query(
      `INSERT INTO bank_questions
         (class_id, created_by, question_type, content, explanation, default_points, difficulty, chapter, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        classId,
        lecturerId,
        normalized.questionType,
        normalized.content,
        normalized.explanation,
        normalized.points,
        normalized.difficulty,
        normalized.chapter,
        normalized.tags,
      ],
    );
    const createdId = q.rows[0].id as number;
    await insertOptions(client, 'bank_question_options', 'question_id', createdId, normalized.options);
    return createdId;
  });

  return getBankQuestion(questionId);
}

export async function updateBankQuestion(questionId: number, input: BankQuestionInput) {
  const normalized = normalizeAndValidateQuestionPayload({
    questionType: input.questionType,
    content: input.content,
    explanation: input.explanation,
    points: input.defaultPoints ?? 1,
    difficulty: input.difficulty,
    chapter: input.chapter,
    tags: input.tags,
    options: input.options,
  });

  await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE bank_questions SET question_type=$2, content=$3, explanation=$4, default_points=$5,
              difficulty=$6, chapter=$7, tags=$8, updated_at=NOW()
        WHERE id=$1`,
      [
        questionId,
        normalized.questionType,
        normalized.content,
        normalized.explanation,
        normalized.points,
        normalized.difficulty,
        normalized.chapter,
        normalized.tags,
      ],
    );
    if (updated.rowCount === 0) {
      throw new HttpError(404, 'Không tìm thấy câu hỏi');
    }
    await client.query('DELETE FROM bank_question_options WHERE question_id = $1', [questionId]);
    await insertOptions(client, 'bank_question_options', 'question_id', questionId, normalized.options);
  });

  return getBankQuestion(questionId);
}

async function insertOptions(
  client: PoolClient, table: string, fkCol: string, parentId: number,
  options?: Array<{ content: string; isCorrect: boolean }>,
) {
  if (!options?.length) return;
  const values: any[] = [];
  const placeholders = options.map((o, i) => {
    values.push(parentId, o.content, o.isCorrect, i);
    const base = i * 4;
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4})`;
  });
  await client.query(
    `INSERT INTO ${table} (${fkCol}, content, is_correct, position) VALUES ${placeholders.join(',')}`,
    values,
  );
}

export async function getBankQuestion(id: number, dbClient?: PoolClient) {
  const selectSql = `
    SELECT bq.*,
           u.name AS creator_name,
           (SELECT COUNT(DISTINCT eq.exam_id) FROM exam_questions eq WHERE eq.source_bank_question_id = bq.id)::int AS used_in_exams_count
      FROM bank_questions bq
      LEFT JOIN users u ON u.id = bq.created_by
     WHERE bq.id = $1
  `;
  const optionsSql = `
    SELECT id, question_id, content, is_correct, position
      FROM bank_question_options
     WHERE question_id = $1
     ORDER BY position
  `;

  if (dbClient) {
    const qRes = await dbClient.query(selectSql, [id]);
    const question = qRes.rows[0] ?? null;
    if (!question) throw new HttpError(404, 'Không tìm thấy câu hỏi');
    const optRes = await dbClient.query(optionsSql, [id]);
    return { ...question, options: optRes.rows };
  }

  const question = await queryOne(selectSql, [id]);
  if (!question) throw new HttpError(404, 'Không tìm thấy câu hỏi');
  const options = await query(optionsSql, [id]);
  return { ...question, options };
}

export async function listBankQuestions(classId: number, filters: { chapter?: string; difficulty?: string; questionType?: string }) {
  const conditions = ['bq.class_id = $1'];
  const params: any[] = [classId];
  if (filters.chapter) { params.push(filters.chapter); conditions.push(`bq.chapter = $${params.length}`); }
  if (filters.difficulty) { params.push(filters.difficulty); conditions.push(`bq.difficulty = $${params.length}`); }
  if (filters.questionType) { params.push(filters.questionType); conditions.push(`bq.question_type = $${params.length}`); }
  const questions = await query(
    `SELECT bq.id, bq.question_type, bq.content, bq.explanation, bq.default_points,
            bq.difficulty, bq.chapter, bq.tags, bq.created_at, bq.updated_at,
            u.name AS creator_name,
            (SELECT COUNT(DISTINCT eq.exam_id) FROM exam_questions eq WHERE eq.source_bank_question_id = bq.id)::int AS used_in_exams_count
       FROM bank_questions bq
       LEFT JOIN users u ON u.id = bq.created_by
      WHERE ${conditions.join(' AND ')}
      ORDER BY bq.created_at DESC`,
    params,
  );
  if (questions.length === 0) return [];
  const qIds = questions.map((q: any) => q.id);
  const options = await query(
    `SELECT id, question_id, content, is_correct, position FROM bank_question_options WHERE question_id = ANY($1) ORDER BY position`,
    [qIds],
  );
  return questions.map((q: any) => ({
    ...q,
    options: options.filter((o: any) => o.question_id === q.id),
  }));
}

export async function deleteBankQuestion(id: number) {
  await query('DELETE FROM bank_questions WHERE id = $1', [id]);
}

// ===========================================================================
// ĐỀ THI
// ===========================================================================
export interface ExamInput {
  name: string;
  description?: string;
  startTime: string;   // ISO string
  endTime: string;
  durationMinutes: number;
  maxAttempts?: number;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  resultVisibility?: 'immediately' | 'after_close' | 'hidden';
  allowReview?: boolean;
}

export async function createExam(classId: number, lecturerId: number, input: ExamInput) {
  if (!input.name?.trim()) {
    throw new HttpError(400, 'Tên đề thi không được để trống');
  }
  if (new Date(input.endTime) <= new Date(input.startTime)) {
    throw new HttpError(400, 'Thời gian kết thúc phải sau thời gian bắt đầu');
  }
  const safeDuration = Math.min(600, Math.max(1, Math.round(Number(input.durationMinutes) || 60)));
  const safeMaxAttempts = Math.min(10, Math.max(1, Math.round(Number(input.maxAttempts) || 1)));
  const safeVisibility =
    input.resultVisibility === 'immediately' || input.resultVisibility === 'hidden'
      ? input.resultVisibility
      : 'after_close';

  const row = await queryOne<{ id: number }>(
    `INSERT INTO exams (class_id, created_by, name, description, start_time, end_time,
                         duration_minutes, max_attempts, shuffle_questions, shuffle_options,
                         result_visibility, allow_review)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [classId, lecturerId, input.name.trim(), input.description ?? null, input.startTime, input.endTime,
     safeDuration, safeMaxAttempts, input.shuffleQuestions ?? false,
     input.shuffleOptions ?? false, safeVisibility, input.allowReview ?? false],
  );
  const examId = row!.id;
  await query(
    `INSERT INTO exam_proctoring_settings (exam_id) VALUES ($1)`,
    [examId],
  );
  return getExamForTeacher(examId);
}

export async function updateExam(examId: number, input: Partial<ExamInput>) {
  const current = await queryOne<{ status: string; start_time: Date; end_time: Date }>(
    'SELECT status, start_time, end_time FROM exams WHERE id = $1', [examId],
  );
  if (!current) throw new HttpError(404, 'Không tìm thấy đề thi');

  const nextStart = input.startTime !== undefined ? new Date(input.startTime) : new Date(current.start_time);
  const nextEnd = input.endTime !== undefined ? new Date(input.endTime) : new Date(current.end_time);
  if (nextEnd <= nextStart) {
    throw new HttpError(400, 'Thời gian kết thúc phải sau thời gian bắt đầu');
  }

  const fields: string[] = [];
  const values: any[] = [examId];
  const set = (col: string, val: any) => { values.push(val); fields.push(`${col} = $${values.length}`); };

  if (input.name !== undefined) set('name', input.name.trim());
  if (input.description !== undefined) set('description', input.description);
  if (input.startTime !== undefined) set('start_time', input.startTime);
  if (input.endTime !== undefined) set('end_time', input.endTime);
  if (input.durationMinutes !== undefined) {
    set('duration_minutes', Math.min(600, Math.max(1, Math.round(Number(input.durationMinutes) || 60))));
  }
  if (input.maxAttempts !== undefined) {
    set('max_attempts', Math.min(10, Math.max(1, Math.round(Number(input.maxAttempts) || 1))));
  }
  if (input.shuffleQuestions !== undefined) set('shuffle_questions', input.shuffleQuestions);
  if (input.shuffleOptions !== undefined) set('shuffle_options', input.shuffleOptions);
  if (input.resultVisibility !== undefined) {
    const safeVis =
      input.resultVisibility === 'immediately' || input.resultVisibility === 'hidden'
        ? input.resultVisibility
        : 'after_close';
    set('result_visibility', safeVis);
  }
  if (input.allowReview !== undefined) set('allow_review', input.allowReview);
  fields.push('updated_at = NOW()');

  if (fields.length > 1) {
    await query(`UPDATE exams SET ${fields.join(', ')} WHERE id = $1`, values);
  }
  return getExamForTeacher(examId);
}

/** Đóng đề ngay lập tức nhưng giữ nguyên đề và lịch sử làm bài. */
export async function closeExam(examId: number) {
  const exam = await queryOne<{ id: number; status: string; end_time: Date }>(
    'SELECT id, status, end_time FROM exams WHERE id = $1', [examId],
  );
  if (!exam) throw new HttpError(404, 'Không tìm thấy đề thi');
  if (exam.status === 'draft') throw new HttpError(400, 'Không thể đóng đề nháp');
  if (new Date(exam.end_time) <= new Date()) return getExamForTeacher(examId);

  await query(
    `UPDATE exams SET end_time = NOW(), updated_at = NOW() WHERE id = $1`,
    [examId],
  );
  return getExamForTeacher(examId);
}

/** Xuất bản đề: yêu cầu tối thiểu 1 câu hỏi. */
export async function publishExam(examId: number) {
  const count = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM exam_questions WHERE exam_id = $1`, [examId],
  );
  if (!count || Number(count.c) === 0) throw new HttpError(400, 'Đề thi cần ít nhất 1 câu hỏi trước khi xuất bản');
  await query(`UPDATE exams SET status = 'published', updated_at = NOW() WHERE id = $1`, [examId]);
  return getExamForTeacher(examId);
}

export async function deleteExam(examId: number) {
  const hasAttempts = await queryOne('SELECT 1 FROM exam_attempts WHERE exam_id = $1 LIMIT 1', [examId]);
  if (hasAttempts) throw new HttpError(400, 'Không thể xóa đề thi đã có học sinh làm bài. Cân nhắc đóng đề thay vì xóa.');
  await query('DELETE FROM exams WHERE id = $1', [examId]);
}

function computeDisplayStatus(row: { status: string; start_time: Date; end_time: Date }): string {
  if (row.status === 'draft') return 'draft';
  const now = new Date();
  if (now < new Date(row.start_time)) return 'scheduled';
  if (now > new Date(row.end_time)) return 'closed';
  return 'open';
}

export async function listExamsForClass(classId: number) {
  const rows = await query<any>(
    `SELECT e.*, c.name AS class_name,
            (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id = e.id AND a.status='submitted')::int AS submitted_count,
            (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id = e.id AND a.status='in_progress')::int AS in_progress_count,
            (SELECT COUNT(*) FROM classes_n_students s WHERE s.class_id = e.class_id)::int AS total_students,
            (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id)::int AS total_questions,
            (SELECT COALESCE(SUM(eq.points), 0) FROM exam_questions eq WHERE eq.exam_id = e.id)::numeric AS total_points,
            (SELECT COUNT(*) FROM proctoring_events pe JOIN exam_attempts a ON a.id = pe.attempt_id WHERE a.exam_id = e.id AND pe.is_confirmed = TRUE)::int AS violation_count,
            eps.enabled AS proctoring_enabled
       FROM exams e
       JOIN classes c ON c.id = e.class_id
       LEFT JOIN exam_proctoring_settings eps ON eps.exam_id = e.id
      WHERE e.class_id = $1 ORDER BY e.start_time DESC`,
    [classId],
  );
  return rows.map((r) => ({ ...r, display_status: computeDisplayStatus(r) }));
}

export async function getExamForTeacher(examId: number) {
  const exam = await queryOne<any>('SELECT * FROM exams WHERE id = $1', [examId]);
  if (!exam) throw new HttpError(404, 'Không tìm thấy đề thi');
  const settingsRow = await queryOne('SELECT * FROM exam_proctoring_settings WHERE exam_id = $1', [examId]);
  const questions = await query(
    `SELECT id, source_bank_question_id, position, question_type, content, explanation, points
       FROM exam_questions WHERE exam_id = $1 ORDER BY position`, [examId],
  );
  const questionIds = questions.map((q: any) => q.id);
  const options = questionIds.length
    ? await query(
        `SELECT id, exam_question_id, content, is_correct, position FROM exam_question_options
          WHERE exam_question_id = ANY($1) ORDER BY position`, [questionIds],
      )
    : [];
  return {
    ...exam, display_status: computeDisplayStatus(exam), proctoringSettings: settingsRow,
    questions: questions.map((q: any) => ({
      ...q, options: options.filter((o: any) => o.exam_question_id === q.id),
    })),
  };
}

export async function getExamForStudent(examId: number) {
  const exam = await queryOne<any>(
    `SELECT e.*, c.name AS class_name,
            (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id)::int AS total_questions,
            (SELECT COALESCE(SUM(eq.points), 0) FROM exam_questions eq WHERE eq.exam_id = e.id)::numeric AS total_points,
            eps.enabled AS proctoring_enabled,
            eps.verify_identity AS verify_identity,
            eps.detect_identity_swap AS detect_identity_swap
       FROM exams e
       JOIN classes c ON c.id = e.class_id
       LEFT JOIN exam_proctoring_settings eps ON eps.exam_id = e.id
      WHERE e.id = $1 AND e.status = 'published'`,
    [examId],
  );
  if (!exam) throw new HttpError(404, 'Không tìm thấy đề thi');
  return { ...exam, display_status: computeDisplayStatus(exam) };
}

// ===========================================================================
// CÂU HỎI TRONG ĐỀ
// ===========================================================================
export async function addQuestionsFromBank(examId: number, bankQuestionIds: number[]) {
  await guardNotPublishedWithAttempts(examId);
  return withTransaction(async (client) => {
    const { rows: posRow } = await client.query(
      `SELECT COALESCE(MAX(position), 0) AS max_pos FROM exam_questions WHERE exam_id = $1`, [examId],
    );
    let position = posRow[0].max_pos as number;
    const created: number[] = [];

    for (const bankId of bankQuestionIds) {
      const { rows: bq } = await client.query('SELECT * FROM bank_questions WHERE id = $1', [bankId]);
      if (!bq[0]) continue;
      position += 1;
      const { rows: eq } = await client.query(
        `INSERT INTO exam_questions
           (exam_id, source_bank_question_id, position, question_type, content, explanation, points)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [examId, bankId, position, bq[0].question_type, bq[0].content, bq[0].explanation, bq[0].default_points],
      );
      const examQuestionId = eq[0].id;
      const { rows: opts } = await client.query(
        'SELECT content, is_correct, position FROM bank_question_options WHERE question_id = $1 ORDER BY position',
        [bankId],
      );
      await insertOptions(client, 'exam_question_options', 'exam_question_id', examQuestionId, opts.map((o: any) => ({
        content: o.content, isCorrect: o.is_correct,
      })));
      created.push(examQuestionId);
    }
    return created;
  });
}

export interface ExamQuestionInput {
  sourceBankQuestionId?: number | null;
  questionType: QuestionType;
  content: string;
  explanation?: string;
  points?: number;
  options?: Array<{ content: string; isCorrect?: boolean; is_correct?: boolean }>;
}

export async function addManualQuestion(examId: number, input: ExamQuestionInput) {
  await guardNotPublishedWithAttempts(examId);
  const normalized = normalizeAndValidateQuestionPayload({
    questionType: input.questionType,
    content: input.content,
    explanation: input.explanation,
    points: input.points ?? 1,
    options: input.options,
  });
  return withTransaction(async (client) => {
    const { rows: posRow } = await client.query(
      `SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM exam_questions WHERE exam_id = $1`, [examId],
    );
    const { rows } = await client.query(
      `INSERT INTO exam_questions (exam_id, source_bank_question_id, position, question_type, content, explanation, points)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        examId,
        input.sourceBankQuestionId ?? null,
        posRow[0].pos,
        normalized.questionType,
        normalized.content,
        normalized.explanation,
        normalized.points,
      ],
    );
    await insertOptions(client, 'exam_question_options', 'exam_question_id', rows[0].id, normalized.options);
    return rows[0].id as number;
  });
}

export async function reorderQuestions(examId: number, orderedQuestionIds: number[]) {
  await guardNotPublishedWithAttempts(examId);
  await withTransaction(async (client) => {
    for (let i = 0; i < orderedQuestionIds.length; i++) {
      await client.query(
        'UPDATE exam_questions SET position = $1 WHERE id = $2 AND exam_id = $3',
        [i + 1, orderedQuestionIds[i], examId],
      );
    }
  });
}

export async function removeExamQuestion(examId: number, examQuestionId: number) {
  await guardNotPublishedWithAttempts(examId);
  await query('DELETE FROM exam_questions WHERE id = $1 AND exam_id = $2', [examQuestionId, examId]);
}

async function guardNotPublishedWithAttempts(examId: number) {
  const hasAttempts = await queryOne('SELECT 1 FROM exam_attempts WHERE exam_id = $1 LIMIT 1', [examId]);
  if (hasAttempts) throw new HttpError(400, 'Không thể sửa câu hỏi khi đã có học sinh bắt đầu làm bài');
}

// ===========================================================================
// CẤU HÌNH GIÁM SÁT AI
// ===========================================================================
export async function updateProctoringSettings(examId: number, input: Partial<ProctoringSettings>) {
  const resolved = resolveProctoringSettings(input);
  await query(
    `UPDATE exam_proctoring_settings SET
       enabled=$2, verify_identity=$3, detect_identity_swap=$4, identity_recheck_interval_sec=$5,
       identity_threshold=$6, detect_no_face=$7, no_face_grace_sec=$8, detect_multiple_faces=$9,
       track_head_pose=$10, head_sensitivity=$11, head_yaw_threshold_deg=$12, head_pitch_threshold_deg=$13,
       head_min_duration_ms=$14, track_gaze=$15, gaze_sensitivity=$16, gaze_yaw_threshold_deg=$17,
       gaze_pitch_threshold_deg=$18, gaze_min_duration_ms=$19, detect_phone=$20, detect_document=$21,
       detect_secondary_screen=$22, detect_headphone=$23, detect_extra_person=$24, object_conf_threshold=$25,
       detect_tab_switch=$26, violation_action=$27, auto_submit_after_violations=$28,
       frame_interval_ms=$29, evidence_retention_days=$30, updated_at=NOW()
     WHERE exam_id=$1`,
    [examId, resolved.enabled, resolved.verifyIdentity, resolved.detectIdentitySwap,
     resolved.identityRecheckIntervalSec, resolved.identityThreshold, resolved.detectNoFace,
     resolved.noFaceGraceSec, resolved.detectMultipleFaces, resolved.trackHeadPose, resolved.headSensitivity,
     resolved.headYawThresholdDeg, resolved.headPitchThresholdDeg, resolved.headMinDurationMs,
     resolved.trackGaze, resolved.gazeSensitivity, resolved.gazeYawThresholdDeg, resolved.gazePitchThresholdDeg,
     resolved.gazeMinDurationMs, resolved.detectPhone, resolved.detectDocument, resolved.detectSecondaryScreen,
     resolved.detectHeadphone, resolved.detectExtraPerson, resolved.objectConfThreshold, resolved.detectTabSwitch,
     resolved.violationAction, resolved.autoSubmitAfterViolations, resolved.frameIntervalMs,
     resolved.evidenceRetentionDays],
  );
  return resolved;
}

/** Map dòng DB (snake_case) -> ProctoringSettings (camelCase) */
export function mapSettingsRow(row: any): ProctoringSettings {
  if (!row) return DEFAULT_SETTINGS;
  // Nếu đề thi đã lưu với preset cũ chưa hiệu chỉnh (relaxed=40, normal=30, strict=22), tự động nâng lên GAZE_PRESETS mới
  const legacyGazeYaw: Record<string, number> = { relaxed: 40, normal: 30, strict: 22 };
  const gazeSens = row.gaze_sensitivity as 'relaxed' | 'normal' | 'strict' | 'custom';
  const calibratedGaze =
    (gazeSens === 'relaxed' || gazeSens === 'normal' || gazeSens === 'strict') &&
    Number(row.gaze_yaw_threshold_deg) === legacyGazeYaw[gazeSens]
      ? GAZE_PRESETS[gazeSens]
      : null;

  return {
    enabled: row.enabled, verifyIdentity: row.verify_identity, detectIdentitySwap: row.detect_identity_swap,
    identityRecheckIntervalSec: row.identity_recheck_interval_sec, identityThreshold: Number(row.identity_threshold),
    detectNoFace: row.detect_no_face, noFaceGraceSec: row.no_face_grace_sec, detectMultipleFaces: row.detect_multiple_faces,
    trackHeadPose: row.track_head_pose, headSensitivity: row.head_sensitivity, headYawThresholdDeg: row.head_yaw_threshold_deg,
    headPitchThresholdDeg: row.head_pitch_threshold_deg, headMinDurationMs: row.head_min_duration_ms,
    trackGaze: row.track_gaze,
    gazeSensitivity: row.gaze_sensitivity,
    gazeYawThresholdDeg: calibratedGaze ? calibratedGaze.gazeYawThresholdDeg : row.gaze_yaw_threshold_deg,
    gazePitchThresholdDeg: calibratedGaze ? calibratedGaze.gazePitchThresholdDeg : row.gaze_pitch_threshold_deg,
    gazeMinDurationMs: calibratedGaze ? calibratedGaze.gazeMinDurationMs : row.gaze_min_duration_ms,
    detectPhone: row.detect_phone, detectDocument: row.detect_document, detectSecondaryScreen: row.detect_secondary_screen,
    detectHeadphone: row.detect_headphone, detectExtraPerson: row.detect_extra_person,
    objectConfThreshold: Number(row.object_conf_threshold), detectTabSwitch: row.detect_tab_switch,
    violationAction: row.violation_action, autoSubmitAfterViolations: row.auto_submit_after_violations,
    frameIntervalMs: row.frame_interval_ms, evidenceRetentionDays: row.evidence_retention_days,
  };
}
