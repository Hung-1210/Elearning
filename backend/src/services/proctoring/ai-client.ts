// src/services/proctoring/ai-client.ts
// Gọi Python AI microservice (FastAPI, schema `proctoring.analyze.v2`).
// Node KHÔNG chạy model — chỉ forward ảnh qua HTTP.
//
// Nguyên tắc: lỗi AI (timeout, down, overload, checkpoint thiếu) được trả về dưới dạng
// AiServiceError có `code` — TUYỆT ĐỐI không biến thành "không phát hiện gì" hay "vi phạm".

import { randomUUID } from 'node:crypto';
import type { AiAnalysis, AiModuleStatus, RunFlags } from './policy.js';

const rawAiUrl = (process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8001').replace(/\/+$/, '');
// Trên Windows, Node fetch('http://localhost:...') có thể ưu tiên IPv6 (::1) gây ECONNREFUSED khi uvicorn lắng nghe IPv4
const AI_SERVICE_URL = rawAiUrl.replace(/^http:\/\/localhost(?=[:/]|$)/i, 'http://127.0.0.1');
const AI_SERVICE_TIMEOUT_MS = Number(process.env.AI_SERVICE_TIMEOUT_MS ?? 8000);
const AI_REGISTER_TIMEOUT_MS = Number(process.env.AI_REGISTER_TIMEOUT_MS ?? 15000);
const AI_MAX_RETRIES = Number(process.env.AI_MAX_RETRIES ?? 1);
const BREAKER_FAILURE_THRESHOLD = Number(process.env.AI_BREAKER_FAILURES ?? 5);
const BREAKER_OPEN_MS = Number(process.env.AI_BREAKER_OPEN_MS ?? 10000);

export const EXPECTED_SCHEMA = 'proctoring.analyze.v2';

export type AiErrorCode =
  | 'AI_UNREACHABLE' | 'AI_TIMEOUT' | 'AI_BUSY' | 'AI_MODEL_UNAVAILABLE'
  | 'AI_BAD_RESPONSE' | 'AI_SCHEMA_MISMATCH' | 'AI_CIRCUIT_OPEN' | 'AI_REJECTED';

export class AiServiceError extends Error {
  constructor(public code: AiErrorCode, message: string, public requestId?: string, public cause?: unknown) {
    super(message);
    this.name = 'AiServiceError';
  }
}

/** Lỗi nghiệp vụ từ AI do ảnh đầu vào (không phải AI hỏng): NO_FACE, MULTIPLE_FACES... */
export class AiInputError extends Error {
  constructor(public code: string, message: string, public requestId?: string) {
    super(message);
    this.name = 'AiInputError';
  }
}

// ---------------------------------------------------------------------------
// Circuit breaker đơn giản: N lỗi hạ tầng liên tiếp => mở trong BREAKER_OPEN_MS
// ---------------------------------------------------------------------------
const breaker = { failures: 0, openUntil: 0 };
let fetchImpl: typeof fetch = fetch;

/** Chỉ dùng cho contract test để mô phỏng HTTP/timeout của AI service mà không cần mở cổng mạng. */
export function setFetchImplForTest(fn: typeof fetch | null) {
  fetchImpl = fn ?? fetch;
}

export function resetBreakerForTest() {
  breaker.failures = 0;
  breaker.openUntil = 0;
}

const isInfraError = (code: AiErrorCode) =>
  code === 'AI_UNREACHABLE' || code === 'AI_TIMEOUT' || code === 'AI_BAD_RESPONSE' || code === 'AI_MODEL_UNAVAILABLE';

function breakerCheck(requestId: string) {
  if (Date.now() < breaker.openUntil) {
    throw new AiServiceError('AI_CIRCUIT_OPEN', 'AI service đang tạm ngắt do lỗi liên tiếp', requestId);
  }
}
function breakerSuccess() { breaker.failures = 0; breaker.openUntil = 0; }
function breakerFailure(code: AiErrorCode) {
  if (!isInfraError(code)) return;
  breaker.failures += 1;
  if (breaker.failures >= BREAKER_FAILURE_THRESHOLD) breaker.openUntil = Date.now() + BREAKER_OPEN_MS;
}
export function getBreakerState() {
  return { failures: breaker.failures, open: Date.now() < breaker.openUntil, openUntil: breaker.openUntil };
}

// ---------------------------------------------------------------------------
// Raw response (snake_case, v2) → AiAnalysis (camelCase)
// ---------------------------------------------------------------------------
interface RawModule { status: string; [k: string]: any }
interface AnalyzeRawResponse {
  schema_version: string;
  request_id: string | null;
  inference_started_at: string;
  completed_at: string;
  inference_ms: number;
  modules: Record<string, RawModule>;
  model_versions: Record<string, string | null>;
  timings_ms: Record<string, number>;
}

const KNOWN_STATUS = new Set<string>([
  'ok', 'not_requested', 'no_face', 'unavailable', 'error', 'skipped_face_unavailable',
]);
const asStatus = (s: unknown): AiModuleStatus =>
  (typeof s === 'string' && KNOWN_STATUS.has(s) ? s : 'error') as AiModuleStatus;

export function parseAnalyzeResponse(raw: AnalyzeRawResponse, requestId: string): AiAnalysis {
  if (raw?.schema_version !== EXPECTED_SCHEMA || !raw.modules) {
    throw new AiServiceError('AI_SCHEMA_MISMATCH',
      `AI trả schema "${raw?.schema_version}", mong đợi "${EXPECTED_SCHEMA}"`, requestId);
  }
  const m = raw.modules;
  const status = {
    face: asStatus(m.face?.status), identity: asStatus(m.identity?.status),
    headPose: asStatus(m.head_pose?.status), gaze: asStatus(m.gaze?.status), objects: asStatus(m.objects?.status),
  };
  const faceOk = status.face === 'ok';
  const primaryRaw = faceOk ? m.face.primary : null;
  return {
    requestId: raw.request_id ?? requestId,
    moduleStatus: status,
    moduleErrors: Object.fromEntries(
      Object.entries(m).filter(([, v]) => v.error).map(([k, v]) => [k, String(v.error)]),
    ),
    faceCount: faceOk ? Number(m.face.face_count) : null,
    primary: primaryRaw && {
      bbox: primaryRaw.bbox,
      similarity: status.identity === 'ok' ? Number(m.identity.similarity) : null,
      headPose: status.headPose === 'ok' ? { yaw: m.head_pose.yaw, pitch: m.head_pose.pitch, roll: m.head_pose.roll } : null,
      gaze: status.gaze === 'ok' ? { pitch: m.gaze.pitch, yaw: m.gaze.yaw } : null,
    },
    objects: status.objects === 'ok' ? m.objects.detections : [],
    inferenceStartedAt: raw.inference_started_at,
    completedAt: raw.completed_at,
    inferenceMs: raw.inference_ms,
    modelVersions: raw.model_versions,
    timingsMs: raw.timings_ms,
  };
}

// ---------------------------------------------------------------------------
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, requestId: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new AiServiceError('AI_TIMEOUT', `AI service không phản hồi trong ${timeoutMs}ms (${AI_SERVICE_URL})`, requestId, err);
    }
    throw new AiServiceError('AI_UNREACHABLE', `Không kết nối được AI service tại ${AI_SERVICE_URL}`, requestId, err);
  } finally {
    clearTimeout(timer);
  }
}

