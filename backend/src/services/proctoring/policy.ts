// src/services/proctoring/policy.ts
// Chính sách giám sát THUẦN (không I/O): biến kết quả thô của AI service + cấu hình đề thi
// thành danh sách "mẫu hành vi" (BehaviorSample). Tách riêng để unit test dễ.
//
// Nguyên tắc: AI service CHỈ đo (góc, số mặt, vật thể, similarity). Node mới là nơi
// áp ngưỡng theo cấu hình từng đề thi. Client không được tin.

export type Severity = 'info' | 'warning' | 'critical';

export type BehaviorType =
  | 'head_turn_left' | 'head_turn_right' | 'head_pitch_up' | 'head_pitch_down'
  | 'gaze_left' | 'gaze_right' | 'gaze_up' | 'gaze_down'
  | 'no_face' | 'multiple_faces' | 'identity_mismatch'
  | 'object_cell_phone' | 'object_book' | 'object_laptop' | 'object_tv' | 'object_headphone'
  | 'extra_person'
  | 'tab_hidden' | 'window_blur' | 'fullscreen_exit' | 'camera_lost';

export interface BehaviorMeta {
  severity: Severity;
  /** Số mẫu liên tiếp tối thiểu để xác nhận (lọc nhiễu 1 frame). */
  minSamples: number;
  messageVi: string;
}

export const BEHAVIOR_META: Record<BehaviorType, BehaviorMeta> = {
  head_turn_left:    { severity: 'warning',  minSamples: 2, messageVi: 'Vui lòng nhìn thẳng vào màn hình (đang quay đầu sang trái)' },
  head_turn_right:   { severity: 'warning',  minSamples: 2, messageVi: 'Vui lòng nhìn thẳng vào màn hình (đang quay đầu sang phải)' },
  head_pitch_up:     { severity: 'warning',  minSamples: 2, messageVi: 'Vui lòng nhìn thẳng vào màn hình (đang ngẩng đầu)' },
  head_pitch_down:   { severity: 'warning',  minSamples: 2, messageVi: 'Vui lòng nhìn thẳng vào màn hình (đang cúi đầu)' },
  gaze_left:         { severity: 'warning',  minSamples: 2, messageVi: 'Vui lòng nhìn thẳng vào màn hình (đang liếc mắt sang trái)' },
  gaze_right:        { severity: 'warning',  minSamples: 2, messageVi: 'Vui lòng nhìn thẳng vào màn hình (đang liếc mắt sang phải)' },
  gaze_up:           { severity: 'warning',  minSamples: 2, messageVi: 'Vui lòng nhìn thẳng vào màn hình (đang nhìn lệch lên trên)' },
  gaze_down:         { severity: 'warning',  minSamples: 2, messageVi: 'Vui lòng nhìn thẳng vào màn hình (đang nhìn lệch xuống dưới)' },
  no_face:           { severity: 'warning',  minSamples: 2, messageVi: 'Không thấy khuôn mặt trong khung hình' },
  multiple_faces:    { severity: 'critical', minSamples: 2, messageVi: 'Phát hiện nhiều hơn một khuôn mặt' },
  identity_mismatch: { severity: 'critical', minSamples: 3, messageVi: 'Khuôn mặt không khớp với người đã xác thực' },
  object_cell_phone: { severity: 'critical', minSamples: 2, messageVi: 'Phát hiện điện thoại' },
  object_book:       { severity: 'warning',  minSamples: 2, messageVi: 'Phát hiện tài liệu/giấy tờ' },
  object_laptop:     { severity: 'critical', minSamples: 2, messageVi: 'Phát hiện laptop/thiết bị phụ' },
  object_tv:         { severity: 'critical', minSamples: 2, messageVi: 'Phát hiện màn hình phụ' },
  object_headphone:  { severity: 'warning',  minSamples: 2, messageVi: 'Phát hiện tai nghe' },
  extra_person:      { severity: 'critical', minSamples: 2, messageVi: 'Phát hiện người khác trong phòng' },
  tab_hidden:        { severity: 'warning',  minSamples: 1, messageVi: 'Bạn đã rời khỏi tab làm bài' },
  window_blur:       { severity: 'info',     minSamples: 1, messageVi: 'Cửa sổ làm bài mất tiêu điểm' },
  fullscreen_exit:   { severity: 'warning',  minSamples: 1, messageVi: 'Bạn đã thoát chế độ toàn màn hình' },
  camera_lost:       { severity: 'warning',  minSamples: 1, messageVi: 'Mất tín hiệu camera' },
};

