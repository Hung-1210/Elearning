-- =====================================================================
-- 002_exam_module.sql
-- Module thi online có giám sát AI. MIGRATION TĂNG DẦN: không DROP bảng cũ.
-- Yêu cầu: schema.sql hiện tại đã được nạp (users, lecturers, students,
-- classes, class_collaborators, classes_n_students).
-- Quy ước: bảng mới dùng TIMESTAMPTZ (lưu UTC). Bảng cũ giữ nguyên TIMESTAMP.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. NGÂN HÀNG CÂU HỎI (thuộc về 1 lớp)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bank_questions (
    id            SERIAL PRIMARY KEY,
    class_id      INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    created_by    INTEGER NOT NULL REFERENCES lecturers(id),
    question_type VARCHAR(20) NOT NULL
        CHECK (question_type IN ('single_choice','multiple_choice','essay','file_upload')),
    content       TEXT NOT NULL,
    explanation   TEXT,
    default_points NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (default_points >= 0),
    difficulty    VARCHAR(10) NOT NULL DEFAULT 'medium'
        CHECK (difficulty IN ('easy','medium','hard')),
    chapter       VARCHAR(100),
    tags          TEXT[] NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_question_options (
    id          SERIAL PRIMARY KEY,
    question_id INTEGER NOT NULL REFERENCES bank_questions(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    is_correct  BOOLEAN NOT NULL DEFAULT FALSE,
    position    SMALLINT NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------
-- 2. ĐỀ THI
-- Trạng thái hiển thị (Nháp/Sắp diễn ra/Đang mở/Đã đóng) được TÍNH từ
-- status + start_time/end_time, KHÔNG lưu (tránh phải chạy cron cập nhật).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exams (
    id                SERIAL PRIMARY KEY,
    class_id          INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    created_by        INTEGER NOT NULL REFERENCES lecturers(id),
    name              VARCHAR(200) NOT NULL,
    description       TEXT,
    status            VARCHAR(12) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','published')),
    start_time        TIMESTAMPTZ NOT NULL,
    end_time          TIMESTAMPTZ NOT NULL,
    duration_minutes  INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 600),
    max_attempts      SMALLINT NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 10),
    shuffle_questions BOOLEAN NOT NULL DEFAULT FALSE,
    shuffle_options   BOOLEAN NOT NULL DEFAULT FALSE,
    -- Học sinh được xem điểm khi nào
    result_visibility VARCHAR(12) NOT NULL DEFAULT 'after_close'
        CHECK (result_visibility IN ('immediately','after_close','hidden')),
    -- Học sinh có được xem lại đề + đáp án đúng/sai không
    allow_review      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_time > start_time)
);

