// src/services/ai/rag.service.ts
import { query, queryOne } from '../../config/database.js';
import { HttpError } from '../../utils/http-error.js';
import { cleanDisplayFileName } from './chunker.js';
import {
  embedText,
  GeminiApiError,
  generateStructuredJson,
  isGeminiConfigured,
  streamGenerateText,
  type GeminiContent,
} from './gemini.client.js';
import { ensureClassDocsQueued } from './ingestion.service.js';
import {
  buildRagSystemPrompt,
  buildSuggestedQuestionsPrompt,
  SUGGESTED_QUESTIONS_SCHEMA,
} from './prompts.js';
import {
  assertChatQuota,
  assertStudentNotInActiveExam,
  checkStudentActiveExamLock,
  logAiUsage,
} from './quota.js';
import { ensureAiRagTables } from './schema.js';
import { hybridRetrieveClassChunks, type RetrievedChunk } from './vector-store.js';

export interface RagCitationItem {
  n: number;
  chunkId: number;
  docId: number;
  fileName: string;
  displayFileName: string;
  pageFrom: number | null;
  pageTo: number | null;
  heading: string | null;
  snippet: string;
}

const suggestedCache = new Map<string, { expiresAt: number; questions: string[] }>();

async function ensureConversationOwner(conversationId: number, userId: number) {
  await ensureAiRagTables();
  const conv = await queryOne<{
    id: number;
    class_id: number;
    user_id: number;
    title: string;
    doc_scope: number[] | null;
    class_name: string;
  }>(
    `SELECT rc.id, rc.class_id, rc.user_id, rc.title, rc.doc_scope, c.name AS class_name
       FROM rag_conversations rc
       JOIN classes c ON c.id = rc.class_id
      WHERE rc.id = $1`,
    [conversationId],
  );
  if (!conv) {
    throw new HttpError(404, 'Không tìm thấy cuộc trò chuyện');
  }
  if (Number(conv.user_id) !== Number(userId)) {
    throw new HttpError(403, 'Bạn không có quyền truy cập cuộc trò chuyện này');
  }
  return conv;
}

export async function listRagConversations(classId: number, userId: number, isLecturer: boolean) {
  await ensureAiRagTables();
  const examLock = await checkStudentActiveExamLock(userId, classId, isLecturer);
  const rows = await query<any>(
    `SELECT id, class_id, user_id, title, doc_scope, created_at, updated_at
       FROM rag_conversations
      WHERE class_id = $1 AND user_id = $2
      ORDER BY updated_at DESC
      LIMIT 50`,
    [classId, userId],
  );
  return {
    examLock,
    conversations: rows.map((r) => ({
      id: Number(r.id),
      classId: Number(r.class_id),
      userId: Number(r.user_id),
      title: String(r.title),
      docScope: Array.isArray(r.doc_scope) ? r.doc_scope.map(Number) : null,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    })),
  };
}