// ---------------------------------------------------------------------------
// HIỆU CHỈNH DẤU
// ---------------------------------------------------------------------------
export const SIGN = {
  headYawPositive:   (process.env.PROCTORING_HEAD_YAW_POSITIVE   ?? 'right') as 'left' | 'right',
  headPitchPositive: (process.env.PROCTORING_HEAD_PITCH_POSITIVE ?? 'down')  as 'up' | 'down',
  gazeYawPositive:   (process.env.PROCTORING_GAZE_YAW_POSITIVE   ?? 'left')  as 'left' | 'right',
  gazePitchPositive: (process.env.PROCTORING_GAZE_PITCH_POSITIVE ?? 'up')    as 'up' | 'down',
};

// ---------------------------------------------------------------------------
// Cấu hình
// ---------------------------------------------------------------------------
export type Sensitivity = 'relaxed' | 'normal' | 'strict' | 'custom';
export type ViolationAction = 'log_only' | 'warn_and_log' | 'auto_submit';

export interface ProctoringSettings {
  enabled: boolean;
  verifyIdentity: boolean;
  detectIdentitySwap: boolean;
  identityRecheckIntervalSec: number;
  identityThreshold: number;
  detectNoFace: boolean;
  noFaceGraceSec: number;
  detectMultipleFaces: boolean;
  trackHeadPose: boolean;
  headSensitivity: Sensitivity;
  headYawThresholdDeg: number;
  headPitchThresholdDeg: number;
  headMinDurationMs: number;
  trackGaze: boolean;
  gazeSensitivity: Sensitivity;
  gazeYawThresholdDeg: number;
  gazePitchThresholdDeg: number;
  gazeMinDurationMs: number;
  detectPhone: boolean;
  detectDocument: boolean;
  detectSecondaryScreen: boolean;
  detectHeadphone: boolean;
  detectExtraPerson: boolean;
  objectConfThreshold: number;
  detectTabSwitch: boolean;
  violationAction: ViolationAction;
  autoSubmitAfterViolations: number;
  frameIntervalMs: number;
  evidenceRetentionDays: number;
}

export const HEAD_PRESETS = {
  relaxed: { headYawThresholdDeg: 45, headPitchThresholdDeg: 30, headMinDurationMs: 3000 },
  normal:  { headYawThresholdDeg: 35, headPitchThresholdDeg: 25, headMinDurationMs: 2000 },
  strict:  { headYawThresholdDeg: 25, headPitchThresholdDeg: 18, headMinDurationMs: 1000 },
} as const;

export const GAZE_PRESETS = {
  relaxed: { gazeYawThresholdDeg: 26, gazePitchThresholdDeg: 30, gazeMinDurationMs: 2500 },
  normal:  { gazeYawThresholdDeg: 20, gazePitchThresholdDeg: 26, gazeMinDurationMs: 1500 },
  strict:  { gazeYawThresholdDeg: 16, gazePitchThresholdDeg: 22, gazeMinDurationMs: 1000 },
} as const;

/** Preset tổng (nút "Nhẹ nhàng / Cân bằng / Nghiêm ngặt" ở đầu Bước 3). FE lấy qua API, không hardcode. */
export const EXAM_PRESETS: Record<'relaxed' | 'balanced' | 'strict', Partial<ProctoringSettings>> = {
  relaxed: {
    verifyIdentity: true, detectIdentitySwap: false, detectNoFace: true, noFaceGraceSec: 10,
    detectMultipleFaces: true, trackHeadPose: true, headSensitivity: 'relaxed', trackGaze: false,
    detectPhone: true, detectDocument: false, detectSecondaryScreen: false, detectHeadphone: false,
    detectExtraPerson: false, detectTabSwitch: false, violationAction: 'log_only',
  },
  balanced: {
    verifyIdentity: true, detectIdentitySwap: true, detectNoFace: true, noFaceGraceSec: 5,
    detectMultipleFaces: true, trackHeadPose: true, headSensitivity: 'normal', trackGaze: false,
    detectPhone: true, detectDocument: true, detectSecondaryScreen: false, detectHeadphone: false,
    detectExtraPerson: false, detectTabSwitch: true, violationAction: 'warn_and_log',
  },
  strict: {
    verifyIdentity: true, detectIdentitySwap: true, detectNoFace: true, noFaceGraceSec: 3,
    detectMultipleFaces: true, trackHeadPose: true, headSensitivity: 'strict', trackGaze: true,
    gazeSensitivity: 'strict', detectPhone: true, detectDocument: true, detectSecondaryScreen: true,
    detectHeadphone: true, detectExtraPerson: true, detectTabSwitch: true, violationAction: 'warn_and_log',
  },
};

