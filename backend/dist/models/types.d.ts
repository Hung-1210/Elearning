export interface UserRow {
    id: number;
    is_lecturer: boolean;
    name: string;
    phone_number: string | null;
    email: string | null;
    password: string;
}
export interface LoginIdRow {
    id: number;
    user_id: number;
    login_id: string;
}
export interface AuthPayload {
    userId: number;
    name: string;
    isLecturer: boolean;
}
export interface TokenPair {
    accessToken: string;
    refreshToken: string;
}
export interface ClassRow {
    id: number;
    name: string;
    lecturer_id: number;
    invite_code_students: string;
    is_open_students: boolean;
}
export interface ClassWithMeta extends ClassRow {
    lecturer_name?: string;
    member_count?: number;
}
export interface DocCategoryRow {
    id: number;
    name: string;
    lecturer_id: number;
}
export interface DocRow {
    id: number;
    file_name: string;
    doc_category_id: number;
    category_name?: string;
}
export interface ExerciseRow {
    id: number;
    class_id: number;
    start_time: Date;
    end_time: Date;
    name: string;
    description: string | null;
}
export interface ExerciseWithMeta extends ExerciseRow {
    submission_count?: number;
    submission_status?: 'not_submitted' | 'in_progress' | 'submitted';
    attach_files?: DocRow[];
}
export interface SubmittedExerciseRow {
    id: number;
    student_id: number;
    exercise_id: number;
    submit_time: Date;
    is_submitted: boolean;
}
export interface SubmittedFileRow {
    id: number;
    submitted_exercises_id: number;
    file_name: string;
}
export interface MeetingRow {
    id: number;
    class_id: number;
    start_time: Date;
    end_time: Date;
    name: string;
    description: string | null;
    meeting_code: string;
}
export interface MeetingWithStatus extends MeetingRow {
    status: 'not-started' | 'started' | 'ended';
}
export interface StudentRow {
    id: number;
    name: string;
    login_id: string;
    submission_status?: string;
    submitted_files?: string;
}
export interface UploadedFile {
    id: number;
    file_name: string;
}
export interface ApiResponse<T = unknown> {
    success: boolean;
    message?: string;
    data?: T;
    error?: string;
}
//# sourceMappingURL=types.d.ts.map