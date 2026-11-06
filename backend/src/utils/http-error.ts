import type { Response } from 'express';

/** Lỗi nghiệp vụ có status code. Controller bắt và trả { success: false, error } theo convention hiện có. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Helper dùng trong controller để giữ đúng convention response. */
export function sendError(res: Response, err: unknown) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, error: err.message });
  }
  if (err && typeof err === 'object' && 'status' in err && 'message' in err) {
    return res.status((err as any).status).json({ success: false, error: (err as any).message });
  }
  console.error(err);
  return res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
}
