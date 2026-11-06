// src/services/proctoring/stats.service.ts
import { query, queryOne } from '../../config/database.js';
import { HttpError } from '../../utils/http-error.js';
import { BEHAVIOR_META, cameraGapThresholdMs, resolveProctoringSettings, type BehaviorType } from './policy.js';
import { mapSettingsRow } from '../exam/exam.service.js';

export interface BehaviorStat {
  type: BehaviorType;
  messageVi: string;
  count: number;
  totalDurationSec: number;
}

export const EVENT_TITLE_VI: Record<BehaviorType, string> = {
  head_turn_left: 'Quay đầu sang trái',
  head_turn_right: 'Quay đầu sang phải',
  head_pitch_up: 'Ngẩng đầu lệch khung nhìn',
  head_pitch_down: 'Cúi đầu xuống dưới',
  gaze_left: 'Ánh mắt nhìn lệch trái',
  gaze_right: 'Ánh mắt nhìn lệch phải',
  gaze_up: 'Ánh mắt nhìn lên trên',
  gaze_down: 'Ánh mắt nhìn xuống dưới',
  no_face: 'Không thấy khuôn mặt trong khung hình',
  multiple_faces: 'Phát hiện nhiều khuôn mặt',
  identity_mismatch: 'Khuôn mặt không khớp người dự thi',
  object_cell_phone: 'Phát hiện điện thoại di động',
  object_book: 'Phát hiện tài liệu / sách vở',
  object_laptop: 'Phát hiện laptop / thiết bị phụ',
  object_tv: 'Phát hiện màn hình phụ',
  object_headphone: 'Phát hiện tai nghe',
  extra_person: 'Phát hiện người lạ trong khung hình',
  tab_hidden: 'Rời khỏi tab làm bài',
  window_blur: 'Cửa sổ làm bài mất tiêu điểm',
  fullscreen_exit: 'Thoát chế độ toàn màn hình',
  camera_lost: 'Mất tín hiệu camera',
};

/** Đúng dữ liệu cho card "Quay đầu TRÁI 5 lần · 23 giây" trong Nhật ký Vi phạm. */
export async function getAttemptBehaviorStats(attemptId: number): Promise<BehaviorStat[]> {
  const rows = await query<{ event_type: string; cnt: string; total_ms: string }>(
    `SELECT event_type, COUNT(*)::text AS cnt, SUM(duration_ms)::text AS total_ms
       FROM proctoring_events
      WHERE attempt_id = $1 AND is_confirmed = TRUE
      GROUP BY event_type`,
    [attemptId],
  );
  return rows.map((r) => ({
    type: r.event_type as BehaviorType,
    messageVi: BEHAVIOR_META[r.event_type as BehaviorType]?.messageVi ?? r.event_type,
    count: Number(r.cnt),
    totalDurationSec: Math.round(Number(r.total_ms || '0') / 100) / 10,
  }));
}

/** Timeline cho biểu đồ thanh ngang theo thời gian làm bài (mục "Nhật ký Vi phạm"). */
export async function getAttemptTimeline(attemptId: number) {
  return query(
    `SELECT id, event_type, severity, started_at, ended_at, duration_ms, review_status
       FROM proctoring_events WHERE attempt_id = $1 AND is_confirmed = TRUE
      ORDER BY started_at`,
    [attemptId],
  );
}

