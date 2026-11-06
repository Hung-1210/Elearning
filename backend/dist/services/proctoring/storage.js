"use strict";
// src/services/proctoring/storage.ts
// QUAN TRỌNG: Ảnh bằng chứng chứa khuôn mặt là dữ liệu nhạy cảm,
// KHÔNG được đặt trong `uploads/` — dùng thư mục riêng `private-uploads/` SIBLING với
// `uploads/`, KHÔNG mount qua express.static. Chỉ truy cập qua route có requireLogin +
// kiểm tra quyền.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROCTORING_DIR = void 0;
exports.saveEvidenceImage = saveEvidenceImage;
exports.readEvidenceImage = readEvidenceImage;
exports.deleteEvidenceImage = deleteEvidenceImage;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const PRIVATE_ROOT = node_path_1.default.join(process.cwd(), 'private-uploads');
exports.PROCTORING_DIR = 'proctoring';
/** Ghi buffer ảnh, trả về path TƯƠNG ĐỐI để lưu vào cột proctoring_evidence.file_path. */
async function saveEvidenceImage(attemptId, buffer) {
    const relDir = node_path_1.default.join(exports.PROCTORING_DIR, String(attemptId));
    const absDir = node_path_1.default.join(PRIVATE_ROOT, relDir);
    await promises_1.default.mkdir(absDir, { recursive: true });
    const fileName = `${Date.now()}-${(0, node_crypto_1.randomUUID)()}.jpg`;
    const relPath = node_path_1.default.join(relDir, fileName);
    await promises_1.default.writeFile(node_path_1.default.join(PRIVATE_ROOT, relPath), buffer);
    return relPath.split(node_path_1.default.sep).join('/'); // luôn lưu DB dạng posix path
}
/** Đọc lại file theo path tương đối đã lưu trong DB, có chống path traversal. */
async function readEvidenceImage(relPath) {
    const safeRel = node_path_1.default.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
    const absPath = node_path_1.default.join(PRIVATE_ROOT, safeRel);
    if (!absPath.startsWith(PRIVATE_ROOT)) {
        throw new Error('Đường dẫn không hợp lệ');
    }
    return promises_1.default.readFile(absPath);
}
async function deleteEvidenceImage(relPath) {
    const safeRel = node_path_1.default.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
    const absPath = node_path_1.default.join(PRIVATE_ROOT, safeRel);
    if (!absPath.startsWith(PRIVATE_ROOT))
        return;
    await promises_1.default.rm(absPath, { force: true });
}
//# sourceMappingURL=storage.js.map