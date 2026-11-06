// src/services/proctoring/storage.ts
// QUAN TRỌNG: Ảnh bằng chứng chứa khuôn mặt là dữ liệu nhạy cảm,
// KHÔNG được đặt trong `uploads/` — dùng thư mục riêng `private-uploads/` SIBLING với
// `uploads/`, KHÔNG mount qua express.static. Chỉ truy cập qua route có requireLogin +
// kiểm tra quyền.

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const PRIVATE_ROOT = path.join(process.cwd(), 'private-uploads');
export const PROCTORING_DIR = 'proctoring';

/** Ghi buffer ảnh, trả về path TƯƠNG ĐỐI để lưu vào cột proctoring_evidence.file_path. */
export async function saveEvidenceImage(attemptId: number, buffer: Buffer): Promise<string> {
  const relDir = path.join(PROCTORING_DIR, String(attemptId));
  const absDir = path.join(PRIVATE_ROOT, relDir);
  await fs.mkdir(absDir, { recursive: true });

  const fileName = `${Date.now()}-${randomUUID()}.jpg`;
  const relPath = path.join(relDir, fileName);
  await fs.writeFile(path.join(PRIVATE_ROOT, relPath), buffer);
  return relPath.split(path.sep).join('/'); // luôn lưu DB dạng posix path
}

/** Đọc lại file theo path tương đối đã lưu trong DB, có chống path traversal. */
export async function readEvidenceImage(relPath: string): Promise<Buffer> {
  const safeRel = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
  const absPath = path.join(PRIVATE_ROOT, safeRel);
  if (!absPath.startsWith(PRIVATE_ROOT)) {
    throw new Error('Đường dẫn không hợp lệ');
  }
  return fs.readFile(absPath);
}

export async function deleteEvidenceImage(relPath: string): Promise<void> {
  const safeRel = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
  const absPath = path.join(PRIVATE_ROOT, safeRel);
  if (!absPath.startsWith(PRIVATE_ROOT)) return;
  await fs.rm(absPath, { force: true });
}

/** Ghi đè ảnh mới nhất của attempt (1 file duy nhất `latest.jpg` / attempt) cho màn Live Monitor. */
export async function saveLatestAttemptFrame(attemptId: number, buffer: Buffer): Promise<string> {
  const relDir = path.join(PROCTORING_DIR, String(attemptId));
  const absDir = path.join(PRIVATE_ROOT, relDir);
  await fs.mkdir(absDir, { recursive: true });
  const relPath = path.join(relDir, 'latest.jpg');
  await fs.writeFile(path.join(PRIVATE_ROOT, relPath), buffer);
  return relPath.split(path.sep).join('/');
}

/** Đọc ảnh mới nhất của attempt (nếu chưa có thì thử ảnh tham chiếu lúc pre-check). */
export async function readLatestAttemptFrame(attemptId: number, fallbackRelPath?: string | null): Promise<Buffer | null> {
  const latestRel = path.join(PROCTORING_DIR, String(attemptId), 'latest.jpg');
  try {
    return await readEvidenceImage(latestRel);
  } catch {
    if (!fallbackRelPath) return null;
    try {
      return await readEvidenceImage(fallbackRelPath);
    } catch {
      return null;
    }
  }
}
