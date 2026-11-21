// src/services/ai/ingestion.service.ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { query, queryOne, withTransaction } from '../../config/database.js';
import { HttpError } from '../../utils/http-error.js';
import { chunkDocumentPages, cleanDisplayFileName } from './chunker.js';
import {
  embedBatch,
  GeminiApiError,
  getEmbedModel,
  isGeminiConfigured,
} from './gemini.client.js';
import { logAiUsage } from './quota.js';
import { ensureAiRagTables } from './schema.js';
import { extractDocumentPages, isSupportedDocExtension } from './text-extract.js';
import { replaceDocumentChunks } from './vector-store.js';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const MAX_INGEST_ATTEMPTS = 3;
export const INGEST_PIPELINE_VERSION = 'v3';

export function getExpectedEmbedModelTag(): string {
  return `${getEmbedModel()}@${INGEST_PIPELINE_VERSION}`;
}

let workerRunning = false;
const pendingQueue: number[] = [];
const queuedSet = new Set<number>();

export interface ClassDocAiStatus {
  docId: number;
  fileName: string;
  displayFileName: string;
  categoryName: string;
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'unsupported';
  errorCode: string | null;
  errorMessage: string | null;
  pageCount: number | null;
  charCount: number | null;
  chunkCount: number;
  updatedAt: string | null;
  headings: string[];
}

function resolveDocFilePath(fileName: string): string {
  return path.join(UPLOADS_DIR, fileName);
}

