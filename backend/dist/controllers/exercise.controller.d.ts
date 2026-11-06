import { Request, Response } from 'express';
export declare function getExercisesByClass(req: Request, res: Response): Promise<void>;
export declare function createExercise(req: Request, res: Response): Promise<void>;
export declare function updateExercise(req: Request, res: Response): Promise<void>;
export declare function deleteExercise(req: Request, res: Response): Promise<void>;
export declare function getExerciseForLecturer(req: Request, res: Response): Promise<void>;
export declare function getSubmissionStatus(req: Request, res: Response): Promise<void>;
export declare function downloadSubmissions(req: Request, res: Response): Promise<void>;
export declare function submitExercise(req: Request, res: Response): Promise<void>;
export declare function unsubmitExercise(req: Request, res: Response): Promise<void>;
export declare function getSubmittedFiles(req: Request, res: Response): Promise<void>;
export declare function deleteSubmittedFile(req: Request, res: Response): Promise<void>;
//# sourceMappingURL=exercise.controller.d.ts.map