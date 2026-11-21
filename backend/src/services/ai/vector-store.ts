// src/services/ai/vector-store.ts
import type { PoolClient } from 'pg';
import { query, queryOne } from '../../config/database.js';
import { cleanDisplayFileName, type DocumentChunk } from './chunker.js';
import { ensureAiRagTables, toPgVectorLiteral } from './schema.js';

export interface RetrievedChunk {
  chunkId: number;
  docId: number;
  fileName: string;
  displayFileName: string;
  chunkIndex: number;
  heading: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  content: string;
  tokenCount: number;
  vectorSim: number;
  ftsScore: number;
  rrfScore: number;
}

const VIETNAMESE_STOPWORDS = new Set([
  'la', 'là', 'gi', 'gì', 'va', 'và', 'cua', 'của', 'co', 'có', 'nhung', 'những',
  'cac', 'các', 'mot', 'một', 'trong', 'cho', 'voi', 'với', 'duoc', 'được', 'the',
  'thế', 'nao', 'nào', 'nhu', 'như', 'khi', 'hay', 'hãy', 've', 'về', 'tai', 'tại',
]);

/** Tạo chuỗi truy vấn OR ('tu1 | tu2 | tu3') an toàn cho to_tsquery('simple', ...) */
export function buildOrTsQueryString(rawQuery: string): string | null {
  const words = (rawQuery || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !VIETNAMESE_STOPWORDS.has(w));

  const unique = Array.from(new Set(words)).slice(0, 16);
  if (unique.length === 0) return null;
  return unique.join(' | ');
}

/** Ghi đè toàn bộ chunk + vector(768) của 1 tài liệu trong transaction. */
export async function replaceDocumentChunks(
  client: PoolClient,
  docId: number,
  chunks: DocumentChunk[],
  embeddings: number[][],
): Promise<void> {
  await client.query('DELETE FROM doc_chunks WHERE doc_id = $1', [docId]);
  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i];
    const vecLiteral = toPgVectorLiteral(embeddings[i]);
    await client.query(
      `INSERT INTO doc_chunks
         (doc_id, chunk_index, heading, page_from, page_to, content, token_count, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector(768))`,
      [
        docId,
        ch.chunkIndex,
        ch.heading,
        ch.pageFrom,
        ch.pageTo,
        ch.content,
        ch.tokenCount,
        vecLiteral,
      ],
    );
  }
}

/**
 * Thuật toán Reciprocal Rank Fusion (RRF) kết hợp kết quả Vector Search + Full-Text Search,
 * đồng thời giới hạn số chunk tối đa của 1 tài liệu khi có nhiều tài liệu cùng khớp.
 */
export function mergeHybridResultsRRF(
  vectorHits: Array<{
    chunkId: number;
    docId: number;
    fileName: string;
    chunkIndex: number;
    heading: string | null;
    pageFrom: number | null;
    pageTo: number | null;
    content: string;
    tokenCount: number;
    vectorSim: number;
  }>,
  ftsHits: Array<{
    chunkId: number;
    docId: number;
    fileName: string;
    chunkIndex: number;
    heading: string | null;
    pageFrom: number | null;
    pageTo: number | null;
    content: string;
    tokenCount: number;
    ftsScore: number;
  }>,
  topK = 8,
  maxAdjacentPerDoc = 4,
): RetrievedChunk[] {
  const K = 60;
  const merged = new Map<number, RetrievedChunk>();

  vectorHits.forEach((hit, idx) => {
    const rank = idx + 1;
    const rrf = 1 / (K + rank);
    merged.set(hit.chunkId, {
      ...hit,
      displayFileName: cleanDisplayFileName(hit.fileName),
      ftsScore: 0,
      rrfScore: rrf,
    });
  });

  ftsHits.forEach((hit, idx) => {
    const rank = idx + 1;
    const rrf = 0.9 / (K + rank);
    const existing = merged.get(hit.chunkId);
    if (existing) {
      existing.ftsScore = hit.ftsScore;
      existing.rrfScore += rrf;
    } else {
      merged.set(hit.chunkId, {
        ...hit,
        displayFileName: cleanDisplayFileName(hit.fileName),
        vectorSim: 0,
        rrfScore: rrf,
      });
    }
  });

  const sorted = Array.from(merged.values()).sort((a, b) => {
    if (Math.abs(b.rrfScore - a.rrfScore) > 1e-6) return b.rrfScore - a.rrfScore;
    return b.vectorSim - a.vectorSim;
  });

  const selected: RetrievedChunk[] = [];
  const docCount = new Map<number, number>();
  const totalDistinctDocs = new Set(sorted.map((s) => s.docId)).size;

  for (const item of sorted) {
    if (selected.length >= topK) break;
    const usedInDoc = docCount.get(item.docId) ?? 0;
    if (totalDistinctDocs > 1 && usedInDoc >= maxAdjacentPerDoc) {
      continue;
    }
    selected.push(item);
    docCount.set(item.docId, usedInDoc + 1);
  }

  if (selected.length < topK) {
    const selectedIds = new Set(selected.map((s) => s.chunkId));
    for (const item of sorted) {
      if (selected.length >= topK) break;
      if (!selectedIds.has(item.chunkId)) {
        selected.push(item);
        selectedIds.add(item.chunkId);
      }
    }
  }

  return selected;
}

