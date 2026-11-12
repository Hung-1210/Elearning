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
export const ANSWER_FILES_DIR = 'answer-files';
export const MAX_ANSWER_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_ANSWER_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.txt', '.md', '.rtf', '.csv', '.json', '.xml',
  '.sql', '.py', '.ipynb', '.js', '.ts', '.tsx', '.jsx', '.java', '.c',
  '.cpp', '.cc', '.h', '.hpp', '.cs', '.go', '.rs', '.php', '.rb', '.html',
  '.css', '.zip', '.rar', '.7z', '.tar', '.gz', '.png', '.jpg', '.jpeg',
]);

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

/** Xóa ảnh snapshot tạm `latest.jpg` của attempt sau khi ca thi đã đóng hoặc hết hạn. */
export async function deleteLatestAttemptFrame(attemptId: number): Promise<void> {
  const latestRel = path.join(PROCTORING_DIR, String(attemptId), 'latest.jpg');
  await deleteEvidenceImage(latestRel);
}

/** Làm sạch tên file đính kèm bài làm và kiểm tra đuôi file hợp lệ. */
export function sanitizeAnswerFileName(originalName: string): { safeName: string; ext: string } {
  const base = path.basename(String(originalName || '').trim());
  const ext = path.extname(base).toLowerCase();
  if (!ext || !ALLOWED_ANSWER_EXTENSIONS.has(ext)) {
    throw new Error(
      `Định dạng tệp "${ext || '(không rõ)'}" không được hỗ trợ. Chỉ chấp nhận: ${Array.from(ALLOWED_ANSWER_EXTENSIONS).join(', ')}`,
    );
  }
  const stem = base
    .slice(0, Math.max(1, base.length - ext.length))
    .normalize('NFC')
    .replace(/[^a-zA-Z0-9_\-. \u00C0-\u024F\u1E00-\u1EFF]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80) || 'submission';
  return { safeName: `${stem}${ext}`, ext };
}

/** Trích xuất tên file hiển thị thân thiện từ relPath đã lưu trong DB. */
export function extractOriginalAnswerFileName(relPath: string): string {
  const base = path.posix.basename(String(relPath || '').replace(/\\/g, '/'));
  const sepIdx = base.indexOf('__');
  return sepIdx >= 0 && sepIdx + 2 < base.length ? base.slice(sepIdx + 2) : base;
}

/** Lưu file bài làm cho câu hỏi `file_upload` vào `private-uploads/answer-files/<attemptId>/...`. */
export async function saveAttemptAnswerFile(
  attemptId: number,
  questionId: number,
  originalName: string,
  buffer: Buffer,
): Promise<{ relPath: string; fileName: string; sizeBytes: number }> {
  if (!buffer || buffer.length === 0) {
    throw new Error('Tệp tải lên đang rỗng');
  }
  if (buffer.length > MAX_ANSWER_FILE_BYTES) {
    throw new Error('Dung lượng tệp vượt quá giới hạn 10 MB');
  }
  const { safeName } = sanitizeAnswerFileName(originalName);
  const relDir = path.join(ANSWER_FILES_DIR, String(attemptId));
  const absDir = path.join(PRIVATE_ROOT, relDir);
  await fs.mkdir(absDir, { recursive: true });

  const storedName = `q${questionId}-${Date.now()}-${randomUUID().slice(0, 8)}__${safeName}`;
  const relPath = path.join(relDir, storedName);
  await fs.writeFile(path.join(PRIVATE_ROOT, relPath), buffer);
  return {
    relPath: relPath.split(path.sep).join('/'),
    fileName: safeName,
    sizeBytes: buffer.length,
  };
}

/** Đọc file bài làm từ `private-uploads/answer-files/...`, có chống path traversal. */
export async function readAttemptAnswerFile(relPath: string): Promise<{ buffer: Buffer; fileName: string }> {
  const safeRel = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
  const answerRoot = path.join(PRIVATE_ROOT, ANSWER_FILES_DIR);
  const absPath = path.join(PRIVATE_ROOT, safeRel);
  if (!absPath.startsWith(answerRoot)) {
    throw new Error('Đường dẫn tệp bài làm không hợp lệ');
  }
  const buffer = await fs.readFile(absPath);
  return {
    buffer,
    fileName: extractOriginalAnswerFileName(relPath),
  };
}

/** Xóa file bài làm cũ khi sinh viên tải lên file thay thế. */
export async function deleteAttemptAnswerFile(relPath: string): Promise<void> {
  if (!relPath) return;
  const safeRel = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
  const answerRoot = path.join(PRIVATE_ROOT, ANSWER_FILES_DIR);
  const absPath = path.join(PRIVATE_ROOT, safeRel);
  if (!absPath.startsWith(answerRoot)) return;
  await fs.rm(absPath, { force: true });
}
