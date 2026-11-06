import { ClassRow, ClassWithMeta } from '../models/types.js';
export declare function createClass(lecturerId: number, name: string): Promise<ClassRow>;
export declare function updateClassName(classId: number, newName: string): Promise<void>;
export declare function deleteClass(classId: number): Promise<void>;
export declare function getAllLecturerClasses(lecturerId: number): Promise<ClassWithMeta[]>;
export declare function getAllStudentClasses(studentId: number): Promise<ClassWithMeta[]>;
export declare function getClassById(classId: number): Promise<ClassWithMeta | null>;
export declare function checkClassExists(classId: number): Promise<boolean>;
export declare function checkUserAccessToClass(userId: number, classId: number): Promise<boolean>;
export declare function joinClassWithInviteCode(studentId: number, inviteCode: string): Promise<{
    classId: number;
    success: boolean;
}>;
export declare function toggleClassInviteStatus(classId: number, isOpen: boolean): Promise<void>;
export declare function getAllStudentsOfClass(classId: number): Promise<{
    id: number;
    name: string;
    login_id: string;
}[]>;
export declare function removeStudentFromClass(classId: number, studentId: number): Promise<void>;
export declare function getClassAttachFiles(classId: number): Promise<{
    class_id: number;
    doc_id: number;
    file_name: string;
    category_name: string;
}[]>;
export declare function attachFileToClass(classId: number, docId: number): Promise<void>;
export declare function removeAttachFileFromClass(classId: number, docId: number): Promise<void>;
//# sourceMappingURL=class.service.d.ts.map