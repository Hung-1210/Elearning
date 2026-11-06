import type { Request, Response, NextFunction } from 'express';
/** Giảng viên phải là chủ lớp (lecturer_id) hoặc collaborator của lớp chứa exam:examId. */
export declare function requireExamOwnership(req: Request, res: Response, next: NextFunction): Promise<void>;
/** Học sinh phải thuộc lớp chứa exam:examId. */
export declare function requireEnrolledInExamClass(req: Request, res: Response, next: NextFunction): Promise<void>;
/**
 * Attempt phải thuộc về chính học sinh đang đăng nhập
 */
export declare function requireAttemptOwner(req: Request, res: Response, next: NextFunction): Promise<void>;
/** Giảng viên xem attempt (giám sát/chấm điểm) - phải là chủ/collaborator của lớp chứa exam đó. */
export declare function requireAttemptExamOwnership(req: Request, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=proctoring-access.middleware.d.ts.map