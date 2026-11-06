// src/services/proctoring/ingestion.service.ts
import { randomUUID } from 'node:crypto';
import { withTransaction, queryOne, query } from '../../config/database.js';
import { HttpError } from '../../utils/http-error.js';
import { analyzeFrame, AiServiceError } from './ai-client.js';
import {
  evaluateAnalysis, buildRunFlags, cameraGapThresholdMs, degradedModules, BEHAVIOR_META,
  type BehaviorType,
} from './policy.js';
import { mapSettingsRow } from '../exam/exam.service.js';
import { applyBehaviorSamples, closeStaleEpisodes } from './event-tracker.js';
import { saveEvidenceImage, saveLatestAttemptFrame } from './storage.js';
import { submitAttempt } from '../exam/attempt.service.js';
import {
  broadcastViolation, broadcastAttemptStatus, broadcastAiStatus, broadcastFrameHeartbeat,
  getMonitorIo, type SupervisorNoticePayload,
} from '../../sockets/monitor.socket.js';

/**
 * Trạng thái AI trả cho frontend — luôn phân biệt rõ:
 *  ok       : AI phân tích hợp lệ (có thể không có warning)
 *  degraded : AI lỗi/quá tải/thiếu model cho frame này => KHÔNG kết luận gì về thí sinh
 *  dropped  : frame bị bỏ vì frame trước của attempt vẫn đang xử lý (latest-frame)
 *  disabled : đề thi không bật giám sát
 */
export type AiStatus = 'ok' | 'degraded' | 'dropped' | 'disabled';

export const BROWSER_EVENT_TYPES = ['tab_hidden', 'window_blur', 'fullscreen_exit', 'camera_lost'] as const;
export type BrowserEventType = (typeof BROWSER_EVENT_TYPES)[number];

export interface IngestionResult {
  warnings: Array<{ type: string; severity: string; messageVi: string }>;
  shouldAutoSubmit: boolean;
  aiStatus: AiStatus;
  aiError?: { code: string; message: string; modules?: string[] };
  requestId: string;
  inferenceMs?: number;
  /** Số vi phạm nghiêm trọng đã xác nhận / ngưỡng tự nộp — số liệu thật từ DB, FE không tự bịa. */
  violationSummary?: { criticalConfirmed: number; autoSubmitThreshold: number | null; totalConfirmed: number };
  /** Thông báo mới nhất từ giám thị (fallback cho HTTP polling nếu socket tạm ngắt). */
  supervisorNotice?: SupervisorNoticePayload;
}

// ---------------------------------------------------------------------------
// Latest-frame: tối đa 1 frame đang xử lý cho mỗi attempt. Frame đến khi đang bận bị đếm `dropped`.
// ---------------------------------------------------------------------------
const inFlight = new Set<number>();
const metrics = {
  received: 0,
  processed: 0,
  dropped: 0,
  aiDegraded: 0,
  browserEvents: 0,
  aiLatencyMs: [] as number[],
};
const lastDegradeBroadcast = new Map<number, number>();
const lastHeartbeatBroadcast = new Map<number, number>();
const pendingNoticesByAttempt = new Map<number, SupervisorNoticePayload>();
const DEGRADE_BROADCAST_INTERVAL_MS = 30_000;
const HEARTBEAT_BROADCAST_INTERVAL_MS = 3_000;

export function queueSupervisorNotice(attemptId: number, notice: SupervisorNoticePayload) {
  pendingNoticesByAttempt.set(attemptId, notice);
}

function drainSupervisorNotice(attemptId: number): SupervisorNoticePayload | undefined {
  const notice = pendingNoticesByAttempt.get(attemptId);
  if (notice) pendingNoticesByAttempt.delete(attemptId);
  return notice;
}

export function getIngestionMetrics() {
  const lat = [...metrics.aiLatencyMs].sort((a, b) => a - b);
  const pct = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.round((p / 100) * (lat.length - 1)))] : null);
  return {
    received: metrics.received, processed: metrics.processed, dropped: metrics.dropped,
    aiDegraded: metrics.aiDegraded, browserEvents: metrics.browserEvents, inFlight: inFlight.size,
    aiLatencyMs: { p50: pct(50), p95: pct(95), p99: pct(99) },
  };
}

export async function ingestFrame(attemptId: number, imageBuffer: Buffer, requestId: string): Promise<IngestionResult> {
  metrics.received += 1;

  if (inFlight.has(attemptId)) {
    metrics.dropped += 1;
    const notice = drainSupervisorNotice(attemptId);
    return {
      warnings: [], shouldAutoSubmit: false, aiStatus: 'dropped', requestId,
      ...(notice ? { supervisorNotice: notice } : {}),
    };
  }
  inFlight.add(attemptId);
  try {
    return await processFrame(attemptId, imageBuffer, requestId);
  } finally {
    inFlight.delete(attemptId);
  }
}

