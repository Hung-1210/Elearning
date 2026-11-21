-- =====================================================================
-- 004_face_attendance.sql
-- Hồ sơ khuôn mặt sinh viên (4 ảnh + giảng viên duyệt) & Điểm danh tự động
-- trong phòng học trực tuyến (Một lần / Định kỳ) + Cổng đối chiếu Precheck thi.
-- =====================================================================

BEGIN;

-- 1. Hồ sơ khuôn mặt của người dùng (gắn với tài khoản, dùng cho cả Meeting & Thi)
CREATE TABLE IF NOT EXISTS user_face_profiles (
    user_id               INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    embedding             REAL[] NOT NULL,
    photo_path            TEXT,
    sample_count          INTEGER NOT NULL DEFAULT 4,
    model_version         TEXT NOT NULL DEFAULT 'buffalo_sc_v1',
    consented_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    review_status         TEXT NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending', 'approved', 'rejected')),
    reviewed_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at           TIMESTAMPTZ,
    reject_reason         TEXT,
    -- Lưu giữ hồ sơ đã duyệt gần nhất để khi sinh viên đăng ký lại (chờ duyệt) vẫn điểm danh được
    approved_embedding    REAL[],
    approved_photo_path   TEXT,
    approved_at           TIMESTAMPTZ,
    approved_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
    enrollment_count      INTEGER NOT NULL DEFAULT 1,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Bốn ảnh gốc của lần đăng ký hiện tại để giảng viên đối chiếu khi duyệt
CREATE TABLE IF NOT EXISTS user_face_profile_photos (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    step_no     SMALLINT NOT NULL CHECK (step_no BETWEEN 1 AND 4),
    photo_path  TEXT NOT NULL,
    face_score  REAL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, step_no)
);

-- 3. Phiên điểm danh trong phòng học trực tuyến (Meeting)
CREATE TABLE IF NOT EXISTS attendance_sessions (
    id                 SERIAL PRIMARY KEY,
    meeting_id         TEXT NOT NULL,
    class_id           INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    started_by         INTEGER NOT NULL REFERENCES users(id),
    mode               TEXT NOT NULL DEFAULT 'once'
        CHECK (mode IN ('once', 'periodic')),
    strictness         TEXT NOT NULL DEFAULT 'balanced'
        CHECK (strictness IN ('relaxed', 'balanced', 'strict')),
    window_sec         INTEGER NOT NULL DEFAULT 120,
    threshold          REAL NOT NULL DEFAULT 0.45,
    interval_min       INTEGER,
    max_rounds         INTEGER,
    current_round      INTEGER NOT NULL DEFAULT 1,
    round_open         BOOLEAN NOT NULL DEFAULT TRUE,
    round_ends_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 minutes'),
    next_round_at      TIMESTAMPTZ,
    pass_ratio         REAL NOT NULL DEFAULT 0.7,
    duplicate_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at           TIMESTAMPTZ
);

-- 4. Bản ghi điểm danh từng sinh viên theo từng đợt (round_no)
CREATE TABLE IF NOT EXISTS attendance_records (
    id                  SERIAL PRIMARY KEY,
    session_id          INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    round_no            INTEGER NOT NULL DEFAULT 1,
    student_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status              TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'present', 'mismatch', 'absent', 'no_profile', 'manual')),
    sub_status          TEXT,
    similarity          REAL,
    face_count          INTEGER,
    attempts            INTEGER NOT NULL DEFAULT 0,
    evidence_path       TEXT,
    evidence_expires_at TIMESTAMPTZ,
    checked_at          TIMESTAMPTZ,
    override_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    override_at         TIMESTAMPTZ,
    override_reason     TEXT,
    UNIQUE (session_id, round_no, student_id)
);

-- 5. Tùy chọn yêu cầu đối chiếu hồ sơ khuôn mặt ở Precheck đề thi (P5)
ALTER TABLE exam_proctoring_settings
    ADD COLUMN IF NOT EXISTS require_face_profile BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_face_profiles_review_status
    ON user_face_profiles(review_status);

CREATE INDEX IF NOT EXISTS idx_face_profile_photos_user
    ON user_face_profile_photos(user_id, step_no);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_meeting
    ON attendance_sessions(meeting_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_class
    ON attendance_sessions(class_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_records_session_round
    ON attendance_records(session_id, round_no);

CREATE INDEX IF NOT EXISTS idx_attendance_records_evidence_expiry
    ON attendance_records(evidence_expires_at) WHERE evidence_path IS NOT NULL;

COMMIT;

