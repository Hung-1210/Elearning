import { ExerciseRow, ExerciseWithMeta, SubmittedFileRow } from '../models/types.js';
export declare function createExercise(classId: number, startTime: string, endTime: string, name: string, description: string): Promise<ExerciseRow>;
export declare function updateExercise(exerciseId: number, startTime: string, endTime: string, name: string, description: string): Promise<void>;
export declare function deleteExercise(exerciseId: number): Promise<void>;
export declare function getExerciseById(exerciseId: number): Promise<ExerciseRow | null>;
export declare function getExerciseIdsForClass(classId: number): Promise<{
    id: number;
}[]>;
export declare function getAllExercisesForClass(classId: number, userId: number, isLecturer: boolean): Promise<{
    attachFiles: {
        exercise_id: number;
        doc_id: number;
        file_name: string;
    }[];
    submission_count?: number;
    submission_status?: "not_submitted" | "in_progress" | "submitted";
    attach_files?: import("../models/types.js").DocRow[];
    id: number;
    class_id: number;
    start_time: Date;
    end_time: Date;
    name: string;
    description: string | null;
}[]>;
export declare function getExerciseInfoForLecturer(exerciseId: number): Promise<ExerciseWithMeta | null>;
export declare function getExerciseInfoForStudent(exerciseId: number, studentId: number): Promise<ExerciseWithMeta | null>;
export declare function attachFileToExercise(exerciseId: number, docId: number): Promise<void>;
export declare function resetExerciseAttachFiles(exerciseId: number): Promise<void>;
export declare function getAttachFilesOfExercise(exerciseId: number): Promise<{
    exercise_id: number;
    doc_id: number;
    file_name: string;
}[]>;
export declare function getOrCreateSubmittedExercise(exerciseId: number, studentId: number): Promise<{
    submitted_exercise_id: number;
}>;
export declare function attachFileToSubmittedExercise(submittedExerciseId: number, fileName: string): Promise<SubmittedFileRow>;
export declare function getSubmittedExerciseFiles(exerciseId: number, studentId: number): Promise<SubmittedFileRow[]>;
export declare function deleteSubmittedExerciseFile(fileId: number, studentId: number, exerciseId: number): Promise<void>;
export declare function unsubmitExercise(exerciseId: number, studentId: number): Promise<void>;
export declare function markExerciseAsSubmitted(exerciseId: number, studentId: number): Promise<void>;
export declare function getStudentsSubmissionStatus(classId: number, exerciseId: number): Promise<{
    student_id: number;
    login_id: string;
    student_name: string;
    submission_status: string;
}[]>;
export declare function getStudentsSubmissionStatusWithFiles(classId: number, exerciseId: number): Promise<{
    student_id: number;
    login_id: string;
    student_name: string;
    submission_status: string;
    submitted_files: string | null;
}[]>;
export declare function getAllSubmittedExerciseFiles(exerciseId: number): Promise<{
    file_name: string;
}[]>;
//# sourceMappingURL=exercise.service.d.ts.map