async function readError(res: Response): Promise<{ code: string; message: string }> {
  try {
    const j = (await res.json()) as any;
    if (j?.error?.code) return { code: j.error.code, message: j.error.message ?? '' };
    // FastAPI validation error (422 mặc định) hoặc format cũ
    return { code: 'UNKNOWN', message: typeof j?.error === 'string' ? j.error : JSON.stringify(j?.detail ?? j) };
  } catch {
    return { code: 'UNKNOWN', message: `HTTP ${res.status}` };
  }
}

/**
 * Gửi 1 frame JPEG + reference embedding (nếu cần check identity) tới AI service.
 * `requestId` đi qua header X-Request-Id => trace được browser → Node → AI → DB.
 */
export async function analyzeFrame(params: {
  imageBuffer: Buffer;
  referenceEmbedding: number[] | null;
  run: RunFlags;
  requestId?: string;
}): Promise<AiAnalysis> {
  const requestId = params.requestId ?? randomUUID();
  breakerCheck(requestId);

  const buildForm = () => {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(params.imageBuffer)], { type: 'image/jpeg' }), 'frame.jpg');
    form.append('run_face', String(params.run.face));
    form.append('run_head_pose', String(params.run.headPose));
    form.append('run_gaze', String(params.run.gaze));
    form.append('run_objects', String(params.run.objects));
    if (params.run.identity && params.referenceEmbedding) {
      form.append('reference_embedding', JSON.stringify(params.referenceEmbedding));
    }
    return form;
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(`${AI_SERVICE_URL}/analyze`,
        { method: 'POST', body: buildForm(), headers: { 'X-Request-Id': requestId } }, AI_SERVICE_TIMEOUT_MS, requestId);
      if (!res.ok) {
        const e = await readError(res);
        if (res.status === 429) throw new AiServiceError('AI_BUSY', 'AI service quá tải', requestId);
        if (res.status === 503) throw new AiServiceError('AI_MODEL_UNAVAILABLE', e.message || 'AI chưa sẵn sàng', requestId);
        if (res.status >= 500) throw new AiServiceError('AI_BAD_RESPONSE', `AI lỗi HTTP ${res.status}: ${e.message}`, requestId);
        throw new AiServiceError('AI_REJECTED', `AI từ chối frame (${e.code}): ${e.message}`, requestId);
      }
      let body: AnalyzeRawResponse;
      try { body = (await res.json()) as AnalyzeRawResponse; }
      catch (err) { throw new AiServiceError('AI_BAD_RESPONSE', 'AI trả JSON không hợp lệ', requestId, err); }
      const parsed = parseAnalyzeResponse(body, requestId);
      breakerSuccess();
      return parsed;
    } catch (err) {
      lastErr = err;
      const e = err instanceof AiServiceError ? err : new AiServiceError('AI_BAD_RESPONSE', String(err), requestId, err);
      breakerFailure(e.code);
      // Retry có giới hạn: chỉ khi lỗi mạng tạm thời. Timeout/busy KHÔNG retry (tránh dồn tải).
      if (e.code !== 'AI_UNREACHABLE' || attempt >= AI_MAX_RETRIES) throw e;
    }
  }
  throw lastErr;
}