export const DEFAULT_SETTINGS: ProctoringSettings = {
  enabled: false, verifyIdentity: true, detectIdentitySwap: true, identityRecheckIntervalSec: 30,
  identityThreshold: 0.45, detectNoFace: true, noFaceGraceSec: 5, detectMultipleFaces: true,
  trackHeadPose: true, headSensitivity: 'normal', ...HEAD_PRESETS.normal,
  trackGaze: false, gazeSensitivity: 'normal', ...GAZE_PRESETS.normal,
  detectPhone: true, detectDocument: true, detectSecondaryScreen: false, detectHeadphone: false,
  detectExtraPerson: false, objectConfThreshold: 0.6, detectTabSwitch: true,
  violationAction: 'warn_and_log', autoSubmitAfterViolations: 3,
  frameIntervalMs: 1500, evidenceRetentionDays: 90,
};

const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

function normalizeSensitivity(raw: unknown): Sensitivity {
  if (raw === 'relaxed' || raw === 'low') return 'relaxed';
  if (raw === 'normal' || raw === 'medium' || raw === 'balanced') return 'normal';
  if (raw === 'strict' || raw === 'high') return 'strict';
  if (raw === 'custom') return 'custom';
  return 'normal';
}

function normalizeViolationAction(raw: unknown): ViolationAction {
  if (raw === 'log_only' || raw === 'warn_and_log' || raw === 'auto_submit') return raw;
  return 'warn_and_log';
}

/**
 * Chuẩn hóa input từ FE trước khi ghi DB: điền ngưỡng số từ preset (nếu sensitivity != custom),
 * ánh xạ tên mức nhạy cũ (low/medium/high -> relaxed/normal/strict) và ép mọi giá trị vào
 * khoảng hợp lệ (khớp 100% CHECK constraint trong 002_exam_module.sql).
 */
export function resolveProctoringSettings(input: Partial<ProctoringSettings>): ProctoringSettings {
  const definedOnly: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (v !== undefined && v !== null) {
      definedOnly[k] = v;
    }
  }
  const s: ProctoringSettings = { ...DEFAULT_SETTINGS, ...(definedOnly as Partial<ProctoringSettings>) };
  s.headSensitivity = normalizeSensitivity((input as any)?.headSensitivity);
  s.gazeSensitivity = normalizeSensitivity((input as any)?.gazeSensitivity);
  s.violationAction = normalizeViolationAction((input as any)?.violationAction);

  if (s.headSensitivity !== 'custom') Object.assign(s, HEAD_PRESETS[s.headSensitivity]);
  if (s.gazeSensitivity !== 'custom') Object.assign(s, GAZE_PRESETS[s.gazeSensitivity]);

  s.headYawThresholdDeg = clamp(Math.round(Number(s.headYawThresholdDeg)), 10, 80);
  s.headPitchThresholdDeg = clamp(Math.round(Number(s.headPitchThresholdDeg)), 10, 60);
  s.headMinDurationMs = clamp(Math.round(Number(s.headMinDurationMs)), 0, 30000);
  s.gazeYawThresholdDeg = clamp(Math.round(Number(s.gazeYawThresholdDeg)), 10, 60);
  s.gazePitchThresholdDeg = clamp(Math.round(Number(s.gazePitchThresholdDeg)), 10, 60);
  s.gazeMinDurationMs = clamp(Math.round(Number(s.gazeMinDurationMs)), 0, 30000);
  s.identityThreshold = clamp(Number(s.identityThreshold), 0.2, 0.9);
  s.identityRecheckIntervalSec = clamp(Math.round(Number(s.identityRecheckIntervalSec)), 10, 900);
  s.noFaceGraceSec = clamp(Math.round(Number(s.noFaceGraceSec)), 1, 120);
  s.objectConfThreshold = clamp(Number(s.objectConfThreshold), 0.3, 0.95);
  s.autoSubmitAfterViolations = clamp(Math.round(Number(s.autoSubmitAfterViolations)), 1, 20);
  s.frameIntervalMs = clamp(Math.round(Number(s.frameIntervalMs)), 500, 10000);
  s.evidenceRetentionDays = clamp(Math.round(Number(s.evidenceRetentionDays)), 1, 730);
  return s;
}