export async function createRagConversation(
  classId: number,
  userId: number,
  input?: { title?: string; docScope?: number[] | null },
) {
  await ensureAiRagTables();
  const title = (input?.title ?? '').trim().slice(0, 200) || 'Cuộc trò chuyện mới';
  const docScope =
    Array.isArray(input?.docScope) && input!.docScope.length > 0
      ? input!.docScope.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : null;

  const row = await queryOne<any>(
    `INSERT INTO rag_conversations (class_id, user_id, title, doc_scope)
     VALUES ($1, $2, $3, $4)
     RETURNING id, class_id, user_id, title, doc_scope, created_at, updated_at`,
    [classId, userId, title, docScope],
  );

  return {
    id: Number(row.id),
    classId: Number(row.class_id),
    userId: Number(row.user_id),
    title: String(row.title),
    docScope: Array.isArray(row.doc_scope) ? row.doc_scope.map(Number) : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function updateRagConversation(
  conversationId: number,
  userId: number,
  input: { title?: string; docScope?: number[] | null },
) {
  const conv = await ensureConversationOwner(conversationId, userId);
  const newTitle = input.title !== undefined ? input.title.trim().slice(0, 200) || conv.title : conv.title;
  const newScope =
    input.docScope !== undefined
      ? Array.isArray(input.docScope) && input.docScope.length > 0
        ? input.docScope.map(Number).filter((n) => Number.isInteger(n) && n > 0)
        : null
      : conv.doc_scope;

  const row = await queryOne<any>(
    `UPDATE rag_conversations
        SET title = $2,
            doc_scope = $3,
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, class_id, user_id, title, doc_scope, created_at, updated_at`,
    [conversationId, newTitle, newScope],
  );
  return {
    id: Number(row.id),
    classId: Number(row.class_id),
    userId: Number(row.user_id),
    title: String(row.title),
    docScope: Array.isArray(row.doc_scope) ? row.doc_scope.map(Number) : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function deleteRagConversation(conversationId: number, userId: number) {
  await ensureConversationOwner(conversationId, userId);
  await query('DELETE FROM rag_conversations WHERE id = $1', [conversationId]);
  return { deleted: true };
}

export async function getRagConversationMessages(conversationId: number, userId: number) {
  const conv = await ensureConversationOwner(conversationId, userId);

  // Dọn các tin nhắn user bị mồ côi (không có câu trả lời assistant kế tiếp do lỗi trước đây)
  await query(
    `DELETE FROM rag_messages m1
      WHERE m1.conversation_id = $1
        AND m1.role = 'user'
        AND EXISTS (
          SELECT 1 FROM rag_messages m2
           WHERE m2.conversation_id = m1.conversation_id
             AND m2.id > m1.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM rag_messages m3
           WHERE m3.conversation_id = m1.conversation_id
             AND m3.id > m1.id
             AND m3.role = 'assistant'
             AND NOT EXISTS (
               SELECT 1 FROM rag_messages m4
                WHERE m4.conversation_id = m1.conversation_id
                  AND m4.id > m1.id AND m4.id < m3.id
             )
        )`,
    [conversationId],
  ).catch(() => {});

  const rows = await query<any>(
    `SELECT id, conversation_id, role, content, citations, grounded,
            tokens_in, tokens_out, latency_ms, feedback, created_at
       FROM rag_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC, id ASC`,
    [conversationId],
  );
  return {
    conversation: {
      id: Number(conv.id),
      classId: Number(conv.class_id),
      title: String(conv.title),
      docScope: Array.isArray(conv.doc_scope) ? conv.doc_scope.map(Number) : null,
    },
    messages: rows.map((r) => ({
      id: Number(r.id),
      conversationId: Number(r.conversation_id),
      role: r.role as 'user' | 'assistant',
      content: String(r.content),
      citations: Array.isArray(r.citations) ? r.citations : [],
      grounded: r.grounded !== null ? Boolean(r.grounded) : true,
      latencyMs: r.latency_ms !== null ? Number(r.latency_ms) : null,
      feedback: r.feedback !== null ? (Number(r.feedback) as -1 | 1) : null,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  };
}

export async function setRagMessageFeedback(
  messageId: number,
  userId: number,
  feedback: -1 | 1 | null,
) {
  await ensureAiRagTables();
  const msg = await queryOne<{ id: number; user_id: number }>(
    `SELECT rm.id, rc.user_id
       FROM rag_messages rm
       JOIN rag_conversations rc ON rc.id = rm.conversation_id
      WHERE rm.id = $1`,
    [messageId],
  );
  if (!msg) throw new HttpError(404, 'Không tìm thấy tin nhắn');
  if (Number(msg.user_id) !== Number(userId)) {
    throw new HttpError(403, 'Bạn không có quyền đánh giá tin nhắn này');
  }
  const val = feedback === 1 || feedback === -1 ? feedback : null;
  await query('UPDATE rag_messages SET feedback = $2 WHERE id = $1', [messageId, val]);
  return { id: messageId, feedback: val };
}

/** Lấy 4 câu hỏi gợi ý cho lớp học (có cache theo bộ tài liệu đã index). */
export async function getSuggestedQuestionsForClass(classId: number): Promise<string[]> {
  await ensureClassDocsQueued(classId);

  const sampleRows = await query<{
    doc_id: number;
    file_name: string;
    heading: string | null;
    content: string;
  }>(
    `SELECT dc.doc_id, d.file_name, dc.heading, dc.content
       FROM doc_chunks dc
       JOIN docs d ON d.id = dc.doc_id
       JOIN class_attach_files caf ON caf.doc_id = dc.doc_id AND caf.class_id = $1
       JOIN doc_ingestions di ON di.doc_id = dc.doc_id AND di.status = 'ready'
      WHERE dc.chunk_index <= 3
      ORDER BY dc.doc_id ASC, dc.chunk_index ASC
      LIMIT 8`,
    [classId],
  );

  if (sampleRows.length === 0) {
    return [];
  }

  const cacheKey = `${classId}:${sampleRows.map((r) => r.doc_id).join(',')}`;
  const cached = suggestedCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.questions;
  }

  // Fallback tạo câu hỏi gợi ý từ tiêu đề chương/tên file nếu chưa có API key hoặc lỗi
  const buildFallbackSuggestions = (): string[] => {
    const suggestions: string[] = [];
    const seen = new Set<string>();
    for (const r of sampleRows) {
      const display = cleanDisplayFileName(r.file_name).replace(/\.[^.]+$/, '');
      const candidate = r.heading
        ? `Giải thích nội dung chính phần "${r.heading}"?`
        : `Tóm tắt các khái niệm trọng tâm trong tài liệu "${display}"?`;
      if (!seen.has(candidate)) {
        seen.add(candidate);
        suggestions.push(candidate);
      }
      if (suggestions.length >= 4) break;
    }
    return suggestions;
  };

  if (!isGeminiConfigured()) {
    return buildFallbackSuggestions();
  }

  try {
    const cls = await queryOne<{ name: string }>('SELECT name FROM classes WHERE id = $1', [
      classId,
    ]);
    const prompt = buildSuggestedQuestionsPrompt(
      cls?.name || `Lớp #${classId}`,
      sampleRows.map((r) => ({
        fileName: cleanDisplayFileName(r.file_name),
        heading: r.heading,
        content: r.content,
      })),
    );
    const { data } = await generateStructuredJson<{ questions: string[] }>({
      prompt,
      responseSchema: SUGGESTED_QUESTIONS_SCHEMA,
      temperature: 0.4,
      thinkingBudget: 0,
      timeoutMs: 12_000,
    });
    const list = (data?.questions ?? [])
      .map((q) => String(q).trim())
      .filter((q) => q.length > 5 && q.length <= 140)
      .slice(0, 4);
    if (list.length > 0) {
      suggestedCache.set(cacheKey, {
        expiresAt: Date.now() + 30 * 60 * 1000,
        questions: list,
      });
      return list;
    }
  } catch {
    // Dùng fallback nếu Gemini bận
  }

  return buildFallbackSuggestions();
}

export function buildCitationsFromRetrievedChunks(
  answerText: string,
  chunks: RetrievedChunk[],
): RagCitationItem[] {
  const referencedNumbers = new Set<number>();
  const refMatches = answerText.matchAll(/\[(\d{1,2})\]/g);
  for (const m of refMatches) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= chunks.length) {
      referencedNumbers.add(n);
    }
  }

  // Nếu câu trả lời không gắn [1], [2] rõ ràng nhưng có dùng ngữ cảnh, hiển thị tối đa 3 nguồn đầu tiên
  if (referencedNumbers.size === 0) {
    for (let i = 1; i <= Math.min(3, chunks.length); i++) {
      referencedNumbers.add(i);
    }
  }

  const citations: RagCitationItem[] = [];
  for (const n of Array.from(referencedNumbers).sort((a, b) => a - b)) {
    const c = chunks[n - 1];
    if (!c) continue;
    citations.push({
      n,
      chunkId: c.chunkId,
      docId: c.docId,
      fileName: c.fileName,
      displayFileName: c.displayFileName,
      pageFrom: c.pageFrom,
      pageTo: c.pageTo,
      heading: c.heading,
      snippet: c.content.slice(0, 320).trim(),
    });
  }
  return citations;
}

/** Thực thi luồng RAG Chat và bắn sự kiện SSE (meta, delta, citations, done, error). */
export async function streamRagChatResponse(opts: {
  conversationId: number;
  userId: number;
  isLecturer: boolean;
  question: string;
  docScope?: number[] | null;
  signal?: AbortSignal;
  sendEvent: (event: string, data: any) => void;
}): Promise<void> {
  const startedAt = Date.now();
  const conv = await ensureConversationOwner(opts.conversationId, opts.userId);
  const classId = Number(conv.class_id);

  await assertStudentNotInActiveExam(opts.userId, classId, opts.isLecturer);
  await assertChatQuota(opts.userId, opts.isLecturer);

  const trimmedQuestion = (opts.question || '').trim();
  if (!trimmedQuestion) {
    throw new HttpError(400, 'Vui lòng nhập nội dung câu hỏi.');
  }
  if (trimmedQuestion.length > 2000) {
    throw new HttpError(400, 'Câu hỏi tối đa 2.000 ký tự.');
  }

  if (!isGeminiConfigured()) {
    throw new HttpError(
      503,
      'Chưa cấu hình GEMINI_API_KEY trong backend/.env. Vui lòng thêm khóa API Gemini để sử dụng Trợ giảng AI.',
    );
  }

  // Cập nhật doc_scope nếu người dùng đổi phạm vi tài liệu trên giao diện
  let effectiveScope: number[] | null = Array.isArray(conv.doc_scope)
    ? conv.doc_scope.map(Number)
    : null;
  if (opts.docScope !== undefined) {
    effectiveScope =
      Array.isArray(opts.docScope) && opts.docScope.length > 0
        ? opts.docScope.map(Number).filter((n) => Number.isInteger(n) && n > 0)
        : null;
  }

  // Kiểm tra lớp đã có ít nhất 1 tài liệu 'ready' chưa
  const readyCountRow = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM class_attach_files caf
       JOIN doc_ingestions di ON di.doc_id = caf.doc_id
      WHERE caf.class_id = $1 AND di.status = 'ready'`,
    [classId],
  );
  if (Number(readyCountRow?.cnt ?? 0) === 0) {
    throw new HttpError(
      400,
      'Lớp học hiện chưa có tài liệu nào hoàn tất lập chỉ mục cho AI. Vui lòng đợi hệ thống xử lý xong hoặc đính kèm tài liệu PDF/DOCX/PPTX/TXT.',
    );
  }

  // Lấy 6 lượt hội thoại gần nhất trước khi thêm câu hỏi mới
  const recentRows = await query<{ role: 'user' | 'assistant'; content: string }>(
    `SELECT role, content
       FROM rag_messages
      WHERE conversation_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 6`,
    [opts.conversationId],
  );
  const recentTurns = recentRows.reverse();

  // Lưu tin nhắn của người dùng
  const userMsgRow = await queryOne<{ id: number; created_at: Date }>(
    `INSERT INTO rag_messages (conversation_id, role, content)
     VALUES ($1, 'user', $2)
     RETURNING id, created_at`,
    [opts.conversationId, trimmedQuestion],
  );

  // Tự đặt tiêu đề cuộc trò chuyện theo câu hỏi đầu tiên
  const newTitle =
    conv.title === 'Cuộc trò chuyện mới' || !conv.title.trim()
      ? trimmedQuestion.slice(0, 75) + (trimmedQuestion.length > 75 ? '…' : '')
      : conv.title;

  await query(
    `UPDATE rag_conversations
        SET title = $2,
            doc_scope = $3,
            updated_at = NOW()
      WHERE id = $1`,
    [opts.conversationId, newTitle, effectiveScope],
  );

  opts.sendEvent('meta', {
    conversationId: opts.conversationId,
    title: newTitle,
    userMessageId: Number(userMsgRow!.id),
  });

  // Bước 1: Tạo câu truy vấn tìm kiếm (nếu câu hỏi nối tiếp quá ngắn, ghép thêm câu hỏi liền trước của user)
  let standaloneQuery = trimmedQuestion;
  const lastUserTurn = [...recentTurns].reverse().find((t) => t.role === 'user');
  if (
    lastUserTurn &&
    trimmedQuestion.length < 40 &&
    !/^(chào|xin chào|hello|hi|lô|alo)\b/i.test(trimmedQuestion)
  ) {
    standaloneQuery = `${lastUserTurn.content.slice(0, 120)} ${trimmedQuestion}`;
  }

  let totalTokensIn = 0;
  let totalTokensOut = 0;

  try {
    // Bước 2: Tạo embedding câu truy vấn và tìm kiếm lai (pgvector + FTS OR + RRF)
    const queryEmbedding = await embedText(standaloneQuery);
    let { chunks } = await hybridRetrieveClassChunks({
      classId,
      queryText: standaloneQuery,
      queryEmbedding,
      docScope: effectiveScope,
    });

    // Nếu người dùng đang lọc 1 tài liệu cụ thể mà không có chunk nào, tự động mở rộng ra toàn bộ tài liệu lớp
    if (chunks.length === 0 && effectiveScope && effectiveScope.length > 0) {
      const retryAll = await hybridRetrieveClassChunks({
        classId,
        queryText: standaloneQuery,
        queryEmbedding,
        docScope: null,
      });
      chunks = retryAll.chunks;
    }

    if (chunks.length === 0) {
      const ungroundedReply =
        'Tài liệu lớp học hiện tại chưa có đoạn văn bản nào sẵn sàng. Vui lòng đợi hệ thống lập chỉ mục xong.';
      opts.sendEvent('delta', { text: ungroundedReply });
      opts.sendEvent('citations', { citations: [], grounded: false });

      const latencyMs = Date.now() - startedAt;
      const assistantRow = await queryOne<{ id: number }>(
        `INSERT INTO rag_messages
           (conversation_id, role, content, citations, grounded, tokens_in, tokens_out, latency_ms)
         VALUES ($1, 'assistant', $2, '[]'::jsonb, FALSE, 0, 0, $3)
         RETURNING id`,
        [opts.conversationId, ungroundedReply, latencyMs],
      );

      opts.sendEvent('done', {
        assistantMessageId: Number(assistantRow!.id),
        grounded: false,
        latencyMs,
      });
      return;
    }

    // Bước 3: Gọi Gemini (giống Old backend rag: luôn đưa các đoạn tài liệu tìm được + lịch sử hội thoại cho model phân tích)
    const systemInstruction = buildRagSystemPrompt(conv.class_name, chunks);
    const geminiContents: GeminiContent[] = [
      ...recentTurns.map((t) => ({
        role: (t.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
        parts: [{ text: t.content.slice(0, 1200) }],
      })),
      {
        role: 'user',
        parts: [{ text: trimmedQuestion }],
      },
    ];

    const streamRes = await streamGenerateText({
      systemInstruction,
      contents: geminiContents,
      temperature: 0.25,
      signal: opts.signal,
      onDelta: (deltaText) => {
        opts.sendEvent('delta', { text: deltaText });
      },
    });

    totalTokensIn += streamRes.tokensIn;
    totalTokensOut += streamRes.tokensOut;
    const fullAnswer =
      streamRes.fullText.trim() ||
      'Tài liệu lớp học hiện tại chưa đề cập rõ nội dung này. Bạn vui lòng tham khảo thêm giảng viên.';

    const isUngroundedText = /tài liệu lớp( học)?( hiện tại)? chưa đề cập/i.test(fullAnswer);
    const grounded = !isUngroundedText;
    const citations = grounded ? buildCitationsFromRetrievedChunks(fullAnswer, chunks) : [];

    opts.sendEvent('citations', { citations, grounded });

    const latencyMs = Date.now() - startedAt;
    const assistantRow = await queryOne<{ id: number }>(
      `INSERT INTO rag_messages
         (conversation_id, role, content, citations, grounded, tokens_in, tokens_out, latency_ms)
       VALUES ($1, 'assistant', $2, $3::jsonb, $4, $5, $6, $7)
       RETURNING id`,
      [
        opts.conversationId,
        fullAnswer,
        JSON.stringify(citations),
        grounded,
        totalTokensIn,
        totalTokensOut,
        latencyMs,
      ],
    );

    await logAiUsage({
      userId: opts.userId,
      classId,
      feature: 'chat',
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
    });

    opts.sendEvent('done', {
      assistantMessageId: Number(assistantRow!.id),
      grounded,
      latencyMs,
    });
  } catch (err) {
    // Xóa tin nhắn user mồ côi nếu quá trình gọi AI thất bại giữa chừng (tránh bị lặp bong bóng câu hỏi không có câu trả lời như trên ảnh)
    await query('DELETE FROM rag_messages WHERE id = $1', [userMsgRow!.id]).catch(() => {});
    throw err;
  }
}

export function mapAiErrorToHttp(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof GeminiApiError) {
    if (err.code === 'MISSING_API_KEY') return new HttpError(503, err.message);
    if (err.code === 'RATE_LIMIT' || err.code === 'QUOTA_EXCEEDED') {
      return new HttpError(429, err.message);
    }
    if (err.code === 'TIMEOUT') return new HttpError(504, err.message);
    return new HttpError(502, err.message);
  }
  return new HttpError(500, (err as any)?.message || 'Lỗi máy chủ khi xử lý AI');
}
