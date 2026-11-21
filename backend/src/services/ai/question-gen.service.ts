// src/services/ai/question-gen.service.ts
import { query, queryOne, withTransaction } from '../../config/database.js';
import { HttpError } from '../../utils/http-error.js';
import { normalizeAndValidateQuestionPayload } from '../exam/exam.service.js';
import { cleanDisplayFileName } from './chunker.js';
import {
  embedBatch,
  GeminiApiError,
  generateStructuredJson,
  isGeminiConfigured,
} from './gemini.client.js';
import {
  buildQuestionGenerationSystemPrompt,
  buildQuestionGenerationUserPrompt,
  buildQuestionVerificationPrompt,
  getQuestionGenerationSchema,
  QUESTION_VERIFICATION_SCHEMA,
} from './prompts.js';
import {
  assertQuestionGenQuota,
  logAiUsage,
  MAX_QUESTIONS_PER_JOB,
} from './quota.js';
import {
  cosineSim,
  ensureAiRagTables,
  parsePgVectorLiteral,
  toPgVectorLiteral,
} from './schema.js';
import {
  findDuplicateInClassBank,
  upsertBankQuestionEmbedding,
} from './vector-store.js';

export type AiQuestionType = 'single_choice' | 'multiple_choice' | 'essay';
export type AiDifficulty = 'easy' | 'medium' | 'hard';

export interface DifficultyCounts {
  easy: number;
  medium: number;
  hard: number;
}

export interface DocScopeFilter {
  mode: 'all' | 'heading' | 'pages';
  headings?: string[];
  pageFrom?: number;
  pageTo?: number;
}

export interface NormalizedJobConfig {
  matrix: Record<AiQuestionType, DifficultyCounts>;
  optionCount: 4 | 5;
  chapter: string | null;
  tags: string[];
  pointsByDifficulty: Record<AiDifficulty, number>;
  language: 'vi' | 'en';
  extraInstruction: string | null;
  verify: boolean;
  docScopes: Record<string, DocScopeFilter>;
  totalRequested: number;
}

const cancelledJobIds = new Set<number>();

export function normalizeJobConfig(raw: any): NormalizedJobConfig {
  const clampCount = (v: unknown) => Math.max(0, Math.min(50, Math.floor(Number(v) || 0)));

  const matrix: Record<AiQuestionType, DifficultyCounts> = {
    single_choice: { easy: 0, medium: 0, hard: 0 },
    multiple_choice: { easy: 0, medium: 0, hard: 0 },
    essay: { easy: 0, medium: 0, hard: 0 },
  };

  if (raw?.matrix && typeof raw.matrix === 'object') {
    for (const qt of ['single_choice', 'multiple_choice', 'essay'] as AiQuestionType[]) {
      if (raw.matrix[qt]) {
        matrix[qt] = {
          easy: clampCount(raw.matrix[qt].easy),
          medium: clampCount(raw.matrix[qt].medium),
          hard: clampCount(raw.matrix[qt].hard),
        };
      }
    }
  } else if (raw?.counts) {
    const types: AiQuestionType[] =
      Array.isArray(raw.questionTypes) && raw.questionTypes.length > 0
        ? raw.questionTypes.filter((t: string) =>
            ['single_choice', 'multiple_choice', 'essay'].includes(t),
          )
        : ['single_choice'];
    const primaryType = types[0] || 'single_choice';
    matrix[primaryType] = {
      easy: clampCount(raw.counts.easy),
      medium: clampCount(raw.counts.medium),
      hard: clampCount(raw.counts.hard),
    };
  }

  const totalRequested =
    matrix.single_choice.easy +
    matrix.single_choice.medium +
    matrix.single_choice.hard +
    matrix.multiple_choice.easy +
    matrix.multiple_choice.medium +
    matrix.multiple_choice.hard +
    matrix.essay.easy +
    matrix.essay.medium +
    matrix.essay.hard;

  if (totalRequested <= 0) {
    throw new HttpError(400, 'Vui lòng chọn ít nhất 1 câu hỏi cần tạo.');
  }
  if (totalRequested > MAX_QUESTIONS_PER_JOB) {
    throw new HttpError(
      400,
      `Tổng số câu hỏi mỗi lần tạo tối đa là ${MAX_QUESTIONS_PER_JOB} câu (hiện chọn ${totalRequested} câu).`,
    );
  }

  const optionCount: 4 | 5 = Number(raw?.optionCount) === 5 ? 5 : 4;
  const chapter = raw?.chapter?.trim() ? String(raw.chapter).trim().slice(0, 100) : null;
  const tags = Array.isArray(raw?.tags)
    ? raw.tags.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 10)
    : [];

  const pointsRaw = raw?.pointsByDifficulty ?? raw?.points ?? {};
  const clampPoint = (v: unknown, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= 100 ? Math.round(n * 100) / 100 : def;
  };
  const pointsByDifficulty: Record<AiDifficulty, number> = {
    easy: clampPoint(pointsRaw.easy, 1),
    medium: clampPoint(pointsRaw.medium, 1.5),
    hard: clampPoint(pointsRaw.hard, 2),
  };

  const language: 'vi' | 'en' = raw?.language === 'en' ? 'en' : 'vi';
  const extraInstruction = raw?.extraInstruction?.trim()
    ? String(raw.extraInstruction).trim().slice(0, 600)
    : null;
  const verify = Boolean(raw?.verify);

  const docScopes: Record<string, DocScopeFilter> = {};
  if (raw?.docScopes && typeof raw.docScopes === 'object') {
    for (const [k, v] of Object.entries(raw.docScopes as Record<string, any>)) {
      if (!v || typeof v !== 'object') continue;
      const mode = v.mode === 'heading' || v.mode === 'pages' ? v.mode : 'all';
      docScopes[k] = {
        mode,
        headings: Array.isArray(v.headings) ? v.headings.map(String).filter(Boolean) : undefined,
        pageFrom: v.pageFrom ? Number(v.pageFrom) : undefined,
        pageTo: v.pageTo ? Number(v.pageTo) : undefined,
      };
    }
  }

  return {
    matrix,
    optionCount,
    chapter,
    tags,
    pointsByDifficulty,
    language,
    extraInstruction,
    verify,
    docScopes,
    totalRequested,
  };
}