-- Cấu hình giám sát AI: 1-1 với exam. Cột kiểu tường minh (không JSONB) để có
-- CHECK ở tầng DB. Ngưỡng số đã được "resolve" từ preset tại thời điểm lưu,
-- nên chỉnh preset sau này không làm đổi đề thi cũ.
CREATE TABLE IF NOT EXISTS exam_proctoring_settings (
    exam_id                       INTEGER PRIMARY KEY REFERENCES exams(id) ON DELETE CASCADE,
    enabled                       BOOLEAN NOT NULL DEFAULT FALSE,      -- công tắc tổng

    -- Nhóm A: danh tính
    verify_identity               BOOLEAN NOT NULL DEFAULT TRUE,
    detect_identity_swap          BOOLEAN NOT NULL DEFAULT TRUE,
    identity_recheck_interval_sec INTEGER NOT NULL DEFAULT 30
        CHECK (identity_recheck_interval_sec BETWEEN 10 AND 900),
    identity_threshold            NUMERIC(3,2) NOT NULL DEFAULT 0.45
        CHECK (identity_threshold BETWEEN 0.20 AND 0.90),

    -- Nhóm B: khuôn mặt
    detect_no_face                BOOLEAN NOT NULL DEFAULT TRUE,
    no_face_grace_sec             INTEGER NOT NULL DEFAULT 5
        CHECK (no_face_grace_sec BETWEEN 1 AND 120),
    detect_multiple_faces         BOOLEAN NOT NULL DEFAULT TRUE,

    -- Nhóm C: hướng đầu / hướng mắt
    track_head_pose               BOOLEAN NOT NULL DEFAULT TRUE,
    head_sensitivity              VARCHAR(10) NOT NULL DEFAULT 'normal'
        CHECK (head_sensitivity IN ('relaxed','normal','strict','custom')),
    head_yaw_threshold_deg        SMALLINT NOT NULL DEFAULT 35
        CHECK (head_yaw_threshold_deg BETWEEN 10 AND 80),
    head_pitch_threshold_deg      SMALLINT NOT NULL DEFAULT 25
        CHECK (head_pitch_threshold_deg BETWEEN 10 AND 60),
    head_min_duration_ms          INTEGER NOT NULL DEFAULT 2000
        CHECK (head_min_duration_ms BETWEEN 0 AND 30000),
    track_gaze                    BOOLEAN NOT NULL DEFAULT FALSE,
    gaze_sensitivity              VARCHAR(10) NOT NULL DEFAULT 'normal'
        CHECK (gaze_sensitivity IN ('relaxed','normal','strict','custom')),
    gaze_yaw_threshold_deg        SMALLINT NOT NULL DEFAULT 30
        CHECK (gaze_yaw_threshold_deg BETWEEN 10 AND 60),
    gaze_pitch_threshold_deg      SMALLINT NOT NULL DEFAULT 22
        CHECK (gaze_pitch_threshold_deg BETWEEN 10 AND 60),
    gaze_min_duration_ms          INTEGER NOT NULL DEFAULT 2000
        CHECK (gaze_min_duration_ms BETWEEN 0 AND 30000),

    -- Nhóm D: vật thể (YOLO)
    detect_phone                  BOOLEAN NOT NULL DEFAULT TRUE,
    detect_document               BOOLEAN NOT NULL DEFAULT TRUE,       -- class 'book'
    detect_secondary_screen       BOOLEAN NOT NULL DEFAULT FALSE,      -- class 'laptop' + 'tv'
    detect_headphone              BOOLEAN NOT NULL DEFAULT FALSE,
    detect_extra_person           BOOLEAN NOT NULL DEFAULT FALSE,      -- class 'person' >= 2
    object_conf_threshold         NUMERIC(3,2) NOT NULL DEFAULT 0.60
        CHECK (object_conf_threshold BETWEEN 0.30 AND 0.95),

    -- Nhóm F (bổ sung, không bắt buộc): hành vi trình duyệt
    detect_tab_switch             BOOLEAN NOT NULL DEFAULT TRUE,

    -- Nhóm E: hành động khi vi phạm
    violation_action              VARCHAR(12) NOT NULL DEFAULT 'warn_and_log'
        CHECK (violation_action IN ('log_only','warn_and_log','auto_submit')),
    auto_submit_after_violations  SMALLINT NOT NULL DEFAULT 3
        CHECK (auto_submit_after_violations BETWEEN 1 AND 20),

    -- Vận hành
    frame_interval_ms             INTEGER NOT NULL DEFAULT 1500
        CHECK (frame_interval_ms BETWEEN 500 AND 10000),
    evidence_retention_days       INTEGER NOT NULL DEFAULT 90
        CHECK (evidence_retention_days BETWEEN 1 AND 730),

    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Câu hỏi TRONG đề = bản SAO (snapshot) từ ngân hàng hoặc tạo mới.
-- Sửa ngân hàng sau này không làm đổi đề đã xuất bản.
CREATE TABLE IF NOT EXISTS exam_questions (
    id                      SERIAL PRIMARY KEY,
    exam_id                 INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    source_bank_question_id INTEGER REFERENCES bank_questions(id) ON DELETE SET NULL,
    position                INTEGER NOT NULL,
    question_type           VARCHAR(20) NOT NULL
        CHECK (question_type IN ('single_choice','multiple_choice','essay','file_upload')),
    content                 TEXT NOT NULL,
    explanation             TEXT,
    points                  NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (points >= 0)
);

CREATE TABLE IF NOT EXISTS exam_question_options (
    id               SERIAL PRIMARY KEY,
    exam_question_id INTEGER NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
    content          TEXT NOT NULL,
    is_correct       BOOLEAN NOT NULL DEFAULT FALSE,
    position         SMALLINT NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------
-- 3. PRE-CHECK (chụp ảnh tham chiếu TRƯỚC khi bấm "Bắt đầu làm bài")
-- id chính là precheckToken gửi kèm khi tạo attempt. Dùng 1 lần, hết hạn nhanh.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_precheck_sessions (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id              INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    student_id           INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    reference_embedding  REAL[] NOT NULL,
    reference_photo_path TEXT,
    expires_at           TIMESTAMPTZ NOT NULL,
    consumed_at          TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 4. LẦN LÀM BÀI (ATTEMPT) VÀ CÂU TRẢ LỜI
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_attempts (
    id                     SERIAL PRIMARY KEY,
    exam_id                INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    student_id             INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    attempt_no             SMALLINT NOT NULL,
    status                 VARCHAR(12) NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress','submitted')),
    submit_reason          VARCHAR(12)
        CHECK (submit_reason IN ('manual','time_up','proctoring','lecturer')),
    started_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deadline_at            TIMESTAMPTZ NOT NULL,      -- server là nguồn sự thật cho đồng hồ
    submitted_at           TIMESTAMPTZ,

    -- Thứ tự hiển thị riêng của attempt này (khi bật trộn đề/đáp án)
    question_order         INTEGER[] NOT NULL DEFAULT '{}',   -- exam_questions.id theo thứ tự
    option_order           JSONB NOT NULL DEFAULT '{}'::jsonb, -- { "<examQuestionId>": [optionId,...] }

    -- Giám sát
    reference_embedding    REAL[],
    reference_photo_path   TEXT,
    last_frame_at          TIMESTAMPTZ,
    last_identity_check_at TIMESTAMPTZ,
    frame_count            INTEGER NOT NULL DEFAULT 0,
    ai_error_count         INTEGER NOT NULL DEFAULT 0,

    -- Chấm điểm
    total_score            NUMERIC(7,2),
    max_score              NUMERIC(7,2),
    grading_status         VARCHAR(12) NOT NULL DEFAULT 'pending'
        CHECK (grading_status IN ('pending','needs_manual','graded')),
    graded_at              TIMESTAMPTZ,

    -- Kết luận của giảng viên (cũng là nhãn thật cho ML giai đoạn sau)
    review_verdict         VARCHAR(20) NOT NULL DEFAULT 'unreviewed'
        CHECK (review_verdict IN ('unreviewed','clean','suspected','confirmed_cheating')),
    review_note            TEXT,
    reviewed_by            INTEGER REFERENCES lecturers(id),
    reviewed_at            TIMESTAMPTZ,

    UNIQUE (exam_id, student_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS attempt_answers (
    id                  SERIAL PRIMARY KEY,
    attempt_id          INTEGER NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    exam_question_id    INTEGER NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
    selected_option_ids INTEGER[] NOT NULL DEFAULT '{}',   -- service phải kiểm tra option thuộc câu hỏi
    text_answer         TEXT,
    file_path           TEXT,                              -- cho question_type = 'file_upload'
    is_flagged          BOOLEAN NOT NULL DEFAULT FALSE,    -- "đánh dấu xem lại"
    answered_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_correct          BOOLEAN,                           -- NULL với câu tự luận / chưa chấm
    score               NUMERIC(6,2),                      -- NULL = chưa chấm
    grader_comment      TEXT,
    graded_by           INTEGER REFERENCES lecturers(id),
    graded_at           TIMESTAMPTZ,
    UNIQUE (attempt_id, exam_question_id)
);

-- ---------------------------------------------------------------------
-- 5. GIÁM SÁT: SỰ KIỆN VI PHẠM (theo mô hình "episode") VÀ BẰNG CHỨNG
-- 1 dòng = 1 đợt vi phạm liên tục (vd: quay đầu phải từ 14:32:10 -> 14:32:16).
-- Thống kê "quay đầu trái 5 lần · 23 giây" = COUNT(*) và SUM(duration_ms).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proctoring_events (
    id            SERIAL PRIMARY KEY,
    attempt_id    INTEGER NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    event_type    VARCHAR(24) NOT NULL CHECK (event_type IN (
        'head_turn_left','head_turn_right','head_pitch_up','head_pitch_down',
        'gaze_left','gaze_right','gaze_up','gaze_down',
        'no_face','multiple_faces','identity_mismatch',
        'object_cell_phone','object_book','object_laptop','object_tv','object_headphone',
        'extra_person',
        'tab_hidden','window_blur','fullscreen_exit','camera_lost'
    )),
    severity      VARCHAR(10) NOT NULL CHECK (severity IN ('info','warning','critical')),
    started_at    TIMESTAMPTZ NOT NULL,
    last_seen_at  TIMESTAMPTZ NOT NULL,     -- mẫu vi phạm gần nhất
    ended_at      TIMESTAMPTZ,              -- NULL = đang diễn ra
    sample_count  INTEGER NOT NULL DEFAULT 1,
    peak_value    REAL,                     -- vd: max |yaw|, hoặc max confidence
    -- Chỉ đợt vi phạm đủ dài/đủ mẫu mới được "xác nhận" (lọc nhiễu 1 frame)
    is_confirmed  BOOLEAN NOT NULL DEFAULT FALSE,
    confirmed_at  TIMESTAMPTZ,
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Giảng viên review từng sự kiện (loại báo động giả)
    review_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending','confirmed_cheating','dismissed')),
    reviewed_by   INTEGER REFERENCES lecturers(id),
    reviewed_at   TIMESTAMPTZ,
    review_note   TEXT,
    -- Thời lượng (ms): đợt đang mở tính đến last_seen_at
    duration_ms   INTEGER GENERATED ALWAYS AS (
        (EXTRACT(EPOCH FROM (COALESCE(ended_at, last_seen_at) - started_at)) * 1000)::INTEGER
    ) STORED
);

CREATE TABLE IF NOT EXISTS proctoring_evidence (
    id          SERIAL PRIMARY KEY,
    event_id    INTEGER NOT NULL REFERENCES proctoring_events(id) ON DELETE CASCADE,
    attempt_id  INTEGER NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    file_path   TEXT NOT NULL,              -- đường dẫn TƯƠNG ĐỐI trong private dir
    size_bytes  INTEGER,
    captured_at TIMESTAMPTZ NOT NULL,       -- thời điểm client chụp
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confidence  REAL,
    ai_payload  JSONB NOT NULL DEFAULT '{}'::jsonb,   -- bbox, góc, similarity...
    expires_at  TIMESTAMPTZ NOT NULL,       -- retention: job dọn file + set deleted_at
    deleted_at  TIMESTAMPTZ
);

-- ---------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_bank_questions_class        ON bank_questions(class_id, question_type);
CREATE INDEX IF NOT EXISTS idx_bank_questions_chapter      ON bank_questions(class_id, chapter);
CREATE INDEX IF NOT EXISTS idx_bank_options_question       ON bank_question_options(question_id);

CREATE INDEX IF NOT EXISTS idx_exams_class                 ON exams(class_id, status);
CREATE INDEX IF NOT EXISTS idx_exam_questions_exam         ON exam_questions(exam_id, position);
CREATE INDEX IF NOT EXISTS idx_exam_options_question       ON exam_question_options(exam_question_id);

CREATE INDEX IF NOT EXISTS idx_precheck_lookup             ON exam_precheck_sessions(exam_id, student_id);

CREATE INDEX IF NOT EXISTS idx_attempts_exam               ON exam_attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_student            ON exam_attempts(student_id);
-- Mỗi học sinh chỉ có 1 attempt đang làm cho mỗi đề (chặn race khi bấm "Bắt đầu" 2 lần)
CREATE UNIQUE INDEX IF NOT EXISTS uq_attempt_in_progress
    ON exam_attempts(exam_id, student_id) WHERE status = 'in_progress';
-- Job quét attempt hết hạn
CREATE INDEX IF NOT EXISTS idx_attempts_deadline
    ON exam_attempts(deadline_at) WHERE status = 'in_progress';

CREATE INDEX IF NOT EXISTS idx_answers_attempt             ON attempt_answers(attempt_id);

CREATE INDEX IF NOT EXISTS idx_events_attempt_time         ON proctoring_events(attempt_id, started_at);
CREATE INDEX IF NOT EXISTS idx_events_confirmed_type
    ON proctoring_events(attempt_id, event_type) WHERE is_confirmed;
-- Bất biến: mỗi (attempt, event_type) chỉ có tối đa 1 đợt đang mở. Cho phép dùng
-- INSERT ... ON CONFLICT (attempt_id, event_type) WHERE ended_at IS NULL an toàn
-- ngay cả khi 2 frame của cùng attempt được xử lý đồng thời.
CREATE UNIQUE INDEX IF NOT EXISTS uq_events_open
    ON proctoring_events(attempt_id, event_type) WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_evidence_attempt            ON proctoring_evidence(attempt_id);
CREATE INDEX IF NOT EXISTS idx_evidence_event              ON proctoring_evidence(event_id);
CREATE INDEX IF NOT EXISTS idx_evidence_expiry
    ON proctoring_evidence(expires_at) WHERE deleted_at IS NULL;

COMMIT;
