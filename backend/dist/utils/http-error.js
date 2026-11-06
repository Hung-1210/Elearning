"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpError = void 0;
exports.sendError = sendError;
/** Lỗi nghiệp vụ có status code. Controller bắt và trả { success: false, error } theo convention hiện có. */
class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = 'HttpError';
    }
}
exports.HttpError = HttpError;
/** Helper dùng trong controller để giữ đúng convention response. */
function sendError(res, err) {
    if (err instanceof HttpError) {
        return res.status(err.status).json({ success: false, error: err.message });
    }
    if (err && typeof err === 'object' && 'status' in err && 'message' in err) {
        return res.status(err.status).json({ success: false, error: err.message });
    }
    console.error(err);
    return res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
}
//# sourceMappingURL=http-error.js.map