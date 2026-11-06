"use strict";
// src/services/proctoring/event-tracker.ts
// Ghi BehaviorSample[] (từ policy.evaluateAnalysis) thành các "episode" trong
// bảng proctoring_events. Dựa vào bất biến DB: mỗi (attempt_id, event_type) chỉ
// có TỐI ĐA 1 dòng đang mở (ended_at IS NULL) — enforce bởi index uq_events_open.
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyBehaviorSamples = applyBehaviorSamples;
exports.closeStaleEpisodes = closeStaleEpisodes;
/**
 * Áp dụng danh sách mẫu hành vi của 1 lần chạy AI vào DB, trong transaction của caller.
 * Trả về các episode VỪA được xác nhận lần đầu (is_confirmed false -> true) ở lần gọi
 * này — dùng để: (a) đẩy cảnh báo realtime cho học sinh/giảng viên, (b) đếm violation
 * cho auto-submit. Không trả episode "đang mở nhưng đã confirmed từ trước" để tránh
 * bắn cảnh báo lặp lại mỗi frame.
 */
async function applyBehaviorSamples(client, attemptId, samples, now = new Date()) {
    const newlyConfirmed = [];
    const closed = [];
    for (const s of samples) {
        if (s.active) {
            const row = await upsertOpenEpisode(client, attemptId, s, now);
            if (row.just_confirmed) {
                newlyConfirmed.push(toClosedEpisode(row, now, true));
            }
        }
        else {
            const row = await closeOrDiscardEpisode(client, attemptId, s.type, now);
            if (row)
                closed.push(toClosedEpisode(row, now, row.is_confirmed));
        }
    }
    return { newlyConfirmed, closed };
}
async function upsertOpenEpisode(client, attemptId, s, now) {
    const { rows } = await client.query(`
    INSERT INTO proctoring_events
      (attempt_id, event_type, severity, started_at, last_seen_at, sample_count, peak_value, is_confirmed)
    VALUES ($1, $2, $3, $4, $4, 1, $5,
      -- Có thể tự confirm ngay ở mẫu đầu tiên nếu minSamples<=1 và minDurationMs<=0
      (1 >= $6 AND 0 >= $7))
    ON CONFLICT (attempt_id, event_type) WHERE ended_at IS NULL
    DO UPDATE SET
      last_seen_at = EXCLUDED.last_seen_at,
      sample_count  = proctoring_events.sample_count + 1,
      peak_value    = GREATEST(COALESCE(proctoring_events.peak_value, 0), COALESCE(EXCLUDED.peak_value, 0)),
      is_confirmed  = proctoring_events.is_confirmed
        OR (proctoring_events.sample_count + 1 >= $6
            AND (EXTRACT(EPOCH FROM ($4 - proctoring_events.started_at)) * 1000) >= $7),
      confirmed_at  = CASE
        WHEN NOT proctoring_events.is_confirmed
             AND (proctoring_events.sample_count + 1 >= $6
                  AND (EXTRACT(EPOCH FROM ($4 - proctoring_events.started_at)) * 1000) >= $7)
        THEN $4 ELSE proctoring_events.confirmed_at END
    RETURNING id, event_type, severity, started_at, last_seen_at, sample_count, is_confirmed,
              (xmax = 0) AS inserted
    `, [attemptId, s.type, s.severity, now, s.value ?? null, s.minSamples, s.minDurationMs]);
    const row = rows[0];
    row.just_confirmed =
        row.is_confirmed &&
            new Date(row.last_seen_at).getTime() === now.getTime() &&
            (await wasJustConfirmed(client, row.id, now));
    return row;
}
/** confirmed_at trùng đúng `now` của lần gọi này => episode vừa được confirm ở bước UPSERT trên. */
async function wasJustConfirmed(client, eventId, now) {
    const { rows } = await client.query(`SELECT confirmed_at = $2 AS match FROM proctoring_events WHERE id = $1`, [eventId, now]);
    return rows[0]?.match ?? false;
}
async function closeOrDiscardEpisode(client, attemptId, eventType, now) {
    const { rows: confirmedRows } = await client.query(`UPDATE proctoring_events
       SET ended_at = $3, last_seen_at = $3
     WHERE attempt_id = $1 AND event_type = $2 AND ended_at IS NULL AND is_confirmed = TRUE
     RETURNING id, event_type, severity, started_at, last_seen_at, sample_count, is_confirmed`, [attemptId, eventType, now]);
    if (confirmedRows[0])
        return confirmedRows[0];
    await client.query(`DELETE FROM proctoring_events
      WHERE attempt_id = $1 AND event_type = $2 AND ended_at IS NULL AND is_confirmed = FALSE`, [attemptId, eventType]);
    return null;
}
function toClosedEpisode(row, now, wasConfirmed) {
    const ended = row['ended_at'] ? new Date(row.ended_at) : now;
    return {
        id: row.id,
        eventType: row.event_type,
        severity: row.severity,
        startedAt: new Date(row.started_at),
        endedAt: ended,
        durationMs: ended.getTime() - new Date(row.started_at).getTime(),
        wasConfirmed,
    };
}
/**
 * Gọi định kỳ để tự đóng các episode "mồ côi"
 */
async function closeStaleEpisodes(client, attemptId, staleAfterMs, now = new Date()) {
    await client.query(`UPDATE proctoring_events
        SET ended_at = last_seen_at
      WHERE attempt_id = $1 AND ended_at IS NULL AND is_confirmed = TRUE
        AND last_seen_at < $2 - ($3 * INTERVAL '1 millisecond')`, [attemptId, now, staleAfterMs]);
    await client.query(`DELETE FROM proctoring_events
      WHERE attempt_id = $1 AND ended_at IS NULL AND is_confirmed = FALSE
        AND last_seen_at < $2 - ($3 * INTERVAL '1 millisecond')`, [attemptId, now, staleAfterMs]);
}
//# sourceMappingURL=event-tracker.js.map