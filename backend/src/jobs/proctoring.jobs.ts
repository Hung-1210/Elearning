// src/jobs/proctoring.jobs.ts
import { query } from '../config/database.js';
import { autoSubmitExpiredAttempts } from '../services/exam/attempt.service.js';
import { deleteEvidenceImage } from '../services/proctoring/storage.js';

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
      const n = await cleanupExpiredEvidence();
      if (n > 0) console.log(`[job:evidence-cleanup] Đã xóa ${n} ảnh bằng chứng hết hạn lưu trữ`);
    } catch (err) {
      console.error('[job:evidence-cleanup] Lỗi:', err);
    }
  }, EVIDENCE_CLEANUP_INTERVAL_MS);

  void cleanupExpiredEvidence();

  return () => { clearInterval(t1); clearInterval(t2); };
}

async function cleanupExpiredEvidence(): Promise<number> {
  const rows = await query<{ id: number; file_path: string }>(
    `SELECT id, file_path FROM proctoring_evidence WHERE expires_at <= NOW() AND deleted_at IS NULL LIMIT 500`,
  );
  for (const row of rows) {
    await deleteEvidenceImage(row.file_path).catch((err) =>
      console.error(`[job:evidence-cleanup] Không xóa được file cho evidence ${row.id}:`, err));
    await query('UPDATE proctoring_evidence SET deleted_at = NOW() WHERE id = $1', [row.id]);
  }
  return rows.length;
}
