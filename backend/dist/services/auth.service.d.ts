import { AuthPayload } from '../models/types.js';
export declare function signupLecturer(name: string, loginId: string, password: string): Promise<AuthPayload>;
export declare function loginUser(loginId: string, enteredPassword: string): Promise<AuthPayload>;
export declare function signupAndAddStudentToClass(name: string, loginId: string, password: string, classId: number): Promise<void>;
export declare function saveRefreshToken(userId: number, token: string, expiresAt: Date): Promise<void>;
export declare function findRefreshToken(token: string): Promise<{
    id: number;
    user_id: number;
    expires_at: Date;
} | null>;
export declare function deleteRefreshToken(token: string): Promise<void>;
export declare function deleteAllUserRefreshTokens(userId: number): Promise<void>;
//# sourceMappingURL=auth.service.d.ts.map