function buildViolationDetails(row: any) {
  const payload = row.ai_payload ?? {};
  const primary = payload?.primary ?? null;
  const headPose = primary?.headPose ?? null;
  const gaze = primary?.gaze ?? null;
  const objects: Array<{ cls: string; conf: number }> = Array.isArray(payload?.objects) ? payload.objects : [];
  const topObj = objects.length > 0 ? [...objects].sort((a, b) => (b.conf ?? 0) - (a.conf ?? 0))[0] : null;

  const parts: string[] = [];
  if (row.sample_count) parts.push(`${row.sample_count} mẫu xác nhận`);
  if (String(row.event_type).startsWith('gaze_') && gaze && typeof gaze.yaw === 'number' && typeof gaze.pitch === 'number') {
    parts.push(`Gaze Yaw ${gaze.yaw >= 0 ? '+' : ''}${gaze.yaw.toFixed(1)}°, Pitch ${gaze.pitch >= 0 ? '+' : ''}${gaze.pitch.toFixed(1)}°`);
  } else if (headPose && typeof headPose.yaw === 'number' && typeof headPose.pitch === 'number') {
    parts.push(`Yaw ${headPose.yaw >= 0 ? '+' : ''}${headPose.yaw.toFixed(1)}°, Pitch ${headPose.pitch >= 0 ? '+' : ''}${headPose.pitch.toFixed(1)}°`);
  } else if (row.peak_value !== null && row.peak_value !== undefined) {
    if (String(row.event_type).startsWith('head_') || String(row.event_type).startsWith('gaze_')) {
      parts.push(`Biên độ cực đại ${Number(row.peak_value).toFixed(1)}°`);
    } else if (String(row.event_type) === 'identity_mismatch') {
      const sim = Math.max(0, 1 - Number(row.peak_value));
      parts.push(`Độ tương đồng khuôn mặt ${(sim * 100).toFixed(0)}%`);
    } else if (String(row.event_type).startsWith('object_')) {
      parts.push(`Độ tin cậy ${(Number(row.peak_value) * 100).toFixed(0)}%`);
    }
  }
  if (topObj) {
    parts.push(`Vật thể: ${topObj.cls} (${Math.round((topObj.conf ?? 0) * 100)}%)`);
  }

  return {
    yaw: typeof headPose?.yaw === 'number' ? Number(headPose.yaw.toFixed(1)) : undefined,
    pitch: typeof headPose?.pitch === 'number' ? Number(headPose.pitch.toFixed(1)) : undefined,
    similarity: typeof primary?.similarity === 'number' ? Number(primary.similarity.toFixed(3)) : undefined,
    detected_object: topObj?.cls,
    confidence: typeof topObj?.conf === 'number' ? Number(topObj.conf.toFixed(2)) : undefined,
    inference_ms: typeof payload?.inferenceMs === 'number' ? payload.inferenceMs : undefined,
    model_versions: payload?.modelVersions ?? undefined,
    description: parts.join(' • ') || (BEHAVIOR_META[row.event_type as BehaviorType]?.messageVi ?? ''),
  };
}

