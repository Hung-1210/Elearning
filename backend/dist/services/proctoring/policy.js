"use strict";
// src/services/proctoring/policy.ts
// Chính sách giám sát THUẦN (không I/O): biến kết quả thô của AI service + cấu hình đề thi
// thành danh sách "mẫu hành vi" (BehaviorSample). Tách riêng để unit test dễ.
//
// Nguyên tắc: AI service CHỈ đo (góc, số mặt, vật thể, similarity). Node mới là nơi
// áp ngưỡng theo cấu hình từng đề thi. Client không được tin.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SETTINGS = exports.EXAM_PRESETS = exports.GAZE_PRESETS = exports.HEAD_PRESETS = exports.SIGN = exports.BEHAVIOR_META = void 0;
exports.resolveProctoringSettings = resolveProctoringSettings;
exports.buildRunFlags = buildRunFlags;
exports.evaluateAnalysis = evaluateAnalysis;
exports.cameraGapThresholdMs = cameraGapThresholdMs;
exports.BEHAVIOR_META = {
    head_turn_left: { severity: 'warning', minSamples: 2, messageVi: 'Vui lòng nhìn thẳng vào màn hình (đang quay đầu sang trái)' },
    head_turn_right: { severity: 'warning', minSamples: 2, messageVi: 'Vui lòng nhìn thẳng vào màn hình (đang quay đầu sang phải)' },
    head_pitch_up: { severity: 'warning', minSamples: 2, messageVi: 'Vui lòng nhìn thẳng vào màn hình (đang ngẩng đầu)' },
    head_pitch_down: { severity: 'warning', minSamples: 2, messageVi: 'Vui lòng nhìn thẳng vào màn hình (đang cúi đầu)' },
    gaze_left: { severity: 'info', minSamples: 2, messageVi: 'Ánh mắt lệch khỏi màn hình' },
    gaze_right: { severity: 'info', minSamples: 2, messageVi: 'Ánh mắt lệch khỏi màn hình' },
    gaze_up: { severity: 'info', minSamples: 2, messageVi: 'Ánh mắt lệch khỏi màn hình' },
    gaze_down: { severity: 'info', minSamples: 2, messageVi: 'Ánh mắt lệch khỏi màn hình' },
    no_face: { severity: 'warning', minSamples: 2, messageVi: 'Không thấy khuôn mặt trong khung hình' },
    multiple_faces: { severity: 'critical', minSamples: 2, messageVi: 'Phát hiện nhiều hơn một khuôn mặt' },
    identity_mismatch: { severity: 'critical', minSamples: 3, messageVi: 'Khuôn mặt không khớp với người đã xác thực' },
    object_cell_phone: { severity: 'critical', minSamples: 2, messageVi: 'Phát hiện điện thoại' },
    object_book: { severity: 'warning', minSamples: 2, messageVi: 'Phát hiện tài liệu/giấy tờ' },
    object_laptop: { severity: 'critical', minSamples: 2, messageVi: 'Phát hiện laptop/thiết bị phụ' },
    object_tv: { severity: 'critical', minSamples: 2, messageVi: 'Phát hiện màn hình phụ' },
    object_headphone: { severity: 'warning', minSamples: 2, messageVi: 'Phát hiện tai nghe' },
    extra_person: { severity: 'critical', minSamples: 2, messageVi: 'Phát hiện người khác trong phòng' },
    tab_hidden: { severity: 'warning', minSamples: 1, messageVi: 'Bạn đã rời khỏi tab làm bài' },
    window_blur: { severity: 'info', minSamples: 1, messageVi: 'Cửa sổ làm bài mất tiêu điểm' },
    fullscreen_exit: { severity: 'warning', minSamples: 1, messageVi: 'Bạn đã thoát chế độ toàn màn hình' },
    camera_lost: { severity: 'warning', minSamples: 1, messageVi: 'Mất tín hiệu camera' },
};
// ---------------------------------------------------------------------------
// HIỆU CHỈNH DẤU
// ---------------------------------------------------------------------------
exports.SIGN = {
    headYawPositive: (process.env.PROCTORING_HEAD_YAW_POSITIVE ?? 'right'),
    headPitchPositive: (process.env.PROCTORING_HEAD_PITCH_POSITIVE ?? 'down'),
    gazeYawPositive: (process.env.PROCTORING_GAZE_YAW_POSITIVE ?? 'right'),
    gazePitchPositive: (process.env.PROCTORING_GAZE_PITCH_POSITIVE ?? 'up'),
};
exports.HEAD_PRESETS = {
    relaxed: { headYawThresholdDeg: 45, headPitchThresholdDeg: 30, headMinDurationMs: 3000 },
    normal: { headYawThresholdDeg: 35, headPitchThresholdDeg: 25, headMinDurationMs: 2000 },
    strict: { headYawThresholdDeg: 25, headPitchThresholdDeg: 18, headMinDurationMs: 1000 },
};
exports.GAZE_PRESETS = {
    relaxed: { gazeYawThresholdDeg: 40, gazePitchThresholdDeg: 30, gazeMinDurationMs: 3000 },
    normal: { gazeYawThresholdDeg: 30, gazePitchThresholdDeg: 22, gazeMinDurationMs: 2000 },
    strict: { gazeYawThresholdDeg: 22, gazePitchThresholdDeg: 15, gazeMinDurationMs: 1500 },
};
/** Preset tổng (nút "Nhẹ nhàng / Cân bằng / Nghiêm ngặt" ở đầu Bước 3). FE lấy qua API, không hardcode. */
exports.EXAM_PRESETS = {
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
exports.DEFAULT_SETTINGS = {
    enabled: false, verifyIdentity: true, detectIdentitySwap: true, identityRecheckIntervalSec: 30,
    identityThreshold: 0.45, detectNoFace: true, noFaceGraceSec: 5, detectMultipleFaces: true,
    trackHeadPose: true, headSensitivity: 'normal', ...exports.HEAD_PRESETS.normal,
    trackGaze: false, gazeSensitivity: 'normal', ...exports.GAZE_PRESETS.normal,
    detectPhone: true, detectDocument: true, detectSecondaryScreen: false, detectHeadphone: false,
    detectExtraPerson: false, objectConfThreshold: 0.6, detectTabSwitch: true,
    violationAction: 'warn_and_log', autoSubmitAfterViolations: 3,
    frameIntervalMs: 1500, evidenceRetentionDays: 90,
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/**
 * Chuẩn hóa input từ FE trước khi ghi DB: điền ngưỡng số từ preset (nếu sensitivity != custom)
 * và ép mọi giá trị vào khoảng hợp lệ (khớp CHECK trong SQL).
 */
function resolveProctoringSettings(input) {
    const s = { ...exports.DEFAULT_SETTINGS, ...input };
    if (s.headSensitivity !== 'custom')
        Object.assign(s, exports.HEAD_PRESETS[s.headSensitivity]);
    if (s.gazeSensitivity !== 'custom')
        Object.assign(s, exports.GAZE_PRESETS[s.gazeSensitivity]);
    s.headYawThresholdDeg = clamp(Math.round(s.headYawThresholdDeg), 10, 80);
    s.headPitchThresholdDeg = clamp(Math.round(s.headPitchThresholdDeg), 10, 60);
    s.headMinDurationMs = clamp(Math.round(s.headMinDurationMs), 0, 30000);
    s.gazeYawThresholdDeg = clamp(Math.round(s.gazeYawThresholdDeg), 10, 60);
    s.gazePitchThresholdDeg = clamp(Math.round(s.gazePitchThresholdDeg), 10, 60);
    s.gazeMinDurationMs = clamp(Math.round(s.gazeMinDurationMs), 0, 30000);
    s.identityThreshold = clamp(s.identityThreshold, 0.2, 0.9);
    s.identityRecheckIntervalSec = clamp(Math.round(s.identityRecheckIntervalSec), 10, 900);
    s.noFaceGraceSec = clamp(Math.round(s.noFaceGraceSec), 1, 120);
    s.objectConfThreshold = clamp(s.objectConfThreshold, 0.3, 0.95);
    s.autoSubmitAfterViolations = clamp(Math.round(s.autoSubmitAfterViolations), 1, 20);
    s.frameIntervalMs = clamp(Math.round(s.frameIntervalMs), 500, 10000);
    s.evidenceRetentionDays = clamp(Math.round(s.evidenceRetentionDays), 1, 730);
    return s;
}
function buildRunFlags(s, hasReference, identityCheckDue) {
    return {
        face: s.enabled,
        headPose: s.enabled && s.trackHeadPose,
        gaze: s.enabled && s.trackGaze,
        objects: s.enabled && (s.detectPhone || s.detectDocument || s.detectSecondaryScreen ||
            s.detectHeadphone || s.detectExtraPerson),
        identity: s.enabled && (s.verifyIdentity || s.detectIdentitySwap) && hasReference && identityCheckDue,
    };
}
function sample(type, active, minDurationMs, value) {
    const m = exports.BEHAVIOR_META[type];
    return { type, active, severity: m.severity, minSamples: m.minSamples, minDurationMs, value };
}
const OBJECT_RULES = [
    { type: 'object_cell_phone', classes: ['cell phone'], flag: 'detectPhone' },
    { type: 'object_book', classes: ['book'], flag: 'detectDocument' },
    { type: 'object_laptop', classes: ['laptop'], flag: 'detectSecondaryScreen' },
    { type: 'object_tv', classes: ['tv'], flag: 'detectSecondaryScreen' },
    { type: 'object_headphone', classes: ['headphone'], flag: 'detectHeadphone' },
];
function directional(kind, yaw, pitch, yawThr, pitchThr, minMs) {
    const yawPos = kind === 'head' ? exports.SIGN.headYawPositive : exports.SIGN.gazeYawPositive;
    const pitchPos = kind === 'head' ? exports.SIGN.headPitchPositive : exports.SIGN.gazePitchPositive;
    const exceeds = (v, thr, positive) => (positive ? v > thr : v < -thr);
    const t = (d) => `${kind}_${d}`;
    const pitchVal = Math.abs(pitch);
    const yawVal = Math.abs(yaw);
    return [
        sample(kind === 'head' ? 'head_turn_left' : 'gaze_left', exceeds(yaw, yawThr, yawPos === 'left'), minMs, yawVal),
        sample(kind === 'head' ? 'head_turn_right' : 'gaze_right', exceeds(yaw, yawThr, yawPos === 'right'), minMs, yawVal),
        sample(t('pitch_up') === 'head_pitch_up' ? 'head_pitch_up' : 'gaze_up', exceeds(pitch, pitchThr, pitchPos === 'up'), minMs, pitchVal),
        sample(t('pitch_down') === 'head_pitch_down' ? 'head_pitch_down' : 'gaze_down', exceeds(pitch, pitchThr, pitchPos === 'down'), minMs, pitchVal),
    ];
}
/**
 * Chuyển kết quả AI thành các mẫu hành vi.
 * QUY TẮC "unknown": nếu không đủ dữ kiện (detector không chạy, hoặc không có mặt nên không có góc)
 * thì KHÔNG phát mẫu cho hành vi đó — episode đang mở sẽ được giữ nguyên/hết hạn theo timeout,
 * thay vì bị đóng nhầm.
 */
function evaluateAnalysis(a, s, run) {
    if (!s.enabled)
        return [];
    const out = [];
    if (run.face) {
        if (s.detectNoFace)
            out.push(sample('no_face', a.faceCount === 0, s.noFaceGraceSec * 1000));
        if (s.detectMultipleFaces)
            out.push(sample('multiple_faces', a.faceCount >= 2, 2000, a.faceCount));
    }
    const p = a.primary;
    if (run.headPose && s.trackHeadPose && p?.headPose) {
        out.push(...directional('head', p.headPose.yaw, p.headPose.pitch, s.headYawThresholdDeg, s.headPitchThresholdDeg, s.headMinDurationMs));
    }
    if (run.gaze && s.trackGaze && p?.gaze) {
        out.push(...directional('gaze', p.gaze.yaw, p.gaze.pitch, s.gazeYawThresholdDeg, s.gazePitchThresholdDeg, s.gazeMinDurationMs));
    }
    if (run.identity && p && p.similarity !== null && p.similarity !== undefined) {
        out.push(sample('identity_mismatch', p.similarity < s.identityThreshold, 0, 1 - p.similarity));
    }
    if (run.objects) {
        const confident = a.objects.filter((o) => o.conf >= s.objectConfThreshold);
        for (const rule of OBJECT_RULES) {
            if (!s[rule.flag])
                continue;
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
function cameraGapThresholdMs(s) {
    return Math.max(20000, s.frameIntervalMs * 8);
}
//# sourceMappingURL=policy.js.map