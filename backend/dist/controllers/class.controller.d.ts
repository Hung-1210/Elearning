import { Request, Response } from 'express';
export declare function getMyClasses(req: Request, res: Response): Promise<void>;
export declare function getClassById(req: Request, res: Response): Promise<void>;
export declare function createClass(req: Request, res: Response): Promise<void>;
export declare function updateClassName(req: Request, res: Response): Promise<void>;
export declare function toggleInviteStatus(req: Request, res: Response): Promise<void>;
export declare function joinClass(req: Request, res: Response): Promise<void>;
export declare function getClassStudents(req: Request, res: Response): Promise<void>;
export declare function removeStudentFromClass(req: Request, res: Response): Promise<void>;
export declare function importStudents(req: Request, res: Response): Promise<void>;
export declare function getClassAttachFiles(req: Request, res: Response): Promise<void>;
export declare function attachFile(req: Request, res: Response): Promise<void>;
export declare function removeAttachFile(req: Request, res: Response): Promise<void>;
//# sourceMappingURL=class.controller.d.ts.map