/** Kiểm tra câu trích dẫn nguồn có thực sự xuất hiện (hoặc trùng từ khóa cao) trong chunk hay không. */
export function verifyQuoteGroundedInChunks(
  sourceQuote: string | null | undefined,
  chunkTexts: string[],
): boolean {
  const quote = (sourceQuote ?? '').trim();
  if (!quote || chunkTexts.length === 0) return false;

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const normQuote = normalize(quote);
  if (normQuote.length < 8) return false;

  const combined = normalize(chunkTexts.join(' '));
  if (combined.includes(normQuote)) return true;

  // Kiểm tra tỷ lệ từ của quote xuất hiện trong chunk (>= 70%)
  const words = normQuote.split(' ').filter((w) => w.length >= 2);
  if (words.length === 0) return false;
  const matched = words.filter((w) => combined.includes(w)).length;
  return matched / words.length >= 0.7;
}

function shuffleOptionsOrder<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Chuẩn hóa và kiểm tra 1 câu hỏi thô do AI sinh ra. */
export function validateAndNormalizeAiDraft(
  rawItem: any,
  expectedType: AiQuestionType,
  availableChunksMap: Map<
    number,
    {
      chunkId: number;
      docId: number;
      fileName: string;
      displayFileName: string;
      heading: string | null;
      pageFrom: number | null;
      pageTo: number | null;
      content: string;
    }
  >,
  fallbackChunks: Array<{
    chunkId: number;
    docId: number;
    fileName: string;
    displayFileName: string;
    heading: string | null;
    pageFrom: number | null;
    pageTo: number | null;
    content: string;
  }>,
  config: NormalizedJobConfig,
) {
  const qType: AiQuestionType =
    rawItem?.questionType === 'single_choice' ||
    rawItem?.questionType === 'multiple_choice' ||
    rawItem?.questionType === 'essay'
      ? rawItem.questionType
      : expectedType;

  const difficulty: AiDifficulty =
    rawItem?.difficulty === 'easy' || rawItem?.difficulty === 'hard'
      ? rawItem.difficulty
      : 'medium';

  const rawOptions = Array.isArray(rawItem?.options)
    ? shuffleOptionsOrder<any>(rawItem.options)
    : [];

  const normalized = normalizeAndValidateQuestionPayload({
    questionType: qType,
    content: rawItem?.content ?? '',
    explanation: rawItem?.explanation ?? null,
    points: config.pointsByDifficulty[difficulty] ?? 1,
    difficulty,
    chapter: config.chapter || rawItem?.chapter || null,
    tags: config.tags,
    options: rawOptions,
  });

  // Với câu tự luận, bắt buộc phải có đáp án mẫu / hướng dẫn chấm trong explanation
  if (normalized.questionType === 'essay' && !normalized.explanation) {
    throw new HttpError(400, 'Câu hỏi tự luận thiếu đáp án mẫu / hướng dẫn chấm');
  }

  const rawChunkIds: number[] = Array.isArray(rawItem?.sourceChunkIds)
    ? rawItem.sourceChunkIds.map(Number).filter((id: number) => availableChunksMap.has(id))
    : [];

  const matchedChunks =
    rawChunkIds.length > 0
      ? rawChunkIds.map((id) => availableChunksMap.get(id)!).filter(Boolean)
      : fallbackChunks.slice(0, 1);

  const primaryChunk = matchedChunks[0] ?? fallbackChunks[0] ?? null;
  const sourceQuote = String(rawItem?.sourceQuote ?? '').trim().slice(0, 400) || null;

  const qualityFlags: string[] = [];
  const isGrounded = verifyQuoteGroundedInChunks(
    sourceQuote,
    matchedChunks.map((c) => c.content),
  );
  if (!isGrounded || rawChunkIds.length === 0) {
    qualityFlags.push('ungrounded');
  }

  return {
    questionType: normalized.questionType as AiQuestionType,
    difficulty: normalized.difficulty as AiDifficulty,
    content: normalized.content,
    options: normalized.options,
    explanation: normalized.explanation,
    chapter: normalized.chapter || primaryChunk?.heading || null,
    tags: normalized.tags,
    defaultPoints: normalized.points,
    sourceChunkIds: matchedChunks.map((c) => c.chunkId),
    sourceDocId: primaryChunk?.docId ?? null,
    sourceFileName: primaryChunk?.displayFileName ?? null,
    sourcePageFrom: primaryChunk?.pageFrom ?? null,
    sourcePageTo: primaryChunk?.pageTo ?? null,
    sourceQuote,
    qualityFlags,
  };
}

