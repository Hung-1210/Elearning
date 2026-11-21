// src/services/exam/attempt.service.ts
import type { PoolClient } from 'pg';
import { query, queryOne, withTransaction, pool } from '../../config/database.js';
import { HttpError } from '../../utils/http-error.js';
import { registerFace, analyzeFrame, AiInputError, AiServiceError } from '../proctoring/ai-client.js';
import {
  saveEvidenceImage,
  saveAttemptAnswerFile,
  readAttemptAnswerFile,
  deleteAttemptAnswerFile,
} from '../proctoring/storage.js';
import { broadcastAttemptStatus, getMonitorIo } from '../../sockets/monitor.socket.js';
import { computeStudentResultVisibility } from './visibility.js';
import {
  ensureFaceAttendanceTables,
  getUsableApprovedEmbedding,
  cosineSimilarity,
} from '../face-profile.service.js';

const PRECHECK_TTL_MINUTES = 10;

// ===========================================================================
// PRE-CHECK (tích hợp cổng đối chiếu Hồ sơ khuôn mặt - P5 / Mục 8.6)
// ===========================================================================
export async function createPrecheckSession(examId: number, studentId: number, imageBuffer: Buffer) {
  await ensureFaceAttendanceTables();
  const exam = await queryOne<{ start_time: Date; end_time: Date }>(
    'SELECT start_time, end_time FROM exams WHERE id = $1', [examId],
  );
  if (!exam) throw new HttpError(404, 'Không tìm thấy đề thi');
  const now = new Date();
  if (now < new Date(exam.start_time)) throw new HttpError(400, 'Đề thi chưa mở');
  if (now > new Date(exam.end_time)) throw new HttpError(400, 'Đề thi đã đóng');

  const settingsRow = await queryOne<{
    enabled: boolean;
    verify_identity: boolean;
    detect_identity_swap: boolean;
    require_face_profile: boolean | null;
    identity_threshold: number | null;
  }>(
    `SELECT enabled, verify_identity, detect_identity_swap,
            COALESCE(require_face_profile, TRUE) AS require_face_profile,
            identity_threshold
       FROM exam_proctoring_settings
      WHERE exam_id = $1`,
    [examId],
  );

  const requiresIdentityAnchor = Boolean(
    settingsRow?.enabled &&
      (settingsRow.verify_identity || settingsRow.detect_identity_swap) &&
      settingsRow.require_face_profile !== false,
  );

  let profileEmbedding: number[] | null = null;
  if (requiresIdentityAnchor) {
    const profile = await getUsableApprovedEmbedding(studentId);
    if (!profile.usableEmbedding) {
      if (profile.status === 'pending') {
        throw new HttpError(
          403,
          'Hồ sơ khuôn mặt của bạn đang ở trạng thái "Chờ giảng viên duyệt". Vui lòng nhờ giảng viên duyệt hồ sơ trước khi vào thi.',
        );
      }
      if (profile.status === 'rejected') {
        throw new HttpError(
          403,
          `Hồ sơ khuôn mặt của bạn đã bị từ chối (${profile.rejectReason || 'ảnh chưa đạt'}). Vui lòng vào mục "Khuôn mặt của tôi" để đăng ký lại và nhờ giảng viên duyệt.`,
        );
      }
      throw new HttpError(
        403,
        'Đề thi này yêu cầu sinh viên đã đăng ký và được duyệt hồ sơ khuôn mặt. Vui lòng vào mục "Khuôn mặt của tôi" ở thanh bên trái để đăng ký trước khi vào thi.',
      );
    }
    profileEmbedding = profile.usableEmbedding;
  }

  let embedding: number[];
  try {
    const result = await registerFace(imageBuffer);
    embedding = result.embedding;

    // Nếu đề thi bật đối chiếu hồ sơ khuôn mặt, gọi analyze (face + identity) hoặc so khớp Cosine với hồ sơ đã duyệt
    if (profileEmbedding) {
      const threshold = Number(settingsRow?.identity_threshold ?? 0.45);
      let similarity = cosineSimilarity(embedding, profileEmbedding);
      try {
        const analysis = await analyzeFrame({
          imageBuffer,
          referenceEmbedding: profileEmbedding,
          run: { face: true, identity: true, headPose: false, gaze: false, objects: false },
        });
        if (analysis.primary?.similarity !== null && analysis.primary?.similarity !== undefined) {
          similarity = Number(analysis.primary.similarity);
        }
      } catch {
        // Nếu endpoint /analyze bận tạm thời, vẫn có kết quả Cosine từ 2 vector 512 chiều cùng model buffalo_sc
      }

      if (similarity < threshold) {
        throw new HttpError(
          422,
          `Khuôn mặt vừa chụp không khớp với hồ sơ khuôn mặt đã đăng ký của bạn (độ tương đồng ${similarity.toFixed(2)} < ngưỡng ${threshold.toFixed(2)}). Hãy nhìn thẳng, đủ ánh sáng và thử lại.`,
        );
      }
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // Ảnh không đạt (không mặt/nhiều mặt/mờ...) => 422 kèm lý do thật từ AI.
    if (err instanceof AiInputError) throw new HttpError(422, err.message);
    // AI hỏng/quá tải => 503, KHÔNG nói là lỗi của thí sinh và KHÔNG cho qua bước xác thực.
    if (err instanceof AiServiceError) {
      throw new HttpError(503, 'Hệ thống xác thực khuôn mặt tạm thời không khả dụng. Vui lòng thử lại sau ít phút hoặc liên hệ giám thị.');
    }
    throw err;
  }

  const photoPath = await saveEvidenceImage(0, imageBuffer);
  const expiresAt = new Date(Date.now() + PRECHECK_TTL_MINUTES * 60 * 1000);

  const row = await queryOne<{ id: string }>(
    `INSERT INTO exam_precheck_sessions (exam_id, student_id, reference_embedding, reference_photo_path, expires_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [examId, studentId, embedding, photoPath, expiresAt],
  );
  return { precheckId: row!.id, expiresAt };
}

// ===========================================================================
// BẮT ĐẦU LÀM BÀI
// ===========================================================================
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function startAttempt(examId: number, studentId: number, precheckId?: string) {
  let createdNew = false;
  const result = await withTransaction(async (client) => {
    const exam = await one(client,
      `SELECT * FROM exams WHERE id = $1 FOR SHARE`, [examId]);
    if (!exam) throw new HttpError(404, 'Không tìm thấy đề thi');
    if (exam.status !== 'published') throw new HttpError(400, 'Đề thi chưa được xuất bản');

    const now = new Date();
    if (now < new Date(exam.start_time)) throw new HttpError(400, 'Đề thi chưa mở');
    if (now > new Date(exam.end_time)) throw new HttpError(400, 'Đề thi đã đóng');

    // Nếu đang có lần làm bài dở thì trả về tiếp để khôi phục
    const existing = await one(client,
      `SELECT id FROM exam_attempts WHERE exam_id = $1 AND student_id = $2 AND status = 'in_progress'`,
      [examId, studentId],
    );
    if (existing) {
      return getAttemptForStudent(client, existing.id);
    }

    const settingsRow = await one(client,
      'SELECT * FROM exam_proctoring_settings WHERE exam_id = $1', [examId]);
    const requiresFacePrecheck = Boolean(
      settingsRow?.enabled && (settingsRow.verify_identity || settingsRow.detect_identity_swap),
    );

    let refEmbedding: number[] | null = null;
    let refPhoto: string | null = null;

    if (precheckId) {
      const precheck = await one(client,
        `SELECT * FROM exam_precheck_sessions WHERE id = $1 FOR UPDATE`, [precheckId]);
      if (precheck && precheck.exam_id === examId && precheck.student_id === studentId &&
          !precheck.consumed_at && new Date(precheck.expires_at) > now) {
        refEmbedding = precheck.reference_embedding;
        refPhoto = precheck.reference_photo_path;
        await client.query('UPDATE exam_precheck_sessions SET consumed_at = $2 WHERE id = $1', [precheckId, now]);
      }
    }

    if (requiresFacePrecheck) {
      if (!precheckId) {
        throw new HttpError(400, 'Bạn cần hoàn tất bước xác thực khuôn mặt trước khi bắt đầu thi');
      }
      if (!refEmbedding) {
        throw new HttpError(400, 'Phiên xác thực khuôn mặt đã hết hạn hoặc không hợp lệ');
      }
    }

    const attemptCount = await client.query(
      'SELECT COUNT(*)::int AS c FROM exam_attempts WHERE exam_id = $1 AND student_id = $2', [examId, studentId],
    );
    const nextAttemptNo = attemptCount.rows[0].c + 1;
    if (nextAttemptNo > exam.max_attempts) throw new HttpError(400, 'Bạn đã dùng hết số lần làm bài cho phép');

    const questions = (await client.query(
      'SELECT id FROM exam_questions WHERE exam_id = $1 ORDER BY position', [examId],
    )).rows;
    if (questions.length === 0) throw new HttpError(400, 'Đề thi chưa có câu hỏi');
    let questionOrder = questions.map((q: any) => q.id as number);
    if (exam.shuffle_questions) questionOrder = shuffle(questionOrder);

    const optionOrder: Record<number, number[]> = {};
    if (exam.shuffle_options) {
      const opts = (await client.query(
        'SELECT id, exam_question_id FROM exam_question_options WHERE exam_question_id = ANY($1)',
        [questionOrder],
      )).rows;
      for (const qId of questionOrder) {
        const ids = opts.filter((o: any) => o.exam_question_id === qId).map((o: any) => o.id);
        optionOrder[qId] = shuffle(ids);
      }
    }

    const deadline = new Date(Math.min(
      now.getTime() + exam.duration_minutes * 60 * 1000,
      new Date(exam.end_time).getTime(),
    ));

    const attempt = await one(client,
      `INSERT INTO exam_attempts
         (exam_id, student_id, attempt_no, started_at, deadline_at, question_order, option_order,
          reference_embedding, reference_photo_path, max_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
         (SELECT COALESCE(SUM(points),0) FROM exam_questions WHERE exam_id = $1))
       RETURNING *`,
      [examId, studentId, nextAttemptNo, now, deadline, questionOrder, JSON.stringify(optionOrder),
       refEmbedding, refPhoto],
    );
    createdNew = true;
    return getAttemptForStudent(client, attempt.id);
  });

  if (createdNew) {
    broadcastAttemptStatus(getMonitorIo(), examId, { attemptId: result.id, status: 'in_progress' });
  }
  return result;
}

async function one(client: PoolClient, sql: string, params: any[]) {
  const { rows } = await client.query(sql, params);
  return rows[0] ?? null;
}

// ===========================================================================
// ĐỌC ATTEMPT (PHÍA HỌC SINH — ĐẢM BẢO PRIVACY & RESULT VISIBILITY)
// ===========================================================================
export async function getAttemptForStudent(clientOrPool: PoolClient | typeof pool, attemptId: number) {
  const attempt = await (clientOrPool as any).query('SELECT * FROM exam_attempts WHERE id = $1', [attemptId]);
  const rawRow = attempt.rows[0];
  if (!rawRow) throw new HttpError(404, 'Không tìm thấy lần làm bài');

  // TUYỆT ĐỐI không trả vector sinh trắc học (reference_embedding) hoặc đường dẫn file nội bộ về browser
  const {
    reference_embedding: _emb,
    reference_photo_path: _photo,
    ...row
  } = rawRow;

  const exam = (await (clientOrPool as any).query(
    `SELECT e.id, e.class_id, c.name AS class_name, e.name, e.description, e.duration_minutes,
            e.result_visibility, e.allow_review, e.end_time,
            u.name AS student_name, COALESCE(ul.login_id, '') AS login_id
       FROM exams e
       JOIN classes c ON c.id = e.class_id
       JOIN users u ON u.id = $2
       LEFT JOIN user_login_id ul ON ul.user_id = u.id
      WHERE e.id = $1`,
    [row.exam_id, row.student_id],
  )).rows[0];
  const settings = (await (clientOrPool as any).query('SELECT * FROM exam_proctoring_settings WHERE exam_id = $1', [row.exam_id])).rows[0];

  const questionRows = (await (clientOrPool as any).query(
    `SELECT eq.id, eq.position, eq.question_type, eq.content, eq.points, eq.explanation,
            bq.chapter AS chapter,
            COALESCE(bq.difficulty, 'medium') AS difficulty
       FROM exam_questions eq
       LEFT JOIN bank_questions bq ON bq.id = eq.source_bank_question_id
      WHERE eq.exam_id = $1`,
    [row.exam_id],
  )).rows;
  const byId = new Map<number, any>(questionRows.map((q: any) => [q.id, q]));

  const optionRows = (await (clientOrPool as any).query(
    `SELECT id, exam_question_id, content, position, is_correct FROM exam_question_options WHERE exam_question_id = ANY($1)`,
    [row.question_order],
  )).rows;

  const answers = (await (clientOrPool as any).query(
    `SELECT exam_question_id, selected_option_ids, text_answer, file_path, is_flagged, is_correct, score, grader_comment
       FROM attempt_answers WHERE attempt_id = $1`,
    [attemptId],
  )).rows;

  const { isSubmitted, canSeeScore, canReviewAnswers, reason: resultVisibilityReason } =
    computeStudentResultVisibility({
      attemptStatus: row.status,
      resultVisibility: exam.result_visibility,
      allowReview: exam.allow_review,
      examEndTime: exam.end_time,
    });

  const answerByQ = new Map(answers.map((a: any) => [a.exam_question_id, canReviewAnswers ? a : {
    exam_question_id: a.exam_question_id,
    selected_option_ids: a.selected_option_ids,
    text_answer: a.text_answer,
    file_path: a.file_path,
    is_flagged: a.is_flagged,
  }]));

  const optionOrder = row.option_order ?? {};
  const orderedQuestions = row.question_order.map((qId: number, index: number) => {
    const { explanation, ...qBase } = byId.get(qId) || {};
    const ids: number[] = optionOrder[qId] ?? optionRows.filter((o: any) => o.exam_question_id === qId).map((o: any) => o.id);
    const options = ids.map((oid) => optionRows.find((o: any) => o.id === oid)).filter(Boolean)
      .map((o: any, optIdx: number) => ({
        id: o.id,
        content: o.content,
        position: o.position ?? optIdx + 1,
        ...(canReviewAnswers ? { is_correct: Boolean(o.is_correct) } : {}),
      }));
    return {
      ...qBase,
      ...(canReviewAnswers ? { explanation: explanation ?? null } : {}),
      position: qBase.position ?? index + 1,
      indexNumber: index + 1,
      options,
      answer: answerByQ.get(qId) ?? null,
    };
  });

  // Thống kê kết quả thật từ DB (chỉ trả khi được phép xem điểm)
  let correctCount: number | null = null;
  let competencies: Array<{ chapter: string; percentage: number; label: string }> = [];
  if (canSeeScore) {
    correctCount = answers.filter((a: any) => a.is_correct === true).length;
    const chapterAgg = new Map<string, { earned: number; total: number }>();
    for (const q of questionRows) {
      if (!q.chapter) continue;
      const cur = chapterAgg.get(q.chapter) ?? { earned: 0, total: 0 };
      const ans = answers.find((a: any) => a.exam_question_id === q.id);
      cur.total += Number(q.points ?? 0);
      cur.earned += Number(ans?.score ?? 0);
      chapterAgg.set(q.chapter, cur);
    }
    competencies = Array.from(chapterAgg.entries()).map(([chapter, v]) => {
      const pct = v.total > 0 ? Math.round((v.earned / v.total) * 100) : 0;
      const label = pct >= 80 ? 'Vững vàng' : pct >= 50 ? 'Đạt chuẩn' : 'Cần củng cố';
      return { chapter, percentage: pct, label };
    });
  }

  let violationCount: number | null = null;
  if (isSubmitted) {
    const vRow = (await (clientOrPool as any).query(
      'SELECT COUNT(*)::int AS c FROM proctoring_events WHERE attempt_id = $1 AND is_confirmed = TRUE',
      [attemptId],
    )).rows[0];
    violationCount = Number(vRow?.c ?? 0);
  }

  const remainingSeconds = Math.max(0, Math.floor((new Date(row.deadline_at).getTime() - Date.now()) / 1000));

  return {
    ...row,
    total_score: canSeeScore ? row.total_score : null,
    resultVisible: canSeeScore,
    resultVisibilityReason,
    correct_count: correctCount,
    violation_count: violationCount,
    competencies,
    student_name: exam.student_name,
    login_id: exam.login_id,
    exam,
    proctoringSettings: settings,
    remainingSeconds,
    questions: orderedQuestions,
  };
}

// ===========================================================================
// TRẢ LỜI CÂU HỎI
// ===========================================================================
export async function saveAnswer(attemptId: number, examQuestionId: number, payload: {
  selectedOptionIds?: number[]; textAnswer?: string; filePath?: string; isFlagged?: boolean;
}) {
  await withTransaction(async (client) => {
    const attempt = await one(client, 'SELECT * FROM exam_attempts WHERE id = $1 FOR UPDATE', [attemptId]);
    if (!attempt) throw new HttpError(404, 'Không tìm thấy lần làm bài');
    if (attempt.status !== 'in_progress') throw new HttpError(400, 'Bài đã nộp, không thể sửa câu trả lời');
    if (new Date(attempt.deadline_at) < new Date()) throw new HttpError(400, 'Đã hết thời gian làm bài');
    const questionOrderIds: number[] = Array.isArray(attempt.question_order)
      ? attempt.question_order.map(Number)
      : [];
    if (!questionOrderIds.includes(Number(examQuestionId))) {
      throw new HttpError(400, 'Câu hỏi không thuộc lần làm bài này');
    }

    const hasSelectedOptions = payload.selectedOptionIds !== undefined && payload.selectedOptionIds !== null;
    const normalizedOptionIds = hasSelectedOptions
      ? Array.from(new Set(payload.selectedOptionIds!.map(Number).filter((n) => Number.isInteger(n))))
      : [];

    if (normalizedOptionIds.length > 0) {
      const valid = await client.query(
        'SELECT id FROM exam_question_options WHERE exam_question_id = $1 AND id = ANY($2::int[])',
        [examQuestionId, normalizedOptionIds],
      );
      if (valid.rows.length !== normalizedOptionIds.length) {
        throw new HttpError(400, 'Có lựa chọn không hợp lệ cho câu hỏi này');
      }
    }

    const hasTextAnswer = payload.textAnswer !== undefined;
    const hasFilePath = payload.filePath !== undefined;
    const hasIsFlagged = payload.isFlagged !== undefined && payload.isFlagged !== null;

    // selected_option_ids và is_flagged là cột NOT NULL trong DB:
    // Luôn truyền mảng '{}' và FALSE cho INSERT mới, còn khi UPDATE chỉ ghi đè trường thực sự được gửi lên.
    await client.query(
      `INSERT INTO attempt_answers (
         attempt_id, exam_question_id, selected_option_ids, text_answer, file_path, is_flagged
       )
       VALUES ($1, $2, $3::int[], $4, $5, $6)
       ON CONFLICT (attempt_id, exam_question_id) DO UPDATE SET
         selected_option_ids = CASE WHEN $7::boolean THEN EXCLUDED.selected_option_ids ELSE attempt_answers.selected_option_ids END,
         text_answer         = CASE WHEN $8::boolean THEN EXCLUDED.text_answer         ELSE attempt_answers.text_answer         END,
         file_path           = CASE WHEN $9::boolean THEN EXCLUDED.file_path           ELSE attempt_answers.file_path           END,
         is_flagged          = CASE WHEN $10::boolean THEN EXCLUDED.is_flagged         ELSE attempt_answers.is_flagged          END,
         answered_at         = NOW()`,
      [
        attemptId,
        examQuestionId,
        normalizedOptionIds,
        payload.textAnswer ?? null,
        payload.filePath ?? null,
        hasIsFlagged ? Boolean(payload.isFlagged) : false,
        hasSelectedOptions,
        hasTextAnswer,
        hasFilePath,
        hasIsFlagged,
      ],
    );
  });
}

/** Tải lên tệp bài làm cho câu hỏi thuộc loại `file_upload`. */
export async function uploadAnswerFile(
  attemptId: number,
  examQuestionId: number,
  file: { originalname: string; buffer: Buffer; size?: number },
) {
  let savedRelPathOnDisk: string | null = null;

  try {
    const { previousFilePath, saved } = await withTransaction(async (client) => {
      const attempt = await one(client, 'SELECT * FROM exam_attempts WHERE id = $1 FOR UPDATE', [attemptId]);
      if (!attempt) throw new HttpError(404, 'Không tìm thấy lần làm bài');
      if (attempt.status !== 'in_progress') throw new HttpError(400, 'Bài đã nộp, không thể tải tệp mới');
      if (new Date(attempt.deadline_at) < new Date()) throw new HttpError(400, 'Đã hết thời gian làm bài');

      const questionOrderIds: number[] = Array.isArray(attempt.question_order)
        ? attempt.question_order.map(Number)
        : [];
      if (!questionOrderIds.includes(Number(examQuestionId))) {
        throw new HttpError(400, 'Câu hỏi không thuộc lần làm bài này');
      }

      const qRow = await one(
        client,
        'SELECT id, question_type FROM exam_questions WHERE id = $1 AND exam_id = $2',
        [examQuestionId, attempt.exam_id],
      );
      if (!qRow) throw new HttpError(404, 'Không tìm thấy câu hỏi');
      if (qRow.question_type !== 'file_upload') {
        throw new HttpError(400, 'Chỉ câu hỏi loại nộp tệp / mã nguồn mới hỗ trợ đính kèm tệp');
      }

      const existingAns = await one(
        client,
        'SELECT file_path FROM attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2',
        [attemptId, examQuestionId],
      );
      const prevPath: string | null = existingAns?.file_path ?? null;

      let stored: { relPath: string; fileName: string; sizeBytes: number };
      try {
        stored = await saveAttemptAnswerFile(attemptId, examQuestionId, file.originalname, file.buffer);
        savedRelPathOnDisk = stored.relPath;
      } catch (err: any) {
        throw new HttpError(400, err?.message || 'Tệp tải lên không hợp lệ');
      }

      await client.query(
        `INSERT INTO attempt_answers (
           attempt_id, exam_question_id, selected_option_ids, text_answer, file_path, is_flagged
         )
         VALUES ($1, $2, '{}'::int[], NULL, $3, FALSE)
         ON CONFLICT (attempt_id, exam_question_id) DO UPDATE SET
           file_path   = EXCLUDED.file_path,
           answered_at = NOW()`,
        [attemptId, examQuestionId, stored.relPath],
      );

      return { previousFilePath: prevPath, saved: stored };
    });

    if (previousFilePath && previousFilePath !== saved.relPath) {
      await deleteAttemptAnswerFile(previousFilePath).catch(() => {});
    }

    return {
      filePath: saved.relPath,
      fileName: saved.fileName,
      sizeBytes: saved.sizeBytes,
    };
  } catch (err) {
    if (savedRelPathOnDisk) {
      await deleteAttemptAnswerFile(savedRelPathOnDisk).catch(() => {});
    }
    throw err;
  }
}

/** Đọc tệp bài làm đính kèm (cho phép chủ bài thi hoặc giảng viên/trợ giảng phụ trách lớp). */
export async function getAnswerFileForDownload(
  attemptId: number,
  examQuestionId: number,
  requester: { userId: number; role?: string },
) {
  const row = await queryOne<{
    attempt_id: number;
    student_id: number;
    class_id: number;
    creator_id: number;
    file_path: string | null;
  }>(
    `SELECT ea.id AS attempt_id,
            ea.student_id,
            e.class_id,
            c.creator_id,
            aa.file_path
       FROM exam_attempts ea
       JOIN exams e ON e.id = ea.exam_id
       JOIN classes c ON c.id = e.class_id
       LEFT JOIN attempt_answers aa
         ON aa.attempt_id = ea.id AND aa.exam_question_id = $2
      WHERE ea.id = $1`,
    [attemptId, examQuestionId],
  );
  if (!row) throw new HttpError(404, 'Không tìm thấy lượt làm bài');

  const isStudentOwner = Number(row.student_id) === Number(requester.userId);
  const isClassCreator = Number(row.creator_id) === Number(requester.userId);
  if (!isStudentOwner && !isClassCreator) {
    const collab = await queryOne(
      'SELECT 1 FROM collaborators WHERE class_id = $1 AND user_id = $2',
      [row.class_id, requester.userId],
    );
    if (!collab) {
      throw new HttpError(403, 'Bạn không có quyền tải tệp bài làm này');
    }
  }

  if (!row.file_path) {
    throw new HttpError(404, 'Câu hỏi này chưa có tệp đính kèm');
  }

  try {
    const { buffer, fileName } = await readAttemptAnswerFile(row.file_path);
    return { buffer, fileName, filePath: row.file_path };
  } catch {
    throw new HttpError(404, 'Không tìm thấy tệp đính kèm trên máy chủ');
  }
}

// ===========================================================================
// NỘP BÀI + TỰ ĐỘNG CHẤM TRẮC NGHIỆM
// ===========================================================================
export async function submitAttempt(
  attemptId: number, reason: 'manual' | 'time_up' | 'proctoring' | 'lecturer',
) {
  let didTransition = false;
  const submitted = await withTransaction(async (client) => {
    const attempt = await one(client, 'SELECT * FROM exam_attempts WHERE id = $1 FOR UPDATE', [attemptId]);
    if (!attempt) throw new HttpError(404, 'Không tìm thấy lần làm bài');
    if (attempt.status === 'submitted') {
      const { reference_embedding: _e, reference_photo_path: _p, ...safe } = attempt;
      return safe;
    }

    await client.query(
      `UPDATE proctoring_events SET ended_at = last_seen_at
        WHERE attempt_id = $1 AND ended_at IS NULL AND is_confirmed = TRUE`, [attemptId],
    );
    await client.query(
      `DELETE FROM proctoring_events WHERE attempt_id = $1 AND ended_at IS NULL AND is_confirmed = FALSE`,
      [attemptId],
    );

    const gradeResult = await autoGradeObjectiveQuestions(client, attempt.exam_id, attemptId);

    const hasUngraded = await client.query(
      `SELECT 1 FROM exam_questions eq
        WHERE eq.exam_id = $1 AND eq.question_type IN ('essay','file_upload')
        LIMIT 1`,
      [attempt.exam_id],
    );

    await client.query(
      `UPDATE exam_attempts SET
         status='submitted', submitted_at=NOW(), submit_reason=$2,
         total_score=$3, grading_status=$4
       WHERE id=$1`,
      [attemptId, reason, gradeResult.totalScore,
       hasUngraded.rows.length ? 'needs_manual' : 'graded'],
    );
    didTransition = true;
    const updated = await one(client, 'SELECT * FROM exam_attempts WHERE id = $1', [attemptId]);
    const { reference_embedding: _e, reference_photo_path: _p, ...safe } = updated;
    return safe;
  });

  if (didTransition && submitted?.exam_id) {
    broadcastAttemptStatus(getMonitorIo(), submitted.exam_id, {
      attemptId,
      status: 'submitted',
      submitReason: reason,
    });
  }
  return submitted;
}

async function autoGradeObjectiveQuestions(client: PoolClient, examId: number, attemptId: number) {
  const questions = (await client.query(
    `SELECT id, question_type, points FROM exam_questions WHERE exam_id = $1
       AND question_type IN ('single_choice','multiple_choice')`, [examId],
  )).rows;

  let totalScore = 0;
  for (const q of questions) {
    const correctOptions = (await client.query(
      'SELECT id FROM exam_question_options WHERE exam_question_id = $1 AND is_correct = TRUE',
      [q.id],
    )).rows.map((r: any) => r.id).sort();

    const answer = (await client.query(
      'SELECT selected_option_ids FROM attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2',
      [attemptId, q.id],
    )).rows[0];

    const selected = (answer?.selected_option_ids ?? []).slice().sort();
    const isCorrect = selected.length === correctOptions.length &&
      selected.every((id: number, i: number) => id === correctOptions[i]);
    const score = isCorrect ? Number(q.points) : 0;
    totalScore += score;

    if (answer) {
      await client.query(
        'UPDATE attempt_answers SET is_correct=$3, score=$4 WHERE attempt_id=$1 AND exam_question_id=$2',
        [attemptId, q.id, isCorrect, score],
      );
    } else {
      await client.query(
        `INSERT INTO attempt_answers (attempt_id, exam_question_id, selected_option_ids, is_correct, score)
         VALUES ($1,$2,'{}',FALSE,0)`,
        [attemptId, q.id],
      );
    }
  }
  return { totalScore };
}

// ===========================================================================
// JOB: tự động nộp bài khi hết giờ
// ===========================================================================
export async function autoSubmitExpiredAttempts(): Promise<number> {
  const expired = await query<{ id: number }>(
    `SELECT id FROM exam_attempts WHERE status = 'in_progress' AND deadline_at <= NOW()`,
  );
  for (const row of expired) {
    await submitAttempt(row.id, 'time_up').catch((err) => {
      console.error(`[auto-submit] Lỗi khi tự nộp attempt ${row.id}:`, err);
    });
  }
  return expired.length;
}
