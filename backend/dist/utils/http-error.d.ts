import type { Response } from 'express';
/** Lỗi nghiệp vụ có status code. Controller bắt và trả { success: false, error } theo convention hiện có. */
export declare class HttpError extends Error {
    status: number;
    constructor(status: number, message: string);
}
/** Helper dùng trong controller để giữ đúng convention response. */
export declare function sendError(res: Response, err: unknown): Response<any, Record<string, any>>;
//# sourceMappingURL=http-error.d.ts.map