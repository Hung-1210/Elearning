import { Request, Response, NextFunction } from 'express';
import { AuthPayload } from '../models/types.js';
declare global {
    namespace Express {
        interface Request {
            user?: AuthPayload;
        }
    }
}
export declare function generateAccessToken(payload: AuthPayload): string;
export declare function generateRefreshToken(payload: AuthPayload): string;
export declare function verifyAccessToken(token: string): AuthPayload;
export declare function verifyRefreshToken(token: string): AuthPayload;
export declare function requireLogin(req: Request, res: Response, next: NextFunction): void;
export declare function requireLecturer(req: Request, res: Response, next: NextFunction): void;
export declare function requireStudent(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.middleware.d.ts.map