import type { AiAnalysis, RunFlags } from './policy.js';
export declare class AiServiceError extends Error {
    cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
/**
 * Gửi 1 frame (JPEG buffer) + reference embedding (nếu cần check identity) tới AI service
 */
export declare function analyzeFrame(params: {
    imageBuffer: Buffer;
    referenceEmbedding: number[] | null;
    run: RunFlags;
}): Promise<AiAnalysis>;
/** Đăng ký khuôn mặt tham chiếu (bước Pre-check) - trả embedding để lưu vào DB. */
export declare function registerFace(imageBuffer: Buffer): Promise<{
    embedding: number[];
} | {
    error: string;
}>;
export declare function aiServiceHealthCheck(): Promise<boolean>;
//# sourceMappingURL=ai-client.d.ts.map