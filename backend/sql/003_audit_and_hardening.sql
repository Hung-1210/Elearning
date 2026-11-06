-- 003_audit_and_hardening.sql
-- Bổ sung bảng audit lịch sử chấm/sửa điểm và các chỉ mục phục vụ Live Monitor & Analytics.

CREATE TABLE IF NOT EXISTS attempt_grade_audit_logs (
    id               SERIAL PRIMARY KEY,
    attempt_id       INTEGER NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    exam_question_id INTEGER NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
    changed_by       INTEGER NOT NULL REFERENCES users(id),
    old_score        NUMERIC(6,2),
    new_score        NUMERIC(6,2) NOT NULL,
    old_comment      TEXT,
    new_comment      TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grade_audit_attempt
    ON attempt_grade_audit_logs(attempt_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_proctoring_events_attempt_confirmed
    ON proctoring_events(attempt_id, is_confirmed, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_proctoring_evidence_event
    ON proctoring_evidence(event_id) WHERE deleted_at IS NULL;

