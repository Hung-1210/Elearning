import { type ProctoringSettings } from '../proctoring/policy.js';
export interface BankQuestionInput {
    questionType: 'single_choice' | 'multiple_choice' | 'essay' | 'file_upload';
    content: string;
    explanation?: string;
    defaultPoints?: number;
    difficulty?: 'easy' | 'medium' | 'hard';
    chapter?: string;
    tags?: string[];
    options?: Array<{
        content: string;
        isCorrect: boolean;
    }>;
}
export declare function createBankQuestion(classId: number, lecturerId: number, input: BankQuestionInput): Promise<any>;
export declare function updateBankQuestion(questionId: number, input: BankQuestionInput): Promise<any>;
export declare function getBankQuestion(id: number): Promise<any>;
export declare function listBankQuestions(classId: number, filters: {
    chapter?: string;
    difficulty?: string;
    questionType?: string;
}): Promise<any[]>;
export declare function deleteBankQuestion(id: number): Promise<void>;
export interface ExamInput {
    name: string;
    description?: string;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    maxAttempts?: number;
    shuffleQuestions?: boolean;
    shuffleOptions?: boolean;
    resultVisibility?: 'immediately' | 'after_close' | 'hidden';
    allowReview?: boolean;
}
export declare function createExam(classId: number, lecturerId: number, input: ExamInput): Promise<any>;
export declare function updateExam(examId: number, input: Partial<ExamInput>): Promise<any>;
/** Đóng đề ngay lập tức nhưng giữ nguyên đề và lịch sử làm bài. */
export declare function closeExam(examId: number): Promise<any>;
/** Xuất bản đề: yêu cầu tối thiểu 1 câu hỏi. */
export declare function publishExam(examId: number): Promise<any>;
export declare function deleteExam(examId: number): Promise<void>;
export declare function listExamsForClass(classId: number): Promise<any[]>;
export declare function getExamForTeacher(examId: number): Promise<any>;
export declare function getExamForStudent(examId: number): Promise<any>;
export declare function addQuestionsFromBank(examId: number, bankQuestionIds: number[]): Promise<number[]>;
export interface ExamQuestionInput {
    questionType: 'single_choice' | 'multiple_choice' | 'essay' | 'file_upload';
    content: string;
    explanation?: string;
    points?: number;
    options?: Array<{
        content: string;
        isCorrect: boolean;
    }>;
}
export declare function addManualQuestion(examId: number, input: ExamQuestionInput): Promise<number>;
export declare function reorderQuestions(examId: number, orderedQuestionIds: number[]): Promise<void>;
export declare function removeExamQuestion(examId: number, examQuestionId: number): Promise<void>;
export declare function updateProctoringSettings(examId: number, input: Partial<ProctoringSettings>): Promise<ProctoringSettings>;
/** Map dòng DB (snake_case) -> ProctoringSettings (camelCase) */
export declare function mapSettingsRow(row: any): ProctoringSettings;
//# sourceMappingURL=exam.service.d.ts.map