async function loadAttemptContext(attemptId: number) {
  return queryOne<any>(
    `SELECT a.*, u.name AS student_name, COALESCE(ul.login_id, '') AS student_code,
            (SELECT COUNT(*) FROM attempt_answers aa
              WHERE aa.attempt_id = a.id
                AND (COALESCE(array_length(aa.selected_option_ids, 1), 0) > 0
                     OR COALESCE(NULLIF(TRIM(aa.text_answer), ''), aa.file_path) IS NOT NULL))::int AS progress_answered,
            (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = a.exam_id)::int AS total_questions
       FROM exam_attempts a
       JOIN users u ON u.id = a.student_id
       LEFT JOIN user_login_id ul ON ul.user_id = u.id
      WHERE a.id = $1`,
    [attemptId],
  );
}

async function computeViolationSummary(attemptId: number, autoSubmitThreshold: number | null) {
  const counts = await queryOne<{ crit: string; total: string }>(
    `SELECT COUNT(*) FILTER (WHERE severity = 'critical')::text AS crit, COUNT(*)::text AS total
       FROM proctoring_events WHERE attempt_id = $1 AND is_confirmed = TRUE`,
    [attemptId],
  );
  return {
    criticalConfirmed: Number(counts?.crit ?? '0'),
    totalConfirmed: Number(counts?.total ?? '0'),
    autoSubmitThreshold,
  };
}

