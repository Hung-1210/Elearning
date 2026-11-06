import type { PoolClient } from 'pg';
import { pool } from '../../config/database.js';
export declare function createPrecheckSession(examId: number, studentId: number, imageBuffer: Buffer): Promise<{
    precheckId: string;
    expiresAt: Date;
}>;
export declare function startAttempt(examId: number, studentId: number, precheckId?: string): Promise<any>;
export declare function getAttemptForStudent(clientOrPool: PoolClient | typeof pool, attemptId: number): Promise<any>;
export declare function saveAnswer(attemptId: number, examQuestionId: number, payload: {
    selectedOptionIds?: number[];
    textAnswer?: string;
    filePath?: string;
    isFlagged?: boolean;
}): Promise<void>;
export declare function submitAttempt(attemptId: number, reason: 'manual' | 'time_up' | 'proctoring' | 'lecturer'): Promise<any>;
export declare function autoSubmitExpiredAttempts(): Promise<number>;
//# sourceMappingURL=attempt.service.d.ts.map