// ---------------------------------------------------------------------------
// Kết quả thô từ AI service (đã chuẩn hóa sang camelCase bởi ai.client)
// ---------------------------------------------------------------------------
export type BBox = [number, number, number, number];

/**
 * Trạng thái từng module của AI (contract `proctoring.analyze.v2`):
 *  ok            : chạy xong, có số liệu
 *  not_requested : Node không yêu cầu module này ở frame này
 *  no_face       : cần khuôn mặt nhưng không thấy (KHÔNG phải lỗi AI)
 *  unavailable   : model không load được
 *  error         : module lỗi khi chạy
 *  skipped_face_unavailable : bị bỏ qua vì face detector lỗi
 */
export type AiModuleStatus =
  'ok' | 'not_requested' | 'no_face' | 'unavailable' | 'error' | 'skipped_face_unavailable';

export interface AiAnalysis {
  requestId: string;
  moduleStatus: { face: AiModuleStatus; identity: AiModuleStatus; headPose: AiModuleStatus; gaze: AiModuleStatus; objects: AiModuleStatus };
  moduleErrors: Record<string, string>;
  /** null = KHÔNG BIẾT (face detector không chạy/lỗi). 0 = chạy xong và không thấy mặt. */
  faceCount: number | null;
  /** Khuôn mặt chính = lớn nhất. null nếu không có mặt hoặc detector face không chạy. */
  primary: null | {
    bbox: BBox;
    similarity: number | null;
    headPose: { yaw: number; pitch: number; roll: number } | null;
    gaze: { pitch: number; yaw: number } | null;
  };
  objects: Array<{ cls: string; conf: number; bbox: BBox }>;
  inferenceStartedAt: string;
  completedAt: string;
  inferenceMs: number;
  modelVersions: Record<string, string | null>;
  timingsMs: Record<string, number>;
}

/** Module nào được yêu cầu mà không ra kết quả hợp lệ (unavailable/error) => AI degraded. */
export function degradedModules(a: AiAnalysis, run: RunFlags): string[] {
  const req: Array<[string, boolean, AiModuleStatus]> = [
    ['face', run.face, a.moduleStatus.face],
    ['identity', run.identity, a.moduleStatus.identity],
    ['headPose', run.headPose, a.moduleStatus.headPose],
    ['gaze', run.gaze, a.moduleStatus.gaze],
    ['objects', run.objects, a.moduleStatus.objects],
  ];
  return req
    .filter(([, wanted, st]) => wanted && (st === 'unavailable' || st === 'error' || st === 'skipped_face_unavailable'))
    .map(([name]) => name);
}

/** Detector nào thực sự được yêu cầu chạy ở frame này (chỉ chạy cái cần => tiết kiệm GPU/CPU). */
export interface RunFlags {
  face: boolean;
  headPose: boolean;
  gaze: boolean;
  objects: boolean;
  identity: boolean;
}

export function buildRunFlags(
  s: ProctoringSettings,
  hasReference: boolean,
  identityCheckDue: boolean,
  objectDue = true,
): RunFlags {
  return {
    face: s.enabled,
    headPose: s.enabled && s.trackHeadPose,
    gaze: s.enabled && s.trackGaze,
    objects: s.enabled && objectDue && (
      s.detectPhone || s.detectDocument || s.detectSecondaryScreen ||
      s.detectHeadphone || s.detectExtraPerson
    ),
    identity: s.enabled && (s.verifyIdentity || s.detectIdentitySwap) && hasReference && identityCheckDue,
  };
}

export interface BehaviorSample {
  type: BehaviorType;
  active: boolean;
  severity: Severity;
  minSamples: number;
  minDurationMs: number;
  /** Độ nặng của mẫu (càng lớn càng nặng): |góc|, độ tin cậy, hoặc (1 - similarity). */
  value?: number;
}

function sample(type: BehaviorType, active: boolean, minDurationMs: number, value?: number): BehaviorSample {
  const m = BEHAVIOR_META[type];
  return { type, active, severity: m.severity, minSamples: m.minSamples, minDurationMs, value };
}

const OBJECT_RULES: Array<{ type: BehaviorType; classes: string[]; flag: keyof ProctoringSettings }> = [
  { type: 'object_cell_phone', classes: ['cell phone'], flag: 'detectPhone' },
  { type: 'object_book',       classes: ['book'],       flag: 'detectDocument' },
  { type: 'object_laptop',     classes: ['laptop'],     flag: 'detectSecondaryScreen' },
  { type: 'object_tv',         classes: ['tv'],         flag: 'detectSecondaryScreen' },
  { type: 'object_headphone',  classes: ['headphone'],  flag: 'detectHeadphone' },
];