async function processFrame(attemptId: number, imageBuffer: Buffer, requestId: string): Promise<IngestionResult> {
  const attempt = await loadAttemptContext(attemptId);
  if (!attempt) throw new HttpError(404, 'Không tìm thấy lần làm bài');
  const supervisorNotice = drainSupervisorNotice(attemptId);

  if (attempt.status !== 'in_progress') {
    return {
      warnings: [],
      shouldAutoSubmit: true,
      aiStatus: 'disabled',
      requestId,
      ...(supervisorNotice ? { supervisorNotice } : {}),
    };
  }

  const settingsRow = await queryOne('SELECT * FROM exam_proctoring_settings WHERE exam_id = $1', [attempt.exam_id]);
  const settings = mapSettingsRow(settingsRow);
  if (!settings.enabled) {
    return {
      warnings: [], shouldAutoSubmit: false, aiStatus: 'disabled', requestId,
      ...(supervisorNotice ? { supervisorNotice } : {}),
    };
  }

  // Lưu snapshot mới nhất (1 file ghi đè / attempt) để màn hình Live Monitor hiển thị hình thật của thí sinh
  await saveLatestAttemptFrame(attemptId, imageBuffer).catch((err) => {
    console.warn(`[ingestion] Không lưu được latest frame cho attempt=${attemptId}:`, err);
  });

  const now = new Date();
  const io = getMonitorIo();

  // Tự đóng episode "mồ côi" nếu khoảng cách so với frame trước quá xa
  if (attempt.last_frame_at) {
    const gapMs = now.getTime() - new Date(attempt.last_frame_at).getTime();
    if (gapMs > cameraGapThresholdMs(settings)) {
      await withTransaction((client) => closeStaleEpisodes(client, attemptId, 0, new Date(attempt.last_frame_at)));
    }
  }

  const identityCheckDue = !attempt.last_identity_check_at ||
    (now.getTime() - new Date(attempt.last_identity_check_at).getTime()) >= settings.identityRecheckIntervalSec * 1000;

  const defaultObjectStride = settings.frameIntervalMs < 2000 ? 2 : 1;
  const objectStride = Math.max(1, Number(process.env.AI_OBJECT_EVERY_N_FRAMES ?? defaultObjectStride));
  const objectDue = (Number(attempt.frame_count ?? 0) % objectStride) === 0;

  const run = buildRunFlags(settings, !!attempt.reference_embedding, identityCheckDue, objectDue);

  let analysis;
  try {
    analysis = await analyzeFrame({ imageBuffer, referenceEmbedding: attempt.reference_embedding, run, requestId });
  } catch (err) {
    // Lỗi AI KHÔNG phải vi phạm của thí sinh: không phát mẫu hành vi, không đóng/mở episode.
    const code = err instanceof AiServiceError ? err.code : 'AI_UNKNOWN';
    const message = err instanceof Error ? err.message : 'Lỗi AI không xác định';
    metrics.aiDegraded += 1;
    await query(
      'UPDATE exam_attempts SET ai_error_count = ai_error_count + 1, last_frame_at = $2 WHERE id = $1',
      [attemptId, now],
    );
    console.error(`[ingestion] req=${requestId} attempt=${attemptId} AI lỗi (${code}): ${message}`);
    notifyDegraded(io, attempt.exam_id, attemptId, attempt.student_id, code, message);
    emitHeartbeatThrottled(io, attempt.exam_id, {
      attemptId,
      lastFrameAt: now.toISOString(),
      progressAnswered: Number(attempt.progress_answered ?? 0),
      totalQuestions: Number(attempt.total_questions ?? 0),
      faceCount: null,
      aiStatus: 'degraded',
    });
    return {
      warnings: [], shouldAutoSubmit: false, aiStatus: 'degraded', requestId,
      aiError: { code, message: 'Hệ thống giám sát AI tạm thời không phân tích được. Bài làm của bạn không bị ảnh hưởng.' },
      ...(supervisorNotice ? { supervisorNotice } : {}),
    };
  }

  metrics.processed += 1;
  metrics.aiLatencyMs.push(analysis.inferenceMs);
  if (metrics.aiLatencyMs.length > 500) metrics.aiLatencyMs.shift();

  const degraded = degradedModules(analysis, run);
  if (degraded.length) {
    metrics.aiDegraded += 1;
    console.error(`[ingestion] req=${requestId} attempt=${attemptId} module lỗi: ${JSON.stringify(analysis.moduleErrors)}`);
    notifyDegraded(io, attempt.exam_id, attemptId, attempt.student_id, 'AI_MODULE_DEGRADED', degraded.join(','));
  }

  const samples = evaluateAnalysis(analysis, settings, run);
  const identityChecked = run.identity && analysis.moduleStatus.identity === 'ok';

  const { newlyConfirmed } = await withTransaction(async (client) => {
    const r = await applyBehaviorSamples(client, attemptId, samples, now);

    await client.query(
      `UPDATE exam_attempts SET last_frame_at=$2, frame_count = frame_count + 1
         ${identityChecked ? ', last_identity_check_at = $2' : ''} WHERE id=$1`,
      [attemptId, now],
    );

    // Lưu ảnh bằng chứng cho MỖI episode vừa được xác nhận lần đầu
    for (const ev of r.newlyConfirmed) {
      const relPath = await saveEvidenceImage(attemptId, imageBuffer);
      const expiresAt = new Date(now.getTime() + settings.evidenceRetentionDays * 86400_000);
      await client.query(
        `INSERT INTO proctoring_evidence (event_id, attempt_id, file_path, size_bytes, captured_at, expires_at, ai_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [ev.id, attemptId, relPath, imageBuffer.length, now, expiresAt, JSON.stringify({
          requestId, inferenceMs: analysis.inferenceMs, modelVersions: analysis.modelVersions,
          faceCount: analysis.faceCount, moduleStatus: analysis.moduleStatus,
          primary: analysis.primary, objects: analysis.objects,
        })],
      );
    }
    return r;
  });

  emitHeartbeatThrottled(io, attempt.exam_id, {
    attemptId,
    lastFrameAt: now.toISOString(),
    progressAnswered: Number(attempt.progress_answered ?? 0),
    totalQuestions: Number(attempt.total_questions ?? 0),
    faceCount: analysis.faceCount,
    aiStatus: degraded.length ? 'degraded' : 'ok',
  });

  const violationSummary = await computeViolationSummary(
    attemptId,
    settings.violationAction === 'auto_submit' ? settings.autoSubmitAfterViolations : null,
  );

  const warnings = newlyConfirmed.map((ev) => ({
    id: ev.id,
    type: ev.eventType,
    severity: ev.severity,
    messageVi: BEHAVIOR_META[ev.eventType as BehaviorType]?.messageVi ?? ev.eventType,
  }));

  // Broadcast realtime events to lecturer monitor room via Socket.IO
  for (const w of warnings) {
    broadcastViolation(io, attempt.exam_id, {
      eventId: w.id,
      attemptId,
      studentId: attempt.student_id,
      studentName: attempt.student_name,
      studentCode: attempt.student_code,
      eventType: w.type,
      severity: w.severity,
      messageVi: w.messageVi,
      occurredAt: now.toISOString(),
      violationCount: violationSummary.totalConfirmed,
    });
  }

  let shouldAutoSubmit = false;
  if (settings.violationAction === 'auto_submit' && newlyConfirmed.some((e) => e.severity === 'critical')
      && violationSummary.criticalConfirmed >= settings.autoSubmitAfterViolations) {
    shouldAutoSubmit = true;
    await submitAttempt(attemptId, 'proctoring');
    broadcastAttemptStatus(io, attempt.exam_id, { attemptId, status: 'submitted', submitReason: 'proctoring' });
  }

  return {
    warnings: warnings.map(({ type, severity, messageVi }) => ({ type, severity, messageVi })),
    shouldAutoSubmit,
    requestId,
    inferenceMs: analysis.inferenceMs,
    violationSummary,
    aiStatus: degraded.length ? 'degraded' : 'ok',
    ...(degraded.length ? { aiError: { code: 'AI_MODULE_DEGRADED', message: 'Một số chức năng giám sát AI tạm thời không hoạt động.', modules: degraded } } : {}),
    ...(supervisorNotice ? { supervisorNotice } : {}),
  };
}

/** Ghi nhận sự kiện trình duyệt (rời tab, mất focus, thoát fullscreen, mất camera) theo mô hình episode. */
export async function ingestBrowserEvent(
  attemptId: number,
  eventType: BrowserEventType,
  active: boolean,
  requestId: string = randomUUID(),
): Promise<IngestionResult> {
  if (!BROWSER_EVENT_TYPES.includes(eventType)) {
    throw new HttpError(400, 'Loại sự kiện trình duyệt không hợp lệ');
  }
  const attempt = await loadAttemptContext(attemptId);
  if (!attempt) throw new HttpError(404, 'Không tìm thấy lần làm bài');
  if (attempt.status !== 'in_progress') {
    return { warnings: [], shouldAutoSubmit: true, aiStatus: 'disabled', requestId };
  }

  const settingsRow = await queryOne('SELECT * FROM exam_proctoring_settings WHERE exam_id = $1', [attempt.exam_id]);
  const settings = mapSettingsRow(settingsRow);
  if (!settings.enabled) {
    return { warnings: [], shouldAutoSubmit: false, aiStatus: 'disabled', requestId };
  }
  if (eventType !== 'camera_lost' && !settings.detectTabSwitch) {
    return { warnings: [], shouldAutoSubmit: false, aiStatus: 'ok', requestId };
  }

  metrics.browserEvents += 1;
  const now = new Date();
  const meta = BEHAVIOR_META[eventType];
  const { newlyConfirmed } = await withTransaction((client) =>
    applyBehaviorSamples(client, attemptId, [{
      type: eventType,
      active,
      severity: meta.severity,
      minSamples: meta.minSamples,
      minDurationMs: 0,
    }], now),
  );

  const violationSummary = await computeViolationSummary(
    attemptId,
    settings.violationAction === 'auto_submit' ? settings.autoSubmitAfterViolations : null,
  );
  const io = getMonitorIo();

  const warnings = newlyConfirmed.map((ev) => ({
    id: ev.id,
    type: ev.eventType,
    severity: ev.severity,
    messageVi: BEHAVIOR_META[ev.eventType as BehaviorType]?.messageVi ?? ev.eventType,
  }));

  for (const w of warnings) {
    broadcastViolation(io, attempt.exam_id, {
      eventId: w.id,
      attemptId,
      studentId: attempt.student_id,
      studentName: attempt.student_name,
      studentCode: attempt.student_code,
      eventType: w.type,
      severity: w.severity,
      messageVi: w.messageVi,
      occurredAt: now.toISOString(),
      violationCount: violationSummary.totalConfirmed,
    });
  }

  return {
    warnings: warnings.map(({ type, severity, messageVi }) => ({ type, severity, messageVi })),
    shouldAutoSubmit: false,
    aiStatus: 'ok',
    requestId,
    violationSummary,
  };
}

function notifyDegraded(io: ReturnType<typeof getMonitorIo>, examId: number, attemptId: number, studentId: number, code: string, detail: string) {
  const last = lastDegradeBroadcast.get(examId) ?? 0;
  if (Date.now() - last < DEGRADE_BROADCAST_INTERVAL_MS) return;
  lastDegradeBroadcast.set(examId, Date.now());
  broadcastAiStatus(io, examId, { attemptId, studentId, status: 'degraded', code, detail, at: new Date().toISOString() });
}

function emitHeartbeatThrottled(
  io: ReturnType<typeof getMonitorIo>,
  examId: number,
  payload: Parameters<typeof broadcastFrameHeartbeat>[2],
) {
  const last = lastHeartbeatBroadcast.get(payload.attemptId) ?? 0;
  if (Date.now() - last < HEARTBEAT_BROADCAST_INTERVAL_MS) return;
  lastHeartbeatBroadcast.set(payload.attemptId, Date.now());
  broadcastFrameHeartbeat(io, examId, payload);
}