async function computeFileSha256(filePath: string): Promise<string> {
  const buf = await fs.promises.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Đưa 1 tài liệu vào hàng đợi lập chỉ mục RAG (không chặn luồng gọi API). */
export async function enqueueDocumentIngestion(
  docId: number,
  opts?: { force?: boolean },
): Promise<void> {
  await ensureAiRagTables();
  const doc = await queryOne<{ id: number; file_name: string }>(
    'SELECT id, file_name FROM docs WHERE id = $1',
    [docId],
  );
  if (!doc) return;

  if (!isSupportedDocExtension(doc.file_name)) {
    await query(
      `INSERT INTO doc_ingestions (doc_id, status, error_code, error_message, updated_at)
       VALUES ($1, 'unsupported', 'unsupported', 'Định dạng tệp không hỗ trợ hỏi đáp AI (chỉ hỗ trợ PDF, DOCX, PPTX, TXT, MD).', NOW())
       ON CONFLICT (doc_id) DO UPDATE SET
         status = 'unsupported',
         error_code = 'unsupported',
         error_message = EXCLUDED.error_message,
         updated_at = NOW()`,
      [docId],
    );
    return;
  }

  if (opts?.force) {
    await query(
      `INSERT INTO doc_ingestions (doc_id, status, error_code, error_message, content_hash, attempts, updated_at)
       VALUES ($1, 'pending', NULL, NULL, NULL, 0, NOW())
       ON CONFLICT (doc_id) DO UPDATE SET
         status = 'pending',
         error_code = NULL,
         error_message = NULL,
         content_hash = NULL,
         attempts = 0,
         updated_at = NOW()`,
      [docId],
    );
  } else {
    await query(
      `INSERT INTO doc_ingestions (doc_id, status, updated_at)
       VALUES ($1, 'pending', NOW())
       ON CONFLICT (doc_id) DO NOTHING`,
      [docId],
    );
  }

  pushToMemoryQueue(docId);
  void kickIngestionWorker();
}

function pushToMemoryQueue(docId: number) {
  if (!queuedSet.has(docId)) {
    queuedSet.add(docId);
    pendingQueue.push(docId);
  }
}

/** Tự động kiểm tra và đưa các tài liệu của lớp chưa có trong doc_ingestions vào hàng đợi. */
export async function ensureClassDocsQueued(classId: number): Promise<void> {
  await ensureAiRagTables();
  const rows = await query<{
    doc_id: number;
    file_name: string;
    status: string | null;
    error_code: string | null;
    embed_model: string | null;
  }>(
    `SELECT caf.doc_id, d.file_name, di.status, di.error_code, di.embed_model
       FROM class_attach_files caf
       JOIN docs d ON d.id = caf.doc_id
       LEFT JOIN doc_ingestions di ON di.doc_id = caf.doc_id
      WHERE caf.class_id = $1`,
    [classId],
  );

  const apiKeyReady = isGeminiConfigured();
  const expectedTag = getExpectedEmbedModelTag();

  for (const row of rows) {
    if (!row.status) {
      await enqueueDocumentIngestion(row.doc_id);
    } else if (row.status === 'pending') {
      pushToMemoryQueue(row.doc_id);
    } else if (
      row.status === 'ready' &&
      apiKeyReady &&
      row.embed_model !== expectedTag
    ) {
      // Tự động re-index khi nâng cấp bộ trích xuất PDF/chunker (v3) hoặc đổi model embedding
      await enqueueDocumentIngestion(row.doc_id, { force: true });
    } else if (
      row.status === 'failed' &&
      row.error_code === 'missing_api_key' &&
      apiKeyReady
    ) {
      // Tự động chạy lại khi người dùng vừa bổ sung GEMINI_API_KEY vào .env
      await enqueueDocumentIngestion(row.doc_id, { force: true });
    }
  }

  if (pendingQueue.length > 0) {
    void kickIngestionWorker();
  }
}

/** Khôi phục các tài liệu đang pending/processing khi khởi động lại server. */
export async function resumePendingIngestionsOnStartup(): Promise<void> {
  await ensureAiRagTables();
  const expectedTag = getExpectedEmbedModelTag();
  const rows = await query<{ doc_id: number; status: string; embed_model: string | null }>(
    `SELECT doc_id, status, embed_model
       FROM doc_ingestions
      WHERE status IN ('pending', 'processing')
         OR (status = 'failed' AND error_code = 'missing_api_key')
         OR (status = 'ready' AND COALESCE(embed_model, '') <> $1)
      ORDER BY updated_at ASC`,
    [expectedTag],
  );
  for (const r of rows) {
    if (r.status === 'ready' && r.embed_model !== expectedTag) {
      await enqueueDocumentIngestion(Number(r.doc_id), { force: true });
    } else {
      pushToMemoryQueue(Number(r.doc_id));
    }
  }
  if (pendingQueue.length > 0) {
    void kickIngestionWorker();
  }
}

async function kickIngestionWorker(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (pendingQueue.length > 0) {
      const docId = pendingQueue.shift()!;
      queuedSet.delete(docId);
      await processSingleDocument(docId).catch((err) => {
        console.error(`[ai-ingest] Lỗi không mong đợi khi xử lý doc #${docId}:`, err);
      });
    }
  } finally {
    workerRunning = false;
  }
}

