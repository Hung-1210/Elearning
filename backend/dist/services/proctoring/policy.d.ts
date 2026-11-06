export type Severity = 'info' | 'warning' | 'critical';
export type BehaviorType = 'head_turn_left' | 'head_turn_right' | 'head_pitch_up' | 'head_pitch_down' | 'gaze_left' | 'gaze_right' | 'gaze_up' | 'gaze_down' | 'no_face' | 'multiple_faces' | 'identity_mismatch' | 'object_cell_phone' | 'object_book' | 'object_laptop' | 'object_tv' | 'object_headphone' | 'extra_person' | 'tab_hidden' | 'window_blur' | 'fullscreen_exit' | 'camera_lost';
export interface BehaviorMeta {
    severity: Severity;
    /** Số mẫu liên tiếp tối thiểu để xác nhận (lọc nhiễu 1 frame). */
    minSamples: number;
    messageVi: string;
}
export declare const BEHAVIOR_META: Record<BehaviorType, BehaviorMeta>;
export declare const SIGN: {
    headYawPositive: "left" | "right";
    headPitchPositive: "up" | "down";
    gazeYawPositive: "left" | "right";
    gazePitchPositive: "up" | "down";
};
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
export declare const HEAD_PRESETS: {
    readonly relaxed: {
        readonly headYawThresholdDeg: 45;
        readonly headPitchThresholdDeg: 30;
        readonly headMinDurationMs: 3000;
    };
    readonly normal: {
        readonly headYawThresholdDeg: 35;
        readonly headPitchThresholdDeg: 25;
        readonly headMinDurationMs: 2000;
    };
    readonly strict: {
        readonly headYawThresholdDeg: 25;
        readonly headPitchThresholdDeg: 18;
        readonly headMinDurationMs: 1000;
    };
};
export declare const GAZE_PRESETS: {
    readonly relaxed: {
        readonly gazeYawThresholdDeg: 40;
        readonly gazePitchThresholdDeg: 30;
        readonly gazeMinDurationMs: 3000;
    };
    readonly normal: {
        readonly gazeYawThresholdDeg: 30;
        readonly gazePitchThresholdDeg: 22;
        readonly gazeMinDurationMs: 2000;
    };
    readonly strict: {
        readonly gazeYawThresholdDeg: 22;
        readonly gazePitchThresholdDeg: 15;
        readonly gazeMinDurationMs: 1500;
    };
};
/** Preset tổng (nút "Nhẹ nhàng / Cân bằng / Nghiêm ngặt" ở đầu Bước 3). FE lấy qua API, không hardcode. */
export declare const EXAM_PRESETS: Record<'relaxed' | 'balanced' | 'strict', Partial<ProctoringSettings>>;
export declare const DEFAULT_SETTINGS: ProctoringSettings;
/**
 * Chuẩn hóa input từ FE trước khi ghi DB: điền ngưỡng số từ preset (nếu sensitivity != custom)
 * và ép mọi giá trị vào khoảng hợp lệ (khớp CHECK trong SQL).
 */
export declare function resolveProctoringSettings(input: Partial<ProctoringSettings>): ProctoringSettings;
export type BBox = [number, number, number, number];
export interface AiAnalysis {
    faceCount: number;
    /** Khuôn mặt chính = lớn nhất. null nếu không có mặt hoặc detector face không chạy. */
    primary: null | {
        bbox: BBox;
        similarity: number | null;
        headPose: {
            yaw: number;
            pitch: number;
            roll: number;
        } | null;
        gaze: {
            pitch: number;
            yaw: number;
        } | null;
    };
    objects: Array<{
        cls: string;
        conf: number;
        bbox: BBox;
    }>;
}
/** Detector nào thực sự được yêu cầu chạy ở frame này (chỉ chạy cái cần => tiết kiệm GPU/CPU). */
export interface RunFlags {
    face: boolean;
    headPose: boolean;
    gaze: boolean;
    objects: boolean;
    identity: boolean;
}
export declare function buildRunFlags(s: ProctoringSettings, hasReference: boolean, identityCheckDue: boolean): RunFlags;
export interface BehaviorSample {
    type: BehaviorType;
    active: boolean;
    severity: Severity;
    minSamples: number;
    minDurationMs: number;
    /** Độ nặng của mẫu (càng lớn càng nặng): |góc|, độ tin cậy, hoặc (1 - similarity). */
    value?: number;
}
/**
 * Chuyển kết quả AI thành các mẫu hành vi.
 * QUY TẮC "unknown": nếu không đủ dữ kiện (detector không chạy, hoặc không có mặt nên không có góc)
 * thì KHÔNG phát mẫu cho hành vi đó — episode đang mở sẽ được giữ nguyên/hết hạn theo timeout,
 * thay vì bị đóng nhầm.
 */
export declare function evaluateAnalysis(a: AiAnalysis, s: ProctoringSettings, run: RunFlags): BehaviorSample[];
/** Ngưỡng khoảng trống frame (ms) coi là mất camera. */
export declare function cameraGapThresholdMs(s: ProctoringSettings): number;
//# sourceMappingURL=policy.d.ts.map