/** Truy vấn Hybrid (pgvector cosine + PostgreSQL Full-Text Search OR + RRF) trong phạm vi tài liệu của lớp. */
export async function hybridRetrieveClassChunks(opts: {
  classId: number;
  queryText: string;
  queryEmbedding: number[];
  docScope?: number[] | null;
  topK?: number;
}): Promise<{ chunks: RetrievedChunk[]; maxVectorSim: number }> {
  await ensureAiRagTables();
  const topK = opts.topK ?? Number(process.env.RAG_TOP_K || 8);
  const vecLit = toPgVectorLiteral(opts.queryEmbedding);
  const hasScope = Array.isArray(opts.docScope) && opts.docScope.length > 0;

  const vecRows = await query<any>(
    `SELECT dc.id AS chunk_id,
            dc.doc_id,
            d.file_name,
            dc.chunk_index,
            dc.heading,
            dc.page_from,
            dc.page_to,
            dc.content,
            dc.token_count,
            (1 - (dc.embedding <=> $2::vector(768))) AS vector_sim
       FROM doc_chunks dc
       JOIN docs d ON d.id = dc.doc_id
       JOIN class_attach_files caf ON caf.doc_id = dc.doc_id AND caf.class_id = $1
       JOIN doc_ingestions di ON di.doc_id = dc.doc_id AND di.status = 'ready'
      WHERE ($3::int[] IS NULL OR dc.doc_id = ANY($3::int[]))
      ORDER BY dc.embedding <=> $2::vector(768) ASC
      LIMIT 25`,
    [opts.classId, vecLit, hasScope ? opts.docScope : null],
  );

  let ftsRows: any[] = [];
  const orTsQuery = buildOrTsQueryString(opts.queryText);
  if (orTsQuery) {
    try {
      ftsRows = await query<any>(
        `SELECT dc.id AS chunk_id,
                dc.doc_id,
                d.file_name,
                dc.chunk_index,
                dc.heading,
                dc.page_from,
                dc.page_to,
                dc.content,
                dc.token_count,
                ts_rank_cd(dc.tsv, to_tsquery('simple', $2)) AS fts_score
           FROM doc_chunks dc
           JOIN docs d ON d.id = dc.doc_id
           JOIN class_attach_files caf ON caf.doc_id = dc.doc_id AND caf.class_id = $1
           JOIN doc_ingestions di ON di.doc_id = dc.doc_id AND di.status = 'ready'
          WHERE ($3::int[] IS NULL OR dc.doc_id = ANY($3::int[]))
            AND dc.tsv @@ to_tsquery('simple', $2)
          ORDER BY fts_score DESC
          LIMIT 25`,
        [opts.classId, orTsQuery, hasScope ? opts.docScope : null],
      );
    } catch {
      ftsRows = [];
    }
  }

  const vectorHits = vecRows.map((r) => ({
    chunkId: Number(r.chunk_id),
    docId: Number(r.doc_id),
    fileName: String(r.file_name),
    chunkIndex: Number(r.chunk_index),
    heading: r.heading ?? null,
    pageFrom: r.page_from !== null ? Number(r.page_from) : null,
    pageTo: r.page_to !== null ? Number(r.page_to) : null,
    content: String(r.content),
    tokenCount: Number(r.token_count ?? 0),
    vectorSim: Number(r.vector_sim ?? 0),
  }));

  const ftsHits = ftsRows.map((r) => ({
    chunkId: Number(r.chunk_id),
    docId: Number(r.doc_id),
    fileName: String(r.file_name),
    chunkIndex: Number(r.chunk_index),
    heading: r.heading ?? null,
    pageFrom: r.page_from !== null ? Number(r.page_from) : null,
    pageTo: r.page_to !== null ? Number(r.page_to) : null,
    content: String(r.content),
    tokenCount: Number(r.token_count ?? 0),
    ftsScore: Number(r.fts_score ?? 0),
  }));

  const maxVectorSim = vectorHits.length > 0 ? Math.max(...vectorHits.map((v) => v.vectorSim)) : 0;
  const chunks = mergeHybridResultsRRF(vectorHits, ftsHits, topK);

  return { chunks, maxVectorSim };
}

/** Lưu hoặc cập nhật vector embedding cho câu hỏi trong ngân hàng câu hỏi. */
export async function upsertBankQuestionEmbedding(
  bankQuestionId: number,
  classId: number,
  embedding: number[],
): Promise<void> {
  await ensureAiRagTables();
  const vecLit = toPgVectorLiteral(embedding);
  await query(
    `INSERT INTO bank_question_embeddings (bank_question_id, class_id, embedding)
     VALUES ($1, $2, $3::vector(768))
     ON CONFLICT (bank_question_id) DO UPDATE SET
       class_id = EXCLUDED.class_id,
       embedding = EXCLUDED.embedding`,
    [bankQuestionId, classId, vecLit],
  );
}

/** Tìm câu hỏi gần nhất trong ngân hàng câu hỏi của lớp bằng pgvector cosine. */
export async function findDuplicateInClassBank(
  classId: number,
  embedding: number[],
  similarityThreshold = 0.88,
): Promise<{ bankQuestionId: number; content: string; similarity: number } | null> {
  await ensureAiRagTables();
  const vecLit = toPgVectorLiteral(embedding);
  const row = await queryOne<{
    bank_question_id: number;
    content: string;
    similarity: number;
  }>(
    `SELECT bqe.bank_question_id,
            bq.content,
            (1 - (bqe.embedding <=> $2::vector(768))) AS similarity
       FROM bank_question_embeddings bqe
       JOIN bank_questions bq ON bq.id = bqe.bank_question_id
      WHERE bqe.class_id = $1
      ORDER BY bqe.embedding <=> $2::vector(768) ASC
      LIMIT 1`,
    [classId, vecLit],
  );

  if (!row || Number(row.similarity) < similarityThreshold) {
    return null;
  }
  return {
    bankQuestionId: Number(row.bank_question_id),
    content: String(row.content),
    similarity: Number(row.similarity),
  };
}
