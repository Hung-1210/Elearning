"use strict";
// src/services/proctoring/ai-client.ts
// Gọi Python AI microservice (FastAPI) đã đóng gói 4 model (Face+ArcFace, HopeNet,
// L2CS, YOLOv8). Node KHÔNG chạy model trực tiếp - chỉ forward ảnh qua HTTP.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiServiceError = void 0;
exports.analyzeFrame = analyzeFrame;
exports.registerFace = registerFace;
exports.aiServiceHealthCheck = aiServiceHealthCheck;
const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8500';
const AI_SERVICE_TIMEOUT_MS = Number(process.env.AI_SERVICE_TIMEOUT_MS ?? 8000);
class AiServiceError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = 'AiServiceError';
    }
}
exports.AiServiceError = AiServiceError;
/**
 * Gửi 1 frame (JPEG buffer) + reference embedding (nếu cần check identity) tới AI service
 */
async function analyzeFrame(params) {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(params.imageBuffer)], { type: 'image/jpeg' }), 'frame.jpg');
    form.append('run_face', String(params.run.face));
    form.append('run_head_pose', String(params.run.headPose));
    form.append('run_gaze', String(params.run.gaze));
    form.append('run_objects', String(params.run.objects));
    if (params.run.identity && params.referenceEmbedding) {
        form.append('reference_embedding', JSON.stringify(params.referenceEmbedding));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_SERVICE_TIMEOUT_MS);
    let res;
    try {
        res = await fetch(`${AI_SERVICE_URL}/analyze`, { method: 'POST', body: form, signal: controller.signal });
    }
    catch (err) {
        throw new AiServiceError('Không kết nối được AI service', err);
    }
    finally {
        clearTimeout(timeout);
    }
    if (!res.ok) {
        throw new AiServiceError(`AI service trả lỗi HTTP ${res.status}`);
    }
    const raw = (await res.json());
    return {
        faceCount: raw.face_count,
        primary: raw.primary && {
            bbox: raw.primary.bbox,
            similarity: raw.primary.similarity,
            headPose: raw.primary.head_pose,
            gaze: raw.primary.gaze,
        },
        objects: raw.objects,
    };
}
/** Đăng ký khuôn mặt tham chiếu (bước Pre-check) - trả embedding để lưu vào DB. */
async function registerFace(imageBuffer) {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }), 'reference.jpg');
    try {
        const res = await fetch(`${AI_SERVICE_URL}/register-face`, { method: 'POST', body: form });
        const data = (await res.json());
        if (!res.ok)
            return { error: data?.error ?? 'Không xác định được khuôn mặt trong ảnh' };
        return { embedding: data.embedding };
    }
    catch (err) {
        return { error: 'Không thể kết nối đến AI service' };
    }
}
async function aiServiceHealthCheck() {
    try {
        const res = await fetch(`${AI_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) });
        return res.ok;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=ai-client.js.map