function directional(
  kind: 'head' | 'gaze', yaw: number, pitch: number, yawThr: number, pitchThr: number, minMs: number,
): BehaviorSample[] {
  const yawPos = kind === 'head' ? SIGN.headYawPositive : SIGN.gazeYawPositive;
  const pitchPos = kind === 'head' ? SIGN.headPitchPositive : SIGN.gazePitchPositive;
  const exceeds = (v: number, thr: number, positive: boolean) => (positive ? v > thr : v < -thr);
  const t = (d: string) => `${kind}_${d}` as BehaviorType;
  const pitchVal = Math.abs(pitch);
  const yawVal = Math.abs(yaw);
  return [
    sample(kind === 'head' ? 'head_turn_left' : 'gaze_left',  exceeds(yaw, yawThr, yawPos === 'left'),  minMs, yawVal),
    sample(kind === 'head' ? 'head_turn_right' : 'gaze_right', exceeds(yaw, yawThr, yawPos === 'right'), minMs, yawVal),
    sample(t('pitch_up') === 'head_pitch_up' ? 'head_pitch_up' : 'gaze_up',     exceeds(pitch, pitchThr, pitchPos === 'up'),   minMs, pitchVal),
    sample(t('pitch_down') === 'head_pitch_down' ? 'head_pitch_down' : 'gaze_down', exceeds(pitch, pitchThr, pitchPos === 'down'), minMs, pitchVal),
  ];
}

/**
 * Chuyển kết quả AI thành các mẫu hành vi.
 * QUY TẮC "unknown": nếu không đủ dữ kiện (detector không chạy, hoặc không có mặt nên không có góc)
 * thì KHÔNG phát mẫu cho hành vi đó — episode đang mở sẽ được giữ nguyên/hết hạn theo timeout,
 * thay vì bị đóng nhầm.
 */
export function evaluateAnalysis(a: AiAnalysis, s: ProctoringSettings, run: RunFlags): BehaviorSample[] {
  if (!s.enabled) return [];
  const out: BehaviorSample[] = [];

  // faceCount === null => face detector không chạy/lỗi => KHÔNG phát mẫu (không kết luận gì).
  if (run.face && a.moduleStatus.face === 'ok' && a.faceCount !== null) {
    if (s.detectNoFace) out.push(sample('no_face', a.faceCount === 0, s.noFaceGraceSec * 1000));
    if (s.detectMultipleFaces) out.push(sample('multiple_faces', a.faceCount >= 2, 2000, a.faceCount));
  }

  const p = a.primary;

  if (run.headPose && s.trackHeadPose && p?.headPose) {
    out.push(...directional('head', p.headPose.yaw, p.headPose.pitch,
      s.headYawThresholdDeg, s.headPitchThresholdDeg, s.headMinDurationMs));
  }
  if (run.gaze && s.trackGaze && p?.gaze) {
    out.push(...directional('gaze', p.gaze.yaw, p.gaze.pitch,
      s.gazeYawThresholdDeg, s.gazePitchThresholdDeg, s.gazeMinDurationMs));
  }

  if (run.identity && a.moduleStatus.identity === 'ok' && p && p.similarity !== null && p.similarity !== undefined) {
    out.push(sample('identity_mismatch', p.similarity < s.identityThreshold, 0, 1 - p.similarity));
  }

  if (run.objects && a.moduleStatus.objects === 'ok') {
    const confident = a.objects.filter((o) => o.conf >= s.objectConfThreshold);
    for (const rule of OBJECT_RULES) {
      if (!s[rule.flag]) continue;
      const hits = confident.filter((o) => rule.classes.includes(o.cls));
      out.push(sample(rule.type, hits.length > 0, 0, hits.length ? Math.max(...hits.map((h) => h.conf)) : undefined));
    }
    if (s.detectExtraPerson) {
      const persons = confident.filter((o) => o.cls === 'person').length;
      out.push(sample('extra_person', persons >= 2, 0, persons));
    }
  }

  return out;
}

/** Ngưỡng khoảng trống frame (ms) coi là mất camera. */
export function cameraGapThresholdMs(s: ProctoringSettings): number {
  return Math.max(20000, s.frameIntervalMs * 8);
}