async function processSingleDocument(docId: number): Promise<void> {
  const doc = await queryOne<{
    id: number;
    file_name: string;
    lecturer_id: number;
    status: string | null;
    content_hash: string | null;
    chunk_count: number | null;
    attempts: number | null;
  }>(
    `SELECT d.id,
            d.file_name,
            dc.lecturer_id,
            di.status,
            di.content_hash,
            di.chunk_count,
            di.attempts
       FROM docs d
       JOIN doc_categories dc ON dc.id = d.doc_category_id
       LEFT JOIN doc_ingestions di ON di.doc_id = d.id
      WHERE d.id = $1`,
    [docId],
  );
  if (!doc) return;

  if (!isSupportedDocExtension(doc.file_name)) {
    await query(
      `UPDATE doc_ingestions
          SET status = 'unsupported',
              error_code = 'unsupported',
              error_message = 'Định dạng tệp không hỗ trợ hỏi đáp AI (chỉ hỗ trợ PDF, DOCX, PPTX, TXT, MD).',
              updated_at = NOW()
        WHERE doc_id = $1`,
      [docId],
    );
    return;
  }

  const filePath = resolveDocFilePath(doc.file_name);
  if (!fs.existsSync(filePath)) {
    await query(
      `UPDATE doc_ingestions
          SET status = 'failed',
              error_code = 'parse_error',
              error_message = 'Không tìm thấy tệp vật lý trên máy chủ.',
              updated_at = NOW()
        WHERE doc_id = $1`,
      [docId],
    );
    return;
  }

  const fileHash = await computeFileSha256(filePath);
  if (
    doc.status === 'ready' &&
    doc.content_hash === fileHash &&
    Number(doc.chunk_count ?? 0) > 0
  ) {
    return;
  }

  if (!isGeminiConfigured()) {
    await query(
      `UPDATE doc_ingestions
          SET status = 'failed',
              error_code = 'missing_api_key',
              error_message = 'Chưa cấu hình GEMINI_API_KEY trong backend/.env. Sau khi thêm khóa API, tài liệu sẽ tự động được lập chỉ mục.',
              updated_at = NOW()
        WHERE doc_id = $1`,
      [docId],
    );
    return;
  }

  await query(
    `UPDATE doc_ingestions
        SET status = 'processing',
            error_code = NULL,
            error_message = NULL,
            attempts = COALESCE(attempts, 0) + 1,
            updated_at = NOW()
      WHERE doc_id = $1`,
    [docId],
  );

  const extraction = await extractDocumentPages(filePath, doc.file_name);
  if (extraction.status !== 'ok') {
    const newStatus = extraction.status === 'unsupported' ? 'unsupported' : 'failed';
    await query(
      `UPDATE doc_ingestions
          SET status = $2,
              error_code = $3,
              error_message = $4,
              page_count = $5,
              char_count = $6,
              updated_at = NOW()
        WHERE doc_id = $1`,
      [
        docId,
        newStatus,
        extraction.errorCode ?? 'parse_error',
        extraction.errorMessage ?? 'Không thể trích xuất văn bản từ tài liệu',
        extraction.pageCount || null,
        extraction.charCount || null,
      ],
    );
    return;
  }

  const chunks = chunkDocumentPages(extraction.pages, doc.file_name);
  if (chunks.length === 0) {
    await query(
      `UPDATE doc_ingestions
          SET status = 'failed',
              error_code = 'parse_error',
              error_message = 'Không tạo được đoạn văn bản nào từ tài liệu.',
              page_count = $2,
              char_count = $3,
              updated_at = NOW()
        WHERE doc_id = $1`,
      [docId, extraction.pageCount, extraction.charCount],
    );
    return;
  }

  try {
    // Nhúng trực tiếp nội dung văn bản sạch (giống Old backend rag) để khớp đối xứng với câu truy vấn
    const { embeddings, tokensIn } = await embedBatch(
      chunks.map((c) => c.content),
    );

    const embedModel = getExpectedEmbedModelTag();

    await withTransaction(async (client) => {
      await replaceDocumentChunks(client, docId, chunks, embeddings);
      await client.query(
        `UPDATE doc_ingestions
            SET status = 'ready',
                error_code = NULL,
                error_message = NULL,
                content_hash = $2,
                page_count = $3,
                char_count = $4,
                chunk_count = $5,
                embed_model = $6,
                updated_at = NOW()
          WHERE doc_id = $1`,
        [
          docId,
          fileHash,
          extraction.pageCount,
          extraction.charCount,
          chunks.length,
          embedModel,
        ],
      );
    });

    await logAiUsage({
      userId: Number(doc.lecturer_id),
      feature: 'embed',
      tokensIn,
      tokensOut: 0,
    });
  } catch (err: any) {
    const attempts = Number(doc.attempts ?? 0) + 1;
    const isMissingKey = err instanceof GeminiApiError && err.code === 'MISSING_API_KEY';
    const errorCode = isMissingKey ? 'missing_api_key' : 'embed_error';
    const errorMessage =
      err instanceof GeminiApiError
        ? err.message
        : `Lỗi khi tạo vector embedding: ${err?.message || 'Lỗi không xác định'}`;

    await query(
      `UPDATE doc_ingestions
          SET status = 'failed',
              error_code = $2,
              error_message = $3,
              updated_at = NOW()
        WHERE doc_id = $1`,
      [docId, errorCode, errorMessage],
    );

    // Nếu lỗi mạng/rate limit tạm thời và chưa quá MAX_INGEST_ATTEMPTS thì hẹn thử lại
    if (!isMissingKey && attempts < MAX_INGEST_ATTEMPTS) {
      setTimeout(() => {
        pushToMemoryQueue(docId);
        void kickIngestionWorker();
      }, 5000 * attempts);
    }
  }
}