/** Danh sách vi phạm + thống kê thật từ DB cho trang Nhật ký Vi phạm. */
export async function listExamViolations(examId: number, filters: { onlyFlagged?: boolean }) {
  const exam = await queryOne<any>(
    `SELECT e.id, e.class_id, c.name AS class_name, e.name, e.duration_minutes, e.start_time, e.end_time,
            (SELECT COUNT(*) FROM classes_n_students cs WHERE cs.class_id = e.class_id)::int AS total_enrolled
       FROM exams e
       JOIN classes c ON c.id = e.class_id
      WHERE e.id = $1`,
    [examId],
  );
  if (!exam) throw new HttpError(404, 'Không tìm thấy đề thi');

  const rows = await query<any>(
    `SELECT a.id AS attempt_id, u.name AS student_name, u.id AS student_id,
            COALESCE(ul.login_id, '') AS student_code,
            pe.id AS event_id, pe.event_type, pe.severity, pe.started_at, pe.ended_at,
            pe.duration_ms, pe.sample_count, pe.peak_value, pe.review_status, pe.review_note,
            ev.id AS evidence_id, ev.ai_payload
       FROM exam_attempts a
       JOIN users u ON u.id = a.student_id
       LEFT JOIN user_login_id ul ON ul.user_id = u.id
       JOIN proctoring_events pe ON pe.attempt_id = a.id AND pe.is_confirmed = TRUE
       LEFT JOIN LATERAL (
         SELECT id, ai_payload
           FROM proctoring_evidence
          WHERE event_id = pe.id AND deleted_at IS NULL
          ORDER BY captured_at ASC
          LIMIT 1
       ) ev ON TRUE
      WHERE a.exam_id = $1
      ORDER BY pe.started_at DESC`,
    [examId],
  );

  const filteredRows = filters.onlyFlagged ? rows.filter((r) => r.review_status !== 'dismissed') : rows;

  const violations = filteredRows.map((r) => ({
    id: String(r.event_id),
    event_id: r.event_id,
    attempt_id: String(r.attempt_id),
    student_id: String(r.student_id),
    student_name: r.student_name,
    student_code: r.student_code,
    event_type: r.event_type as BehaviorType,
    event_label: EVENT_TITLE_VI[r.event_type as BehaviorType] ?? r.event_type,
    severity: r.severity as 'info' | 'warning' | 'critical',
    timestamp: r.started_at,
    ended_at: r.ended_at,
    duration_ms: r.duration_ms ?? 0,
    duration_seconds: Math.round(Number(r.duration_ms ?? 0) / 100) / 10,
    sample_count: r.sample_count,
    review_status: r.review_status as 'pending' | 'confirmed_cheating' | 'dismissed',
    review_note: r.review_note ?? null,
    evidence_id: r.evidence_id ?? null,
    details: buildViolationDetails(r),
  }));

  // Tính thống kê cơ cấu nhóm hành vi THẬT từ tất cả các sự kiện chưa bị dismissed
  const activeEvents = rows.filter((r) => r.review_status !== 'dismissed');
  const totalActive = activeEvents.length;
  const catDefs: Array<{ key: string; label: string; color: string; match: (t: string) => boolean }> = [
    {
      key: 'head_pose',
      label: 'Quay đầu lệch góc (Yaw / Pitch)',
      color: 'blue',
      match: (t) => t.startsWith('head_'),
    },
    {
      key: 'gaze',
      label: 'Ánh mắt ra ngoài (Gaze vector)',
      color: 'green',
      match: (t) => t.startsWith('gaze_'),
    },
    {
      key: 'objects',
      label: 'Phát hiện vật thể cấm (YOLOv8)',
      color: 'orange',
      match: (t) => t.startsWith('object_') || t === 'extra_person',
    },
    {
      key: 'face_identity',
      label: 'Vắng mặt / Nhiều mặt / Sai danh tính',
      color: 'red',
      match: (t) => t === 'no_face' || t === 'multiple_faces' || t === 'identity_mismatch',
    },
    {
      key: 'browser',
      label: 'Rời tab / Toàn màn hình / Mất camera',
      color: 'purple',
      match: (t) => t === 'tab_hidden' || t === 'window_blur' || t === 'fullscreen_exit' || t === 'camera_lost',
    },
  ];

  const categories = catDefs.map((def) => {
    const matched = activeEvents.filter((e) => def.match(e.event_type));
    const count = matched.length;
    const totalDurationSec = Math.round(
      matched.reduce((acc, e) => acc + Number(e.duration_ms ?? 0), 0) / 100,
    ) / 10;
    const percentage = totalActive > 0 ? Math.round((count / totalActive) * 100) : 0;
    return { key: def.key, label: def.label, color: def.color, count, percentage, totalDurationSec };
  });

  // Timeline buckets (chia theo khung 5 phút dựa trên các sự kiện thật)
  const bucketMap = new Map<number, { label: string; total: number; critical: number; warning: number; info: number }>();
  if (activeEvents.length > 0) {
    const sorted = [...activeEvents].sort(
      (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
    );
    const baseMs = Math.floor(new Date(sorted[0].started_at).getTime() / 300_000) * 300_000;
    for (const ev of sorted) {
      const slot = Math.floor((new Date(ev.started_at).getTime() - baseMs) / 300_000) * 300_000 + baseMs;
      const cur = bucketMap.get(slot) ?? {
        label: new Date(slot).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        total: 0,
        critical: 0,
        warning: 0,
        info: 0,
      };
      cur.total += 1;
      if (ev.severity === 'critical') cur.critical += 1;
      else if (ev.severity === 'warning') cur.warning += 1;
      else cur.info += 1;
      bucketMap.set(slot, cur);
    }
  }

  // Số liệu sức khỏe AI thật của đề thi (tách biệt hoàn toàn với vi phạm của thí sinh)
  const aiHealth = await queryOne<{ total_frames: number; total_ai_errors: number }>(
    `SELECT COALESCE(SUM(frame_count), 0)::int AS total_frames,
            COALESCE(SUM(ai_error_count), 0)::int AS total_ai_errors
       FROM exam_attempts WHERE exam_id = $1`,
    [examId],
  );

  return {
    exam,
    violations,
    analytics: {
      total_events: rows.length,
      active_events: totalActive,
      pending_count: rows.filter((r) => r.review_status === 'pending').length,
      confirmed_cheating_count: rows.filter((r) => r.review_status === 'confirmed_cheating').length,
      dismissed_count: rows.filter((r) => r.review_status === 'dismissed').length,
      categories,
      timeline_buckets: Array.from(bucketMap.values()),
      ai_health: {
        total_frames: aiHealth?.total_frames ?? 0,
        total_ai_errors: aiHealth?.total_ai_errors ?? 0,
      },
    },
  };
}

/** Trạng thái tổng quan đầy đủ cho màn hình Giám sát Trực tiếp (Live Monitor). */
export async function getLiveMonitorGrid(examId: number) {
  const exam = await queryOne<any>(
    `SELECT e.id, e.class_id, c.name AS class_name, e.name, e.description,
            e.duration_minutes, e.start_time, e.end_time, e.status,
            (SELECT COUNT(*) FROM classes_n_students cs WHERE cs.class_id = e.class_id)::int AS total_enrolled,
            (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id)::int AS total_questions,
            eps.*
       FROM exams e
       JOIN classes c ON c.id = e.class_id
       LEFT JOIN exam_proctoring_settings eps ON eps.exam_id = e.id
      WHERE e.id = $1`,
    [examId],
  );
  if (!exam) throw new HttpError(404, 'Không tìm thấy đề thi');

  const settings = exam.enabled !== undefined ? mapSettingsRow(exam) : resolveProctoringSettings({});
  const staleMs = cameraGapThresholdMs(settings);

  const attemptRows = await query<any>(
    `SELECT a.id AS attempt_id, u.id AS student_id, u.name AS student_name,
            COALESCE(ul.login_id, '') AS student_code,
            a.status AS attempt_status, a.submit_reason,
            a.started_at, a.submitted_at, a.last_frame_at, a.deadline_at,
            a.total_score, a.max_score, a.frame_count, a.ai_error_count,
            (a.last_frame_at IS NOT NULL OR a.reference_photo_path IS NOT NULL) AS has_snapshot,
            (SELECT COUNT(*) FROM attempt_answers aa
              WHERE aa.attempt_id = a.id
                AND (COALESCE(array_length(aa.selected_option_ids, 1), 0) > 0
                     OR COALESCE(NULLIF(TRIM(aa.text_answer), ''), aa.file_path) IS NOT NULL))::int AS progress_answered,
            (SELECT COUNT(*) FROM proctoring_events pe
              WHERE pe.attempt_id = a.id AND pe.is_confirmed = TRUE)::int AS violation_count,
            (SELECT COUNT(*) FROM proctoring_events pe
              WHERE pe.attempt_id = a.id AND pe.is_confirmed = TRUE
                AND pe.severity = 'critical' AND pe.started_at > NOW() - INTERVAL '2 minutes')::int AS recent_critical_count,
            (SELECT COUNT(*) FROM proctoring_events pe
              WHERE pe.attempt_id = a.id AND pe.is_confirmed = TRUE
                AND pe.started_at > NOW() - INTERVAL '2 minutes')::int AS recent_any_count,
            (SELECT pe.event_type FROM proctoring_events pe
              WHERE pe.attempt_id = a.id AND pe.is_confirmed = TRUE
              ORDER BY pe.started_at DESC LIMIT 1) AS last_violation_type
       FROM exam_attempts a
       JOIN users u ON u.id = a.student_id
       LEFT JOIN user_login_id ul ON ul.user_id = u.id
      WHERE a.exam_id = $1
      ORDER BY CASE WHEN a.status = 'in_progress' THEN 0 ELSE 1 END, u.name`,
    [examId],
  );

  const nowMs = Date.now();
  const candidates = attemptRows.map((r) => {
    const lastFrameMs = r.last_frame_at ? new Date(r.last_frame_at).getTime() : null;
    const isInProgress = r.attempt_status === 'in_progress';
    const cameraActive = Boolean(isInProgress && lastFrameMs && (nowMs - lastFrameMs) <= staleMs);
    const cameraStale = Boolean(isInProgress && settings.enabled && (!lastFrameMs || (nowMs - lastFrameMs) > staleMs));

    const alertStatus: 'normal' | 'warning' | 'critical' =
      r.recent_critical_count > 0
        ? 'critical'
        : r.recent_any_count > 0 || (isInProgress && r.violation_count > 0)
          ? 'warning'
          : 'normal';

    const lastType = r.last_violation_type as BehaviorType | null;

    return {
      attempt_id: String(r.attempt_id),
      student_id: String(r.student_id),
      student_name: r.student_name,
      student_code: r.student_code,
      attempt_status: r.attempt_status as 'in_progress' | 'submitted',
      submit_reason: r.submit_reason ?? null,
      camera_active: cameraActive,
      camera_stale: cameraStale,
      has_snapshot: Boolean(r.has_snapshot),
      last_frame_at: r.last_frame_at,
      status: alertStatus,
      violation_count: r.violation_count,
      recent_critical_count: r.recent_critical_count,
      recent_any_count: r.recent_any_count,
      last_violation_type: lastType,
      last_violation_label: lastType ? (EVENT_TITLE_VI[lastType] ?? lastType) : undefined,
      start_time: r.started_at,
      submitted_at: r.submitted_at,
      deadline_at: r.deadline_at,
      progress_answered: r.progress_answered,
      total_questions: exam.total_questions,
      frame_count: r.frame_count,
      ai_error_count: r.ai_error_count,
    };
  });

  const recentEventRows = await query<any>(
    `SELECT pe.id, pe.attempt_id, pe.event_type, pe.severity, pe.started_at,
            u.name AS student_name, COALESCE(ul.login_id, '') AS student_code
       FROM proctoring_events pe
       JOIN exam_attempts a ON a.id = pe.attempt_id
       JOIN users u ON u.id = a.student_id
       LEFT JOIN user_login_id ul ON ul.user_id = u.id
      WHERE a.exam_id = $1 AND pe.is_confirmed = TRUE
      ORDER BY pe.started_at DESC
      LIMIT 50`,
    [examId],
  );

  const recent_events = recentEventRows.map((ev) => ({
    id: String(ev.id),
    attempt_id: String(ev.attempt_id),
    timestamp: ev.started_at,
    student_name: ev.student_name,
    student_code: ev.student_code,
    type: ev.event_type,
    severity: ev.severity as 'info' | 'warning' | 'critical',
    message: BEHAVIOR_META[ev.event_type as BehaviorType]?.messageVi ?? ev.event_type,
  }));

  const inProgressCount = candidates.filter((c) => c.attempt_status === 'in_progress').length;
  const submittedCount = candidates.filter((c) => c.attempt_status === 'submitted').length;
  const warningCount = candidates.filter((c) => c.attempt_status === 'in_progress' && c.status !== 'normal').length;
  const aiErrorTotal = candidates.reduce((acc, c) => acc + Number(c.ai_error_count ?? 0), 0);

  return {
    exam: {
      id: exam.id,
      class_id: exam.class_id,
      class_name: exam.class_name,
      name: exam.name,
      title: exam.name,
      duration_minutes: exam.duration_minutes,
      start_time: exam.start_time,
      end_time: exam.end_time,
      status: exam.status,
      total_enrolled: exam.total_enrolled,
      total_questions: exam.total_questions,
      proctoring_enabled: settings.enabled,
      frame_interval_ms: settings.frameIntervalMs,
    },
    summary: {
      total_enrolled: exam.total_enrolled,
      in_progress_count: inProgressCount,
      submitted_count: submittedCount,
      warning_count: warningCount,
      ai_error_total: aiErrorTotal,
    },
    candidates,
    recent_events,
  };
}