/** Lazy embed các câu hỏi cũ trong ngân hàng chưa có vector để chống trùng chính xác. */
export async function ensureClassBankEmbeddings(
  classId: number,
  lecturerId: number,
): Promise<void> {
  await ensureAiRagTables();
  if (!isGeminiConfigured()) return;

  const missingRows = await query<{ id: number; content: string }>(
    `SELECT bq.id, bq.content
       FROM bank_questions bq
       LEFT JOIN bank_question_embeddings bqe ON bqe.bank_question_id = bq.id
      WHERE bq.class_id = $1 AND bqe.bank_question_id IS NULL
      ORDER BY bq.id ASC
      LIMIT 120`,
    [classId],
  );
  if (missingRows.length === 0) return;

  try {
    const { embeddings, tokensIn } = await embedBatch(
      missingRows.map((r) => r.content),
      'SEMANTIC_SIMILARITY',
    );
    for (let i = 0; i < missingRows.length; i++) {
      await upsertBankQuestionEmbedding(missingRows[i].id, classId, embeddings[i]);
    }
    await logAiUsage({
      userId: lecturerId,
      classId,
      feature: 'embed',
      tokensIn,
      tokensOut: 0,
    });
  } catch (err: any) {
    console.warn('[ai-qgen] Không thể lazy-embed ngân hàng câu hỏi cũ:', err?.message);
  }
}

async function ensureLecturerCanManageClassAi(classId: number, lecturerId: number) {
  const row = await queryOne(
    `SELECT 1
       FROM classes c
       LEFT JOIN class_collaborators cc ON cc.class_id = c.id
      WHERE c.id = $1 AND (c.lecturer_id = $2 OR cc.lecturer_id = $2)
      LIMIT 1`,
    [classId, lecturerId],
  );
  if (!row) {
    throw new HttpError(403, 'Bạn không có quyền quản lý ngân hàng câu hỏi của lớp này');
  }
}

/** Khởi tạo job sinh câu hỏi bằng AI và chạy bất đồng bộ ở nền. */
export async function createQuestionGenerationJob(
  classId: number,
  lecturerId: number,
  rawBody: any,
) {
  await ensureAiRagTables();
  await ensureLecturerCanManageClassAi(classId, lecturerId);
  await assertQuestionGenQuota(lecturerId, classId);

  if (!isGeminiConfigured()) {
    throw new HttpError(
      503,
      'Chưa cấu hình GEMINI_API_KEY trong backend/.env. Vui lòng thêm khóa API Gemini trước khi tạo câu hỏi bằng AI.',
    );
  }

  const docIds: number[] = Array.isArray(rawBody?.docIds)
    ? Array.from(
        new Set(rawBody.docIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)),
      )
    : [];

  if (docIds.length === 0) {
    throw new HttpError(400, 'Vui lòng chọn ít nhất 1 tài liệu nguồn đã sẵn sàng.');
  }

  const readyDocs = await query<{ doc_id: number }>(
    `SELECT caf.doc_id
       FROM class_attach_files caf
       JOIN doc_ingestions di ON di.doc_id = caf.doc_id
      WHERE caf.class_id = $1
        AND caf.doc_id = ANY($2::int[])
        AND di.status = 'ready'`,
    [classId, docIds],
  );
  if (readyDocs.length === 0) {
    throw new HttpError(
      400,
      'Các tài liệu đã chọn chưa hoàn tất lập chỉ mục. Vui lòng đợi trạng thái chuyển sang "Sẵn sàng".',
    );
  }

  const validDocIds = readyDocs.map((r) => Number(r.doc_id));
  const config = normalizeJobConfig(rawBody?.config ?? rawBody);

  const created = await queryOne<{ id: number }>(
    `INSERT INTO ai_generation_jobs (class_id, lecturer_id, doc_ids, config, status, progress)
     VALUES ($1, $2, $3, $4::jsonb, 'queued', 0)
     RETURNING id`,
    [classId, lecturerId, validDocIds, JSON.stringify(config)],
  );

  const jobId = Number(created!.id);

  // Chạy bất đồng bộ trong tiến trình
  setImmediate(() => {
    void executeQuestionGenerationJob(jobId).catch((err) => {
      console.error(`[ai-qgen] Lỗi khi chạy job #${jobId}:`, err);
    });
  });

  return getQuestionJobDetails(jobId, lecturerId);
}

interface ContextChunkRow {
  chunkId: number;
  docId: number;
  fileName: string;
  displayFileName: string;
  chunkIndex: number;
  heading: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  content: string;
}

async function loadFilteredChunksForJob(
  docIds: number[],
  docScopes: Record<string, DocScopeFilter>,
): Promise<ContextChunkRow[]> {
  const rows = await query<any>(
    `SELECT dc.id AS chunk_id,
            dc.doc_id,
            d.file_name,
            dc.chunk_index,
            dc.heading,
            dc.page_from,
            dc.page_to,
            dc.content
       FROM doc_chunks dc
       JOIN docs d ON d.id = dc.doc_id
      WHERE dc.doc_id = ANY($1::int[])
      ORDER BY dc.doc_id ASC, dc.chunk_index ASC`,
    [docIds],
  );

  const all = rows.map((r) => ({
    chunkId: Number(r.chunk_id),
    docId: Number(r.doc_id),
    fileName: String(r.file_name),
    displayFileName: cleanDisplayFileName(String(r.file_name)),
    chunkIndex: Number(r.chunk_index),
    heading: r.heading ?? null,
    pageFrom: r.page_from !== null ? Number(r.page_from) : null,
    pageTo: r.page_to !== null ? Number(r.page_to) : null,
    content: String(r.content),
  }));

  const filtered = all.filter((c) => {
    const scope = docScopes[String(c.docId)];
    if (!scope || scope.mode === 'all') return true;
    if (scope.mode === 'heading' && Array.isArray(scope.headings) && scope.headings.length > 0) {
      return c.heading !== null && scope.headings.includes(c.heading);
    }
    if (scope.mode === 'pages') {
      const from = scope.pageFrom ?? 1;
      const to = scope.pageTo ?? 9999;
      const pFrom = c.pageFrom ?? 1;
      const pTo = c.pageTo ?? pFrom;
      return pTo >= from && pFrom <= to;
    }
    return true;
  });

  return filtered.length > 0 ? filtered : all;
}

