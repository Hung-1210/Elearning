// src/jobs/proctoring.jobs.ts
import { query } from '../config/database.js';
import { autoSubmitExpiredAttempts } from '../services/exam/attempt.service.js';
import { deleteEvidenceImage, deleteLatestAttemptFrame } from '../services/proctoring/storage.js';

const AUTO_SUBMIT_INTERVAL_MS = 30_000;
const EVIDENCE_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function startProctoringJobs() {
  const t1 = setInterval(async () => {
    try {
      const n = await autoSubmitExpiredAttempts();
      if (n > 0) console.log(`[job:auto-submit] Đã tự nộp ${n} lần làm bài hết giờ`);
    } catch (err) {
      console.error('[job:auto-submit] Lỗi:', err);
    }
  }, AUTO_SUBMIT_INTERVAL_MS);

  const t2 = setInterval(async () => {
    try {
      const stats = await cleanupExpiredEvidence();
      const total = stats.evidenceCount + stats.precheckCount + stats.attemptRefCount;
      if (total > 0) {
        console.log(
          `[job:evidence-cleanup] Đã dọn ${stats.evidenceCount} ảnh vi phạm, ${stats.precheckCount} phiên precheck hết hạn, ${stats.attemptRefCount} dữ liệu sinh trắc hết hạn lưu trữ`,
        );
      }
    } catch (err) {
      console.error('[job:evidence-cleanup] Lỗi:', err);
    }
  }, EVIDENCE_CLEANUP_INTERVAL_MS);

  void cleanupExpiredEvidence().catch((err) =>
    console.error('[job:evidence-cleanup] Lỗi khởi chạy lần đầu:', err),
  );

  return () => { clearInterval(t1); clearInterval(t2); };
}

export async function cleanupExpiredEvidence(): Promise<{
  evidenceCount: number;
  precheckCount: number;
  attemptRefCount: number;
}> {
  // 1. Xóa ảnh bằng chứng vi phạm đã quá hạn lưu trữ (expires_at <= NOW())
  const rows = await query<{ id: number; file_path: string }>(
    `SELECT id, file_path
       FROM proctoring_evidence
      WHERE expires_at <= NOW() AND deleted_at IS NULL
      LIMIT 500`,
  );
  for (const row of rows) {
    await deleteEvidenceImage(row.file_path).catch((err) =>
      console.error(`[job:evidence-cleanup] Không xóa được file cho evidence ${row.id}:`, err));
    await query('UPDATE proctoring_evidence SET deleted_at = NOW() WHERE id = $1', [row.id]);
  }

  // 2. Xóa các phiên pre-check hết hạn mà thí sinh không sử dụng để vào thi (consumed_at IS NULL)
  const expiredPrechecks = await query<{ id: string; reference_photo_path: string | null }>(
    `SELECT eps.id, eps.reference_photo_path
       FROM exam_precheck_sessions eps
      WHERE eps.expires_at <= NOW()
        AND eps.consumed_at IS NULL
      LIMIT 500`,
  );
  for (const pre of expiredPrechecks) {
    if (pre.reference_photo_path) {
      const stillReferenced = await query<{ id: number }>(
        `SELECT id FROM exam_attempts WHERE reference_photo_path = $1 LIMIT 1`,
        [pre.reference_photo_path],
      );
      if (stillReferenced.length === 0) {
        await deleteEvidenceImage(pre.reference_photo_path).catch((err) =>
          console.error(`[job:evidence-cleanup] Không xóa được ảnh precheck ${pre.id}:`, err));
      }
    }
    await query('DELETE FROM exam_precheck_sessions WHERE id = $1', [pre.id]);
  }

  // Dọn các bản ghi exam_precheck_sessions đã consumed quá 24 giờ (ảnh gốc lúc này do exam_attempts quản lý)
  await query(
    `DELETE FROM exam_precheck_sessions
      WHERE consumed_at IS NOT NULL
        AND expires_at <= NOW() - INTERVAL '24 hours'`,
  );

  // 3. Xóa ảnh tham chiếu khuôn mặt + vector sinh trắc trên exam_attempts khi hết thời hạn lưu trữ của đề thi
  const expiredAttempts = await query<{ id: number; reference_photo_path: string | null }>(
    `SELECT ea.id, ea.reference_photo_path
       FROM exam_attempts ea
       LEFT JOIN exam_proctoring_settings eps ON eps.exam_id = ea.exam_id
      WHERE ea.status = 'submitted'
        AND (ea.reference_photo_path IS NOT NULL OR ea.reference_embedding IS NOT NULL)
        AND COALESCE(ea.submitted_at, ea.started_at)
            + make_interval(days => COALESCE(eps.evidence_retention_days, 90)) <= NOW()
      LIMIT 500`,
  );
  for (const att of expiredAttempts) {
    if (att.reference_photo_path) {
      await deleteEvidenceImage(att.reference_photo_path).catch((err) =>
        console.error(`[job:evidence-cleanup] Không xóa được ảnh tham chiếu attempt ${att.id}:`, err));
    }
    await deleteLatestAttemptFrame(att.id).catch(() => {});
    await query(
      `UPDATE exam_attempts
          SET reference_photo_path = NULL,
              reference_embedding = NULL
        WHERE id = $1`,
      [att.id],
    );
  }

  // 4. Dọn file snapshot tạm `latest.jpg` của các lượt thi đã nộp quá 24 giờ
  const recentlyClosedAttempts = await query<{ id: number }>(
    `SELECT id
       FROM exam_attempts
      WHERE status = 'submitted'
        AND COALESCE(submitted_at, started_at) <= NOW() - INTERVAL '24 hours'
        AND COALESCE(submitted_at, started_at) >= NOW() - INTERVAL '14 days'
      LIMIT 500`,
  );
  for (const att of recentlyClosedAttempts) {
    await deleteLatestAttemptFrame(att.id).catch(() => {});
  }

  // 5. Dọn ảnh bằng chứng điểm danh không khớp (`attendance_records.evidence_path`) đã hết hạn lưu trữ (30 ngày)
  try {
    const expiredAttendanceEv = await query<{ id: number; evidence_path: string }>(
      `SELECT id, evidence_path
         FROM attendance_records
        WHERE evidence_path IS NOT NULL
          AND evidence_expires_at IS NOT NULL
          AND evidence_expires_at <= NOW()
        LIMIT 500`,
    );
    for (const rec of expiredAttendanceEv) {
      await deleteEvidenceImage(rec.evidence_path).catch(() => {});
      await query(
        `UPDATE attendance_records SET evidence_path = NULL WHERE id = $1`,
        [rec.id],
      );
    }
  } catch {
    // Bảng attendance_records có thể chưa được khởi tạo trong lần chạy đầu
  }

  return {
    evidenceCount: rows.length,
    precheckCount: expiredPrechecks.length,
    attemptRefCount: expiredAttempts.length,
  };
}