/** Đăng ký khuôn mặt tham chiếu (Pre-check). Ném AiInputError nếu ảnh không đạt, AiServiceError nếu AI hỏng. */
export async function registerFace(imageBuffer: Buffer, requestId: string = randomUUID()): Promise<{
  embedding: number[]; modelVersions: Record<string, string | null>; faceScore: number | null;
}> {
  breakerCheck(requestId);
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }), 'reference.jpg');

  let res: Response;
  try {
    res = await fetchWithTimeout(`${AI_SERVICE_URL}/register-face`,
      { method: 'POST', body: form, headers: { 'X-Request-Id': requestId } }, AI_REGISTER_TIMEOUT_MS, requestId);
  } catch (err) {
    if (err instanceof AiServiceError) breakerFailure(err.code);
    throw err;
  }

  if (!res.ok) {
    const e = await readError(res);
    if (res.status === 429) throw new AiServiceError('AI_BUSY', 'AI service quá tải, vui lòng thử lại', requestId);
    if (res.status === 503) { breakerFailure('AI_MODEL_UNAVAILABLE'); throw new AiServiceError('AI_MODEL_UNAVAILABLE', e.message || 'AI chưa sẵn sàng', requestId); }
    if (res.status >= 500) { breakerFailure('AI_BAD_RESPONSE'); throw new AiServiceError('AI_BAD_RESPONSE', e.message, requestId); }
    throw new AiInputError(e.code, e.message || 'Ảnh không hợp lệ', requestId);
  }
  breakerSuccess();
  const data = (await res.json()) as any;
  if (!Array.isArray(data?.embedding) || data.embedding.length !== 512) {
    throw new AiServiceError('AI_BAD_RESPONSE', 'AI trả embedding không hợp lệ', requestId);
  }
  return { embedding: data.embedding, modelVersions: data.model_versions ?? {}, faceScore: data.face?.score ?? null };
}

export interface AiReadiness {
  state: 'ready' | 'not_ready' | 'unreachable';
  models?: Record<string, { status: string; version: string | null; error: string | null }>;
  breaker: ReturnType<typeof getBreakerState>;
  detail?: string;
}

/** Phân biệt: AI chưa chạy / model thiếu / sẵn sàng. */
export async function aiReadiness(): Promise<AiReadiness> {
  try {
    const res = await fetchImpl(`${AI_SERVICE_URL}/ready`, { signal: AbortSignal.timeout(3000) });
    const body = (await res.json()) as any;
    const isReady = res.ok && body.status === 'ready';
    if (isReady) breakerSuccess();
    return {
      state: isReady ? 'ready' : 'not_ready',
      models: body.models, breaker: getBreakerState(),
    };
  } catch (err: any) {
    return { state: 'unreachable', breaker: getBreakerState(), detail: `${AI_SERVICE_URL}: ${err?.message ?? 'unreachable'}` };
  }
}

export async function aiServiceHealthCheck(): Promise<boolean> {
  return (await aiReadiness()).state === 'ready';
}