/** Chia đều danh sách chunk thành các nhóm trải rộng khắp tài liệu để không dồn câu hỏi vào đầu file. */
function buildDistributedChunkGroups(
  chunks: ContextChunkRow[],
  groupCount: number,
  chunksPerGroup = 6,
): ContextChunkRow[][] {
  if (chunks.length === 0) return [];
  const groups: ContextChunkRow[][] = [];
  const total = chunks.length;

  for (let g = 0; g < groupCount; g++) {
    if (total <= chunksPerGroup) {
      groups.push(chunks);
      continue;
    }
    const startRatio = groupCount > 1 ? g / groupCount : 0;
    const startIdx = Math.floor(startRatio * Math.max(1, total - chunksPerGroup));
    const slice = chunks.slice(startIdx, startIdx + chunksPerGroup);
    groups.push(slice);
  }
  return groups;
}

interface BatchSpec {
  questionType: AiQuestionType;
  counts: DifficultyCounts;
}

function splitConfigIntoBatches(config: NormalizedJobConfig, maxPerBatch = 8): BatchSpec[] {
  const batches: BatchSpec[] = [];
  for (const qt of ['single_choice', 'multiple_choice', 'essay'] as AiQuestionType[]) {
    let remEasy = config.matrix[qt].easy;
    let remMed = config.matrix[qt].medium;
    let remHard = config.matrix[qt].hard;

    while (remEasy + remMed + remHard > 0) {
      let takeEasy = Math.min(remEasy, maxPerBatch);
      let left = maxPerBatch - takeEasy;
      let takeMed = Math.min(remMed, left);
      left -= takeMed;
      let takeHard = Math.min(remHard, left);

      batches.push({
        questionType: qt,
        counts: { easy: takeEasy, medium: takeMed, hard: takeHard },
      });

      remEasy -= takeEasy;
      remMed -= takeMed;
      remHard -= takeHard;
    }
  }
  return batches;
}

