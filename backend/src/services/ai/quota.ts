// src/services/ai/quota.ts
import { query, queryOne } from '../../config/database.js';
import { HttpError } from '../../utils/http-error.js';
import { ensureAiRagTables } from './schema.js';

export const STUDENT_CHAT_HOURLY_LIMIT = 30;
export const STUDENT_CHAT_DAILY_LIMIT = 150;
export const LECTURER_CHAT_HOURLY_LIMIT = 100;
export const LECTURER_JOB_DAILY_LIMIT = 10;
export const MAX_QUESTIONS_PER_JOB = 50;

export async function logAiUsage(params: {
  userId: number;
  classId?: number | null;
  feature: 'chat' | 'generate' | 'embed';
  tokensIn: number;
  tokensOut: number;
}): Promise<void> {
  await ensureAiRagTables();
  await query(
    `INSERT INTO ai_usage_logs (user_id, class_id, feature, tokens_in, tokens_out)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      params.userId,
      params.classId ?? null,
      params.feature,
      Math.max(0, Math.round(params.tokensIn || 0)),
      Math.max(0, Math.round(params.tokensOut || 0)),
    ],
  ).catch((err) => {
    console.warn('[ai-quota] Không thể ghi log sử dụng AI:', err?.message);
  });
}

/** Kiểm tra sinh viên có đang trong ca thi (in_progress) của lớp hay không. */
export async function checkStudentActiveExamLock(
  userId: number,
  classId: number,
  isLecturer: boolean,
): Promise<{ locked: boolean; examName: string | null; deadlineAt: string | null }> {
  if (isLecturer) {
    return { locked: false, examName: null, deadlineAt: null };
  }
  const active = await queryOne<{ exam_name: string; deadline_at: Date }>(
    `SELECT e.name AS exam_name, ea.deadline_at
       FROM exam_attempts ea
       JOIN exams e ON e.id = ea.exam_id
      WHERE ea.student_id = $1
        AND e.class_id = $2
        AND ea.status = 'in_progress'
        AND ea.deadline_at > NOW()
      ORDER BY ea.started_at DESC
      LIMIT 1`,
    [userId, classId],
  );
  if (!active) {
    return { locked: false, examName: null, deadlineAt: null };
  }
  return {
    locked: true,
    examName: active.exam_name,
    deadlineAt: new Date(active.deadline_at).toISOString(),
  };
}

export async function assertStudentNotInActiveExam(
  userId: number,
  classId: number,
  isLecturer: boolean,
): Promise<void> {
  const lock = await checkStudentActiveExamLock(userId, classId, isLecturer);
  if (lock.locked) {
    throw new HttpError(
      403,
      `Tạm khóa Trợ giảng AI trong thời gian bạn đang làm bài thi "${lock.examName}". Vui lòng hoàn thành và nộp bài thi trước.`,
    );
  }
}

/** Kiểm tra hạn mức chat RAG (SV: 30 tin/giờ, 150 tin/ngày; GV: 100 tin/giờ). */
export async function assertChatQuota(userId: number, isLecturer: boolean): Promise<void> {
  await ensureAiRagTables();
  const stats = await queryOne<{
    hourly_count: string;
    daily_count: string;
    oldest_in_hour: Date | null;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour')::text AS hourly_count,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::text AS daily_count,
       MIN(created_at) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour') AS oldest_in_hour
     FROM ai_usage_logs
    WHERE user_id = $1 AND feature = 'chat'`,
    [userId],
  );

  const hourly = Number(stats?.hourly_count ?? 0);
  const daily = Number(stats?.daily_count ?? 0);
  const hourlyLimit = isLecturer ? LECTURER_CHAT_HOURLY_LIMIT : STUDENT_CHAT_HOURLY_LIMIT;

  if (hourly >= hourlyLimit) {
    const retryDate = stats?.oldest_in_hour
      ? new Date(new Date(stats.oldest_in_hour).getTime() + 60 * 60 * 1000)
      : new Date(Date.now() + 15 * 60 * 1000);
    const timeStr = retryDate.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    throw new HttpError(
      429,
      `Bạn đã dùng hết ${hourlyLimit} câu hỏi trong giờ này, vui lòng thử lại sau ${timeStr}.`,
    );
  }

  if (!isLecturer && daily >= STUDENT_CHAT_DAILY_LIMIT) {
    throw new HttpError(
      429,
      `Bạn đã dùng hết hạn mức ${STUDENT_CHAT_DAILY_LIMIT} câu hỏi trong ngày hôm nay. Vui lòng quay lại vào ngày mai.`,
    );
  }
}

/** Kiểm tra hạn mức tạo câu hỏi bằng AI của giảng viên (10 job/ngày, 1 job đang chạy/lớp). */
export async function assertQuestionGenQuota(lecturerId: number, classId: number): Promise<void> {
  await ensureAiRagTables();
  const runningJob = await queryOne<{ id: number }>(
    `SELECT id FROM ai_generation_jobs
      WHERE class_id = $1 AND status IN ('queued', 'running')
      LIMIT 1`,
    [classId],
  );
  if (runningJob) {
    throw new HttpError(
      409,
      `Lớp học đang có một tiến trình tạo câu hỏi AI (#${runningJob.id}) đang chạy. Vui lòng chờ hoàn tất hoặc hủy tiến trình đó trước.`,
    );
  }

  const daily = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM ai_generation_jobs
      WHERE lecturer_id = $1
        AND created_at >= NOW() - INTERVAL '24 hours'
        AND status <> 'cancelled'`,
    [lecturerId],
  );
  if (Number(daily?.cnt ?? 0) >= LECTURER_JOB_DAILY_LIMIT) {
    throw new HttpError(
      429,
      `Bạn đã sử dụng hết hạn mức ${LECTURER_JOB_DAILY_LIMIT} lần tạo câu hỏi bằng AI trong 24 giờ qua.`,
    );
  }
}