/** Lấy trạng thái lập chỉ mục của tất cả tài liệu đính kèm trong 1 lớp học. */
export async function getClassDocsAiStatus(classId: number): Promise<{
  geminiConfigured: boolean;
  docs: ClassDocAiStatus[];
}> {
  await ensureClassDocsQueued(classId);

  const rows = await query<any>(
    `SELECT caf.doc_id,
            d.file_name,
            dc.name AS category_name,
            COALESCE(di.status, 'pending') AS status,
            di.error_code,
            di.error_message,
            di.page_count,
            di.char_count,
            COALESCE(di.chunk_count, 0) AS chunk_count,
            di.updated_at,
            COALESCE(
              ARRAY(
                SELECT DISTINCT ch.heading
                  FROM doc_chunks ch
                 WHERE ch.doc_id = caf.doc_id
                   AND ch.heading IS NOT NULL
                 ORDER BY ch.heading
                 LIMIT 40
              ),
              '{}'::text[]
            ) AS headings
       FROM class_attach_files caf
       JOIN docs d ON d.id = caf.doc_id
       JOIN doc_categories dc ON dc.id = d.doc_category_id
       LEFT JOIN doc_ingestions di ON di.doc_id = caf.doc_id
      WHERE caf.class_id = $1
      ORDER BY dc.name ASC, d.file_name ASC`,
    [classId],
  );

  return {
    geminiConfigured: isGeminiConfigured(),
    docs: rows.map((r) => ({
      docId: Number(r.doc_id),
      fileName: String(r.file_name),
      displayFileName: cleanDisplayFileName(String(r.file_name)),
      categoryName: String(r.category_name || 'Khác'),
      status: r.status as ClassDocAiStatus['status'],
      errorCode: r.error_code ?? null,
      errorMessage: r.error_message ?? null,
      pageCount: r.page_count !== null ? Number(r.page_count) : null,
      charCount: r.char_count !== null ? Number(r.char_count) : null,
      chunkCount: Number(r.chunk_count ?? 0),
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
      headings: Array.isArray(r.headings) ? r.headings.filter(Boolean) : [],
    })),
  };
}

/** Giảng viên yêu cầu lập chỉ mục lại (reindex) 1 tài liệu. */
export async function reindexDocumentForLecturer(
  lecturerId: number,
  docId: number,
): Promise<{ docId: number; status: string }> {
  await ensureAiRagTables();
  const allowed = await queryOne(
    `SELECT 1
       FROM docs d
       JOIN doc_categories dc ON dc.id = d.doc_category_id
      WHERE d.id = $1
        AND (
          dc.lecturer_id = $2
          OR EXISTS (
            SELECT 1
              FROM class_attach_files caf
              JOIN classes c ON c.id = caf.class_id
              LEFT JOIN class_collaborators cc ON cc.class_id = c.id
             WHERE caf.doc_id = d.id
               AND (c.lecturer_id = $2 OR cc.lecturer_id = $2)
          )
        )
      LIMIT 1`,
    [docId, lecturerId],
  );
  if (!allowed) {
    throw new HttpError(403, 'Bạn không có quyền lập chỉ mục lại tài liệu này');
  }

  await enqueueDocumentIngestion(docId, { force: true });
  return { docId, status: 'pending' };
}