async function executeQuestionGenerationJob(jobId: number): Promise<void> {
  const job = await queryOne<any>('SELECT * FROM ai_generation_jobs WHERE id = $1', [jobId]);
  if (!job || job.status === 'cancelled') return;

  const classId = Number(job.class_id);
  const lecturerId = Number(job.lecturer_id);
  const docIds: number[] = Array.isArray(job.doc_ids) ? job.doc_ids.map(Number) : [];
  const config = normalizeJobConfig(job.config);

  await query(
    `UPDATE ai_generation_jobs SET status = 'running', progress = 5 WHERE id = $1`,
    [jobId],
  );

  let totalTokensIn = 0;
  let totalTokensOut = 0;

  try {
    await ensureClassBankEmbeddings(classId, lecturerId);

    const chunks = await loadFilteredChunksForJob(docIds, config.docScopes);
    if (chunks.length === 0) {
      throw new Error('Không tìm thấy đoạn văn bản nào trong phạm vi tài liệu đã chọn.');
    }

    const chunksMap = new Map(chunks.map((c) => [c.chunkId, c]));
    const existingBankRows = await query<{ content: string }>(
      `SELECT content FROM bank_questions WHERE class_id = $1 ORDER BY id DESC LIMIT 20`,
      [classId],
    );
    const avoidContents = existingBankRows.map((r) => r.content);

    const batches = splitConfigIntoBatches(config, 8);
    const chunkGroups = buildDistributedChunkGroups(chunks, Math.max(1, batches.length), 7);

    const savedEmbeddingsInJob: Array<{ draftId: number; content: string; embedding: number[] }> = [];
    const systemPrompt = buildQuestionGenerationSystemPrompt(config.language);
    const schema = getQuestionGenerationSchema();

    for (let bIdx = 0; bIdx < batches.length; bIdx++) {
      if (cancelledJobIds.has(jobId)) {
        cancelledJobIds.delete(jobId);
        await query(
          `UPDATE ai_generation_jobs SET status = 'cancelled', finished_at = NOW() WHERE id = $1`,
          [jobId],
        );
        return;
      }

      const batch = batches[bIdx];
      const groupChunks = chunkGroups[bIdx % chunkGroups.length] || chunks.slice(0, 6);

      const userPrompt = buildQuestionGenerationUserPrompt({
        questionType: batch.questionType,
        counts: batch.counts,
        optionCount: config.optionCount,
        chapter: config.chapter,
        language: config.language,
        extraInstruction: config.extraInstruction,
        chunks: groupChunks,
        avoidContents,
      });

      const genRes = await generateStructuredJson<{ questions: any[] }>({
        systemInstruction: systemPrompt,
        prompt: userPrompt,
        responseSchema: schema,
        temperature: 0.4,
        thinkingBudget: 1024,
        timeoutMs: 90_000,
      });

      totalTokensIn += genRes.tokensIn;
      totalTokensOut += genRes.tokensOut;

      const rawQuestions = Array.isArray(genRes.data?.questions) ? genRes.data.questions : [];
      const validDrafts: ReturnType<typeof validateAndNormalizeAiDraft>[] = [];

      for (const rawQ of rawQuestions) {
        try {
          const normalizedDraft = validateAndNormalizeAiDraft(
            rawQ,
            batch.questionType,
            chunksMap,
            groupChunks,
            config,
          );
          validDrafts.push(normalizedDraft);
          avoidContents.unshift(normalizedDraft.content);
        } catch {
          // Bỏ qua câu không đạt chuẩn schema
        }
      }

      if (validDrafts.length > 0) {
        // Kiểm tra chéo đáp án (nếu GV bật verify và là câu trắc nghiệm)
        const verifyNotes = new Map<number, { failed: boolean; note: string }>();
        if (config.verify && batch.questionType !== 'essay') {
          try {
            const verifyItems = validDrafts.map((d, idx) => {
              const ctxText = d.sourceChunkIds
                .map((cid) => chunksMap.get(cid)?.content || '')
                .join('\n');
              return {
                index: idx,
                questionType: d.questionType,
                content: d.content,
                options: d.options,
                contextText: ctxText || groupChunks.map((c) => c.content).join('\n'),
              };
            });

            const verRes = await generateStructuredJson<{
              results: Array<{
                index: number;
                correctOptionIndices: number[];
                isGrounded: boolean;
                note: string;
              }>;
            }>({
              prompt: buildQuestionVerificationPrompt(verifyItems),
              responseSchema: QUESTION_VERIFICATION_SCHEMA,
              temperature: 0.1,
              thinkingBudget: 512,
              timeoutMs: 45_000,
            });
            totalTokensIn += verRes.tokensIn;
            totalTokensOut += verRes.tokensOut;

            for (const r of verRes.data?.results ?? []) {
              const draft = validDrafts[r.index];
              if (!draft) continue;
              const expectedCorrect = draft.options
                .map((o, i) => (o.isCorrect ? i : -1))
                .filter((i) => i >= 0);
              const verCorrect = (r.correctOptionIndices ?? []).sort((a, b) => a - b);
              const sameAnswer =
                expectedCorrect.length === verCorrect.length &&
                expectedCorrect.every((val, idx) => val === verCorrect[idx]);
              if (!sameAnswer || !r.isGrounded) {
                const verLetters = verCorrect
                  .map((i) => String.fromCharCode(65 + i))
                  .join(', ');
                verifyNotes.set(r.index, {
                  failed: true,
                  note: !sameAnswer
                    ? `Kiểm tra chéo gợi ý đáp án ${verLetters || 'khác'} (${r.note || 'cần xem lại'})`
                    : r.note || 'Ngữ cảnh chưa đủ rõ',
                });
              }
            }
          } catch {
            // Không chặn luồng chính nếu bước kiểm tra chéo phụ gặp lỗi
          }
        }

        // Tạo embedding cho các câu hỏi vừa sinh để chống trùng bằng pgvector
        let draftEmbeddings: number[][] = [];
        try {
          const embRes = await embedBatch(
            validDrafts.map((d) => d.content),
            'SEMANTIC_SIMILARITY',
          );
          draftEmbeddings = embRes.embeddings;
          totalTokensIn += embRes.tokensIn;
        } catch {
          // Tiếp tục nếu lỗi tạm thời
        }

        for (let i = 0; i < validDrafts.length; i++) {
          const d = validDrafts[i];
          const emb = draftEmbeddings[i] ?? null;
          const flags = new Set<string>(d.qualityFlags);
          let duplicateOf: number | null = null;
          let duplicateContent: string | null = null;
          let verifyNote: string | null = null;

          const verInfo = verifyNotes.get(i);
          if (verInfo?.failed) {
            flags.add('verify_failed');
            verifyNote = verInfo.note;
          }

          if (emb) {
            // 1. So với ngân hàng câu hỏi của lớp qua pgvector
            const bankDup = await findDuplicateInClassBank(classId, emb, 0.88);
            if (bankDup) {
              flags.add('duplicate_bank');
              duplicateOf = bankDup.bankQuestionId;
              duplicateContent = bankDup.content;
            }
            // 2. So với các câu vừa sinh trước đó trong cùng job
            for (const prev of savedEmbeddingsInJob) {
              if (cosineSim(emb, prev.embedding) >= 0.88) {
                flags.add('duplicate_batch');
                if (!duplicateContent) duplicateContent = prev.content;
                break;
              }
            }
          }

          const vecLiteral = emb ? toPgVectorLiteral(emb) : null;
          const inserted = await queryOne<{ id: number }>(
            `INSERT INTO ai_question_drafts (
               job_id, class_id, question_type, difficulty, content, options,
               explanation, chapter, tags, default_points, source_chunk_ids,
               source_doc_id, source_file_name, source_page_from, source_page_to,
               source_quote, content_embedding, quality_flags,
               duplicate_of, duplicate_content, verify_note, status
             )
             VALUES (
               $1, $2, $3, $4, $5, $6::jsonb,
               $7, $8, $9, $10, $11,
               $12, $13, $14, $15,
               $16, $17::vector(768), $18,
               $19, $20, $21, 'draft'
             )
             RETURNING id`,
            [
              jobId,
              classId,
              d.questionType,
              d.difficulty,
              d.content,
              JSON.stringify(d.options),
              d.explanation,
              d.chapter,
              d.tags,
              d.defaultPoints,
              d.sourceChunkIds,
              d.sourceDocId,
              d.sourceFileName,
              d.sourcePageFrom,
              d.sourcePageTo,
              d.sourceQuote,
              vecLiteral,
              Array.from(flags),
              duplicateOf,
              duplicateContent,
              verifyNote,
            ],
          );

          if (emb && inserted) {
            savedEmbeddingsInJob.push({
              draftId: Number(inserted.id),
              content: d.content,
              embedding: emb,
            });
          }
        }
      }

      const progress = Math.min(95, Math.round(((bIdx + 1) / batches.length) * 90) + 5);
      await query(
        `UPDATE ai_generation_jobs
            SET progress = $2,
                tokens_in = $3,
                tokens_out = $4
          WHERE id = $1`,
        [jobId, progress, totalTokensIn, totalTokensOut],
      );
    }

    await query(
      `UPDATE ai_generation_jobs
          SET status = 'done',
              progress = 100,
              tokens_in = $2,
              tokens_out = $3,
              finished_at = NOW()
        WHERE id = $1`,
      [jobId, totalTokensIn, totalTokensOut],
    );

    await logAiUsage({
      userId: lecturerId,
      classId,
      feature: 'generate',
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
    });
  } catch (err: any) {
    const msg =
      err instanceof GeminiApiError
        ? err.message
        : err?.message || 'Lỗi không xác định khi tạo câu hỏi bằng AI';
    await query(
      `UPDATE ai_generation_jobs
          SET status = 'failed',
              error_message = $2,
              tokens_in = $3,
              tokens_out = $4,
              finished_at = NOW()
        WHERE id = $1`,
      [jobId, msg, totalTokensIn, totalTokensOut],
    );
  }
}

