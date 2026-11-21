-- ============================================================
-- 005_ai_rag.sql
-- Module: RAG Chat Tài Liệu Lớp & Tạo Câu Hỏi Bằng AI (Gemini 2.5 Flash + pgvector)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Trạng thái lập chỉ mục tài liệu
CREATE TABLE IF NOT EXISTS doc_ingestions (
  doc_id        INTEGER PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  status        VARCHAR(16) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','ready','failed','unsupported')),
  error_code    VARCHAR(30),       -- 'scanned_pdf','too_large','parse_error','embed_error','missing_api_key'
  error_message TEXT,
  content_hash  CHAR(64),          -- sha256 file, tránh index lại khi không đổi
  page_count    INTEGER,
  char_count    INTEGER,
  chunk_count   INTEGER NOT NULL DEFAULT 0,
  embed_model   VARCHAR(64),
  attempts      SMALLINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Các đoạn văn bản (chunk) của tài liệu kèm vector 768 chiều (pgvector) & TSVECTOR
CREATE TABLE IF NOT EXISTS doc_chunks (
  id           SERIAL PRIMARY KEY,
  doc_id       INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  chunk_index  INTEGER NOT NULL,
  heading      TEXT,               -- tiêu đề mục gần nhất (gợi ý "chương")
  page_from    INTEGER,
  page_to      INTEGER,
  content      TEXT NOT NULL,
  token_count  INTEGER,
  embedding    vector(768) NOT NULL, -- đã chuẩn hóa L2
  tsv          TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  UNIQUE (doc_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc ON doc_chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_emb
  ON doc_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_tsv ON doc_chunks USING GIN(tsv);

-- 3. Cuộc hội thoại RAG Chat theo lớp & người dùng
CREATE TABLE IF NOT EXISTS rag_conversations (
  id          SERIAL PRIMARY KEY,
  class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL DEFAULT 'Cuộc trò chuyện mới',
  doc_scope   INTEGER[],           -- NULL = toàn bộ tài liệu lớp
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_conv_user
  ON rag_conversations(class_id, user_id, updated_at DESC);

-- 4. Tin nhắn trong hội thoại RAG Chat
CREATE TABLE IF NOT EXISTS rag_messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES rag_conversations(id) ON DELETE CASCADE,
  role            VARCHAR(10) NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  citations       JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{n, chunkId, docId, fileName, pageFrom, pageTo, heading, snippet}]
  grounded        BOOLEAN,          -- false = không tìm thấy trong tài liệu
  tokens_in       INTEGER,
  tokens_out      INTEGER,
  latency_ms      INTEGER,
  feedback        SMALLINT CHECK (feedback IN (-1, 1)),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_messages_conv
  ON rag_messages(conversation_id, created_at ASC);

-- 5. Job sinh câu hỏi bằng AI
CREATE TABLE IF NOT EXISTS ai_generation_jobs (
  id            SERIAL PRIMARY KEY,
  class_id      INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  lecturer_id   INTEGER NOT NULL REFERENCES lecturers(id),
  doc_ids       INTEGER[] NOT NULL,
  config        JSONB NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','running','done','failed','cancelled')),
  progress      SMALLINT NOT NULL DEFAULT 0,  -- 0..100
  error_message TEXT,
  tokens_in     INTEGER NOT NULL DEFAULT 0,
  tokens_out    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_class
  ON ai_generation_jobs(class_id, created_at DESC);

-- 6. Bản nháp câu hỏi AI sinh ra (chờ giảng viên duyệt/chỉnh sửa)
CREATE TABLE IF NOT EXISTS ai_question_drafts (
  id                SERIAL PRIMARY KEY,
  job_id            INTEGER NOT NULL REFERENCES ai_generation_jobs(id) ON DELETE CASCADE,
  class_id          INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  question_type     VARCHAR(20) NOT NULL
                    CHECK (question_type IN ('single_choice','multiple_choice','essay')),
  difficulty        VARCHAR(10) NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  content           TEXT NOT NULL,
  options           JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{content, isCorrect}]
  explanation       TEXT,               -- lời giải / đáp án mẫu (essay)
  chapter           VARCHAR(100),
  tags              TEXT[] NOT NULL DEFAULT '{}',
  default_points    NUMERIC(6,2) NOT NULL DEFAULT 1,
  source_chunk_ids  INTEGER[] NOT NULL DEFAULT '{}',
  source_doc_id     INTEGER REFERENCES docs(id) ON DELETE SET NULL,
  source_file_name  TEXT,
  source_page_from  INTEGER,
  source_page_to    INTEGER,
  source_quote      TEXT,               -- câu trích từ tài liệu chứng minh đáp án
  content_embedding vector(768),        -- để phát hiện trùng bằng pgvector
  quality_flags     TEXT[] NOT NULL DEFAULT '{}', -- 'duplicate_bank','duplicate_batch','verify_failed','ungrounded'
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

-- 7. Mở rộng bank_questions để lưu nguồn câu hỏi (manual / import / ai)
ALTER TABLE bank_questions
  ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','import','ai')),
  ADD COLUMN IF NOT EXISTS ai_draft_id INTEGER,
  ADD COLUMN IF NOT EXISTS source_doc_ids INTEGER[] NOT NULL DEFAULT '{}';

-- 8. Embedding nội dung câu hỏi trong ngân hàng để chống trùng bằng pgvector
CREATE TABLE IF NOT EXISTS bank_question_embeddings (
  bank_question_id INTEGER PRIMARY KEY REFERENCES bank_questions(id) ON DELETE CASCADE,
  class_id         INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  embedding        vector(768) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bqe_emb
  ON bank_question_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_bqe_class
  ON bank_question_embeddings(class_id);

-- 9. Nhật ký sử dụng AI để kiểm soát hạn mức (rate limit) và thống kê token
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
