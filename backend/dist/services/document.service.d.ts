import { DocCategoryRow, DocRow } from '../models/types.js';
export declare function createDocCategory(lecturerId: number, name: string): Promise<DocCategoryRow>;
export declare function updateDocCategoryName(categoryId: number, newName: string): Promise<void>;
export declare function deleteDocCategory(categoryId: number): Promise<void>;
export declare function getAllDocCategoriesAndDocs(lecturerId: number): Promise<{
    doc_category_id: number;
    category_name: string;
    doc_id: number | null;
    file_name: string | null;
}[]>;
export declare function getAllDocsByCategory(categoryId: number): Promise<DocRow[]>;
export declare function createDoc(fileName: string, docCategoryId: number): Promise<DocRow>;
export declare function deleteDoc(docId: number): Promise<void>;
export declare function checkDocOwnership(lecturerId: number, docCategoryId: number): Promise<boolean>;
//# sourceMappingURL=document.service.d.ts.map