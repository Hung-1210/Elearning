export declare const PROCTORING_DIR = "proctoring";
/** Ghi buffer ảnh, trả về path TƯƠNG ĐỐI để lưu vào cột proctoring_evidence.file_path. */
export declare function saveEvidenceImage(attemptId: number, buffer: Buffer): Promise<string>;
/** Đọc lại file theo path tương đối đã lưu trong DB, có chống path traversal. */
export declare function readEvidenceImage(relPath: string): Promise<Buffer>;
export declare function deleteEvidenceImage(relPath: string): Promise<void>;
//# sourceMappingURL=storage.d.ts.map