function formatDraftRow(r: any) {
  return {
    id: Number(r.id),
    jobId: Number(r.job_id),
    classId: Number(r.class_id),
    questionType: r.question_type as AiQuestionType,
    difficulty: r.difficulty as AiDifficulty,
    content: String(r.content),
    options: Array.isArray(r.options)
      ? r.options.map((o: any) => ({
          content: String(o.content ?? ''),
          isCorrect: Boolean(o.isCorrect ?? o.is_correct),
        }))
      : [],
    explanation: r.explanation ?? null,
    chapter: r.chapter ?? null,
    tags: Array.isArray(r.tags) ? r.tags : [],
    defaultPoints: Number(r.default_points ?? 1),
    sourceChunkIds: Array.isArray(r.source_chunk_ids) ? r.source_chunk_ids.map(Number) : [],
    sourceDocId: r.source_doc_id !== null ? Number(r.source_doc_id) : null,
    sourceFileName: r.source_file_name ?? null,
    sourcePageFrom: r.source_page_from !== null ? Number(r.source_page_from) : null,
    sourcePageTo: r.source_page_to !== null ? Number(r.source_page_to) : null,
    sourceQuote: r.source_quote ?? null,
    qualityFlags: Array.isArray(r.quality_flags) ? r.quality_flags : [],
    duplicateOf: r.duplicate_of !== null ? Number(r.duplicate_of) : null,
    duplicateContent: r.duplicate_content ?? null,
    verifyNote: r.verify_note ?? null,
    status: r.status as 'draft' | 'accepted' | 'discarded',
    bankQuestionId: r.bank_question_id !== null ? Number(r.bank_question_id) : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function getQuestionJobDetails(jobId: number, lecturerId: number) {
  await ensureAiRagTables();
  const job = await queryOne<any>('SELECT * FROM ai_generation_jobs WHERE id = $1', [jobId]);
  if (!job) throw new HttpError(404, 'Không tìm thấy phiên tạo câu hỏi AI');

  await ensureLecturerCanManageClassAi(Number(job.class_id), lecturerId);

  const drafts = await query<any>(
    `SELECT * FROM ai_question_drafts WHERE job_id = $1 ORDER BY id ASC`,
    [jobId],
  );

  return {
    id: Number(job.id),
    classId: Number(job.class_id),
    lecturerId: Number(job.lecturer_id),
    docIds: Array.isArray(job.doc_ids) ? job.doc_ids.map(Number) : [],
    config: job.config,
    status: job.status as 'queued' | 'running' | 'done' | 'failed' | 'cancelled',
    progress: Number(job.progress ?? 0),
    errorMessage: job.error_message ?? null,
    tokensIn: Number(job.tokens_in ?? 0),
    tokensOut: Number(job.tokens_out ?? 0),
    createdAt: new Date(job.created_at).toISOString(),
    finishedAt: job.finished_at ? new Date(job.finished_at).toISOString() : null,
    drafts: drafts.map(formatDraftRow),
  };
}

export async function listClassQuestionJobs(classId: number, lecturerId: number) {
  await ensureAiRagTables();
  await ensureLecturerCanManageClassAi(classId, lecturerId);

  const rows = await query<any>(
    `SELECT j.*,
            COUNT(d.id)::int AS total_drafts,
            COUNT(d.id) FILTER (WHERE d.status = 'draft')::int AS pending_drafts,
            COUNT(d.id) FILTER (WHERE d.status = 'accepted')::int AS accepted_drafts
       FROM ai_generation_jobs j
       LEFT JOIN ai_question_drafts d ON d.job_id = j.id
      WHERE j.class_id = $1
      GROUP BY j.id
      ORDER BY j.created_at DESC
      LIMIT 20`,
    [classId],
  );

  return rows.map((r) => ({
    id: Number(r.id),
    classId: Number(r.class_id),
    status: r.status as 'queued' | 'running' | 'done' | 'failed' | 'cancelled',
    progress: Number(r.progress ?? 0),
    errorMessage: r.error_message ?? null,
    config: r.config,
    totalDrafts: Number(r.total_drafts ?? 0),
    pendingDrafts: Number(r.pending_drafts ?? 0),
    acceptedDrafts: Number(r.accepted_drafts ?? 0),
    createdAt: new Date(r.created_at).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  }));
}

export async function cancelQuestionJob(jobId: number, lecturerId: number) {
  await ensureAiRagTables();
  const job = await queryOne<any>('SELECT * FROM ai_generation_jobs WHERE id = $1', [jobId]);
  if (!job) throw new HttpError(404, 'Không tìm thấy tiến trình');
  await ensureLecturerCanManageClassAi(Number(job.class_id), lecturerId);

  cancelledJobIds.add(jobId);
  await query(
    `UPDATE ai_generation_jobs
        SET status = 'cancelled',
            finished_at = COALESCE(finished_at, NOW())
      WHERE id = $1 AND status IN ('queued', 'running')`,
    [jobId],
  );
  return getQuestionJobDetails(jobId, lecturerId);
}

async function ensureDraftAccess(draftId: number, lecturerId: number) {
  await ensureAiRagTables();
  const draft = await queryOne<any>('SELECT * FROM ai_question_drafts WHERE id = $1', [draftId]);
  if (!draft) throw new HttpError(404, 'Không tìm thấy bản nháp câu hỏi');
  await ensureLecturerCanManageClassAi(Number(draft.class_id), lecturerId);
  return draft;
}

export async function updateQuestionDraft(
  draftId: number,
  lecturerId: number,
  input: {
    questionType?: AiQuestionType;
    difficulty?: AiDifficulty;
    content?: string;
    explanation?: string | null;
    chapter?: string | null;
    tags?: string[];
    defaultPoints?: number;
    options?: Array<{ content: string; isCorrect?: boolean; is_correct?: boolean }>;
  },
) {
  const existing = await ensureDraftAccess(draftId, lecturerId);
  const normalized = normalizeAndValidateQuestionPayload({
    questionType: input.questionType ?? existing.question_type,
    content: input.content ?? existing.content,
    explanation: input.explanation !== undefined ? input.explanation : existing.explanation,
    points: input.defaultPoints ?? Number(existing.default_points ?? 1),
    difficulty: input.difficulty ?? existing.difficulty,
    chapter: input.chapter !== undefined ? input.chapter : existing.chapter,
    tags: input.tags ?? existing.tags,
    options: input.options ?? existing.options,
  });

  // Sau khi giảng viên chủ động sửa tay, gỡ cờ verify_failed
  const updatedFlags = (existing.quality_flags || []).filter(
    (f: string) => f !== 'verify_failed',
  );

  const row = await queryOne<any>(
    `UPDATE ai_question_drafts
        SET question_type = $2,
            difficulty = $3,
            content = $4,
            options = $5::jsonb,
            explanation = $6,
            chapter = $7,
            tags = $8,
            default_points = $9,
            quality_flags = $10,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [
      draftId,
      normalized.questionType,
      normalized.difficulty,
      normalized.content,
      JSON.stringify(normalized.options),
      normalized.explanation,
      normalized.chapter,
      normalized.tags,
      normalized.points,
      updatedFlags,
    ],
  );
  return formatDraftRow(row);
}

/** Sinh lại 1 bản nháp câu hỏi với cùng loại, độ khó và ngữ cảnh tài liệu. */
export async function regenerateSingleDraft(draftId: number, lecturerId: number) {
  const draft = await ensureDraftAccess(draftId, lecturerId);
  const job = await queryOne<any>('SELECT * FROM ai_generation_jobs WHERE id = $1', [
    draft.job_id,
  ]);
  if (!job) throw new HttpError(404, 'Không tìm thấy job gốc');

  const config = normalizeJobConfig(job.config);
  const chunkIds: number[] = Array.isArray(draft.source_chunk_ids)
    ? draft.source_chunk_ids.map(Number)
    : [];

  let chunks = await loadFilteredChunksForJob(
    Array.isArray(job.doc_ids) ? job.doc_ids.map(Number) : [],
    config.docScopes,
  );
  const chunksMap = new Map(chunks.map((c) => [c.chunkId, c]));

  let targetChunks = chunkIds.map((id) => chunksMap.get(id)!).filter(Boolean);
  if (targetChunks.length === 0) {
    targetChunks = chunks.slice(0, 5);
  }

  const qType = draft.question_type as AiQuestionType;
  const diff = draft.difficulty as AiDifficulty;
  const counts: DifficultyCounts = {
    easy: diff === 'easy' ? 1 : 0,
    medium: diff === 'medium' ? 1 : 0,
    hard: diff === 'hard' ? 1 : 0,
  };

  const userPrompt = buildQuestionGenerationUserPrompt({
    questionType: qType,
    counts,
    optionCount: config.optionCount,
    chapter: draft.chapter || config.chapter,
    language: config.language,
    extraInstruction: config.extraInstruction,
    chunks: targetChunks,
    avoidContents: [draft.content],
  });

  const genRes = await generateStructuredJson<{ questions: any[] }>({
    systemInstruction: buildQuestionGenerationSystemPrompt(config.language),
    prompt: userPrompt,
    responseSchema: getQuestionGenerationSchema(),
    temperature: 0.55,
    thinkingBudget: 512,
    timeoutMs: 45_000,
  });

  await logAiUsage({
    userId: lecturerId,
    classId: Number(draft.class_id),
    feature: 'generate',
    tokensIn: genRes.tokensIn,
    tokensOut: genRes.tokensOut,
  });

  const rawQ = genRes.data?.questions?.[0];
  if (!rawQ) {
    throw new HttpError(502, 'AI không trả về câu hỏi thay thế hợp lệ. Vui lòng thử lại.');
  }

  const normalizedDraft = validateAndNormalizeAiDraft(
    rawQ,
    qType,
    chunksMap,
    targetChunks,
    config,
  );

  const updated = await queryOne<any>(
    `UPDATE ai_question_drafts
        SET content = $2,
            options = $3::jsonb,
            explanation = $4,
            chapter = $5,
            source_chunk_ids = $6,
            source_doc_id = $7,
            source_file_name = $8,
            source_page_from = $9,
            source_page_to = $10,
            source_quote = $11,
            quality_flags = $12,
            duplicate_of = NULL,
            duplicate_content = NULL,
            verify_note = NULL,
            status = 'draft',
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [
      draftId,
      normalizedDraft.content,
      JSON.stringify(normalizedDraft.options),
      normalizedDraft.explanation,
      normalizedDraft.chapter,
      normalizedDraft.sourceChunkIds,
      normalizedDraft.sourceDocId,
      normalizedDraft.sourceFileName,
      normalizedDraft.sourcePageFrom,
      normalizedDraft.sourcePageTo,
      normalizedDraft.sourceQuote,
      normalizedDraft.qualityFlags,
    ],
  );

  return formatDraftRow(updated);
}

/** Chấp nhận danh sách bản nháp và thêm chính thức vào bank_questions của lớp. */
export async function acceptQuestionDrafts(lecturerId: number, draftIds: number[]) {
  await ensureAiRagTables();
  if (!Array.isArray(draftIds) || draftIds.length === 0) {
    throw new HttpError(400, 'Vui lòng chọn ít nhất 1 bản nháp câu hỏi để thêm vào ngân hàng.');
  }
  const cleanIds = Array.from(
    new Set(draftIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)),
  );

  const drafts = await query<any>(
    `SELECT * FROM ai_question_drafts WHERE id = ANY($1::int[]) ORDER BY id ASC`,
    [cleanIds],
  );
  if (drafts.length === 0) {
    throw new HttpError(404, 'Không tìm thấy bản nháp câu hỏi đã chọn.');
  }

  const classIds = Array.from(new Set(drafts.map((d) => Number(d.class_id))));
  for (const cid of classIds) {
    await ensureLecturerCanManageClassAi(cid, lecturerId);
  }

  const createdBankIds = await withTransaction(async (client) => {
    const ids: number[] = [];
    for (const d of drafts) {
      if (d.status === 'accepted' && d.bank_question_id) {
        ids.push(Number(d.bank_question_id));
        continue;
      }

      const rawOptions = Array.isArray(d.options) ? d.options : [];
      const normalized = normalizeAndValidateQuestionPayload({
        questionType: d.question_type,
        content: d.content,
        explanation: d.explanation,
        points: Number(d.default_points ?? 1),
        difficulty: d.difficulty,
        chapter: d.chapter,
        tags: Array.isArray(d.tags) ? d.tags : [],
        options: rawOptions,
      });

      const sourceDocIds = d.source_doc_id ? [Number(d.source_doc_id)] : [];

      const qRes = await client.query(
        `INSERT INTO bank_questions
           (class_id, created_by, question_type, content, explanation, default_points,
            difficulty, chapter, tags, source, ai_draft_id, source_doc_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ai', $10, $11)
         RETURNING id`,
        [
          Number(d.class_id),
          lecturerId,
          normalized.questionType,
          normalized.content,
          normalized.explanation,
          normalized.points,
          normalized.difficulty,
          normalized.chapter,
          normalized.tags,
          Number(d.id),
          sourceDocIds,
        ],
      );
      const bankQuestionId = Number(qRes.rows[0].id);

      if (normalized.options.length > 0) {
        const values: any[] = [];
        const placeholders = normalized.options.map((opt, idx) => {
          values.push(bankQuestionId, opt.content, opt.isCorrect, idx);
          const base = idx * 4;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
        });
        await client.query(
          `INSERT INTO bank_question_options (question_id, content, is_correct, position)
           VALUES ${placeholders.join(',')}`,
          values,
        );
      }

      const parsedVec = parsePgVectorLiteral(d.content_embedding);
      if (parsedVec && parsedVec.length === 768) {
        await client.query(
          `INSERT INTO bank_question_embeddings (bank_question_id, class_id, embedding)
           VALUES ($1, $2, $3::vector(768))
           ON CONFLICT (bank_question_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
          [bankQuestionId, Number(d.class_id), toPgVectorLiteral(parsedVec)],
        );
      }

      await client.query(
        `UPDATE ai_question_drafts
            SET status = 'accepted',
                bank_question_id = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [Number(d.id), bankQuestionId],
      );

      ids.push(bankQuestionId);
    }
    return ids;
  });

  return {
    acceptedCount: createdBankIds.length,
    bankQuestionIds: createdBankIds,
  };
}

export async function discardQuestionDrafts(lecturerId: number, draftIds: number[]) {
  await ensureAiRagTables();
  if (!Array.isArray(draftIds) || draftIds.length === 0) {
    throw new HttpError(400, 'Vui lòng chọn ít nhất 1 bản nháp để loại bỏ.');
  }
  const cleanIds = Array.from(
    new Set(draftIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)),
  );
  const drafts = await query<any>(
    `SELECT id, class_id FROM ai_question_drafts WHERE id = ANY($1::int[])`,
    [cleanIds],
  );
  const classIds = Array.from(new Set(drafts.map((d) => Number(d.class_id))));
  for (const cid of classIds) {
    await ensureLecturerCanManageClassAi(cid, lecturerId);
  }

  await query(
    `UPDATE ai_question_drafts
        SET status = 'discarded',
            updated_at = NOW()
      WHERE id = ANY($1::int[]) AND status = 'draft'`,
    [cleanIds],
  );
  return { discardedCount: cleanIds.length };
}
