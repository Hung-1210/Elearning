// src/services/ai/schema.ts
import { pool } from '../../config/database.js';

export const EMBEDDING_DIM = Number(process.env.GEMINI_EMBED_DIM || 768);

let aiSchemaEnsured = false;

/** Chuẩn hóa L2 một vector số thực về độ dài đơn vị (1.0). */
export function l2NormalizeVec(vec: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    const v = Number(vec[i]) || 0;
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  if (norm < 1e-12) return vec.map(() => 0);
  return vec.map((v) => Math.round(((Number(v) || 0) / norm) * 1e6) / 1e6);
}

/** Tính độ tương đồng Cosine giữa 2 vector cùng chiều. */
export function cosineSim(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = Number(a[i]) || 0;
    const vb = Number(b[i]) || 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom < 1e-12) return 0;
  return dot / denom;
}

/** Chuyển mảng số sang chuỗi literal '[v1,v2,...]' cho cột vector(768) của pgvector. */
export function toPgVectorLiteral(vec: number[], expectedDim = EMBEDDING_DIM): string {
  const normalized = l2NormalizeVec(vec);
  const padded: number[] = [];
  for (let i = 0; i < expectedDim; i++) {
    const val = Number(normalized[i] ?? 0);
    padded.push(Number.isFinite(val) ? val : 0);
  }
  return `[${padded.join(',')}]`;
}

/** Đọc chuỗi '[v1,v2,...]' hoặc mảng từ pgvector thành number[]. */
export function parsePgVectorLiteral(raw: unknown): number[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return raw.map((x) => Number(x) || 0);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim().replace(/^\[|\]$/g, '');
    if (!trimmed) return null;
    return trimmed.split(',').map((s) => Number(s.trim()) || 0);
  }
  return null;
}

/** Đảm bảo đầy đủ bảng & cột cho RAG Chat và Sinh câu hỏi AI khi khởi động. */
export async function ensureAiRagTables(): Promise<void> {
  if (aiSchemaEnsured) return;
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS doc_ingestions (
      doc_id        INTEGER PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
      status        VARCHAR(16) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','ready','failed','unsupported')),
      error_code    VARCHAR(30),
      error_message TEXT,
      content_hash  CHAR(64),
      page_count    INTEGER,
      char_count    INTEGER,
      chunk_count   INTEGER NOT NULL DEFAULT 0,
      embed_model   VARCHAR(64),
      attempts      SMALLINT NOT NULL DEFAULT 0,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS doc_chunks (
      id           SERIAL PRIMARY KEY,
      doc_id       INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      chunk_index  INTEGER NOT NULL,
      heading      TEXT,
      page_from    INTEGER,
      page_to      INTEGER,
      content      TEXT NOT NULL,
      token_count  INTEGER,
      embedding    vector(768) NOT NULL,
      tsv          TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
      UNIQUE (doc_id, chunk_index)
    );

    CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc ON doc_chunks(doc_id);
    CREATE INDEX IF NOT EXISTS idx_doc_chunks_emb
      ON doc_chunks USING hnsw (embedding vector_cosine_ops);
    CREATE INDEX IF NOT EXISTS idx_doc_chunks_tsv ON doc_chunks USING GIN(tsv);

    CREATE TABLE IF NOT EXISTS rag_conversations (
      id          SERIAL PRIMARY KEY,
      class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       VARCHAR(200) NOT NULL DEFAULT 'Cuộc trò chuyện mới',
      doc_scope   INTEGER[],
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_rag_conv_user
      ON rag_conversations(class_id, user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS rag_messages (
      id              SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES rag_conversations(id) ON DELETE CASCADE,
      role            VARCHAR(10) NOT NULL CHECK (role IN ('user','assistant')),
      content         TEXT NOT NULL,
      citations       JSONB NOT NULL DEFAULT '[]'::jsonb,
      grounded        BOOLEAN,
      tokens_in       INTEGER,
      tokens_out      INTEGER,
      latency_ms      INTEGER,
      feedback        SMALLINT CHECK (feedback IN (-1, 1)),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_rag_messages_conv
      ON rag_messages(conversation_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS ai_generation_jobs (
      id            SERIAL PRIMARY KEY,
      class_id      INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      lecturer_id   INTEGER NOT NULL REFERENCES lecturers(id),
      doc_ids       INTEGER[] NOT NULL,
      config        JSONB NOT NULL,
      status        VARCHAR(16) NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','done','failed','cancelled')),
      progress      SMALLINT NOT NULL DEFAULT 0,
      error_message TEXT,
      tokens_in     INTEGER NOT NULL DEFAULT 0,
      tokens_out    INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at   TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_ai_jobs_class
      ON ai_generation_jobs(class_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS ai_question_drafts (
      id                SERIAL PRIMARY KEY,
      job_id            INTEGER NOT NULL REFERENCES ai_generation_jobs(id) ON DELETE CASCADE,
      class_id          INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      question_type     VARCHAR(20) NOT NULL
                        CHECK (question_type IN ('single_choice','multiple_choice','essay')),
      difficulty        VARCHAR(10) NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
      content           TEXT NOT NULL,
      options           JSONB NOT NULL DEFAULT '[]'::jsonb,
      explanation       TEXT,
      chapter           VARCHAR(100),
      tags              TEXT[] NOT NULL DEFAULT '{}',
      default_points    NUMERIC(6,2) NOT NULL DEFAULT 1,
      source_chunk_ids  INTEGER[] NOT NULL DEFAULT '{}',
      source_doc_id     INTEGER REFERENCES docs(id) ON DELETE SET NULL,
      source_file_name  TEXT,
      source_page_from  INTEGER,
      source_page_to    INTEGER,
      source_quote      TEXT,
      content_embedding vector(768),
      quality_flags     TEXT[] NOT NULL DEFAULT '{}',
      duplicate_of      INTEGER REFERENCES bank_questions(id) ON DELETE SET NULL,
      duplicate_content TEXT,
      verify_note       TEXT,
      status            VARCHAR(12) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','accepted','discarded')),
      bank_question_id  INTEGER REFERENCES bank_questions(id) ON DELETE SET NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_ai_drafts_job ON ai_question_drafts(job_id, status);

    ALTER TABLE bank_questions
      ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual','import','ai')),
      ADD COLUMN IF NOT EXISTS ai_draft_id INTEGER,
      ADD COLUMN IF NOT EXISTS source_doc_ids INTEGER[] NOT NULL DEFAULT '{}';

    CREATE TABLE IF NOT EXISTS bank_question_embeddings (
      bank_question_id INTEGER PRIMARY KEY REFERENCES bank_questions(id) ON DELETE CASCADE,
      class_id         INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      embedding        vector(768) NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bqe_emb
      ON bank_question_embeddings USING hnsw (embedding vector_cosine_ops);
    CREATE INDEX IF NOT EXISTS idx_bqe_class
      ON bank_question_embeddings(class_id);

    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id         BIGSERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      class_id   INTEGER,
      feature    VARCHAR(20) NOT NULL CHECK (feature IN ('chat','generate','embed')),
      tokens_in  INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_ai_usage_user_time
      ON ai_usage_logs(user_id, feature, created_at DESC);
  `);
  aiSchemaEnsured = true;
}
