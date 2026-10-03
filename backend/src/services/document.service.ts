import { query, queryOne } from '../config/database.js';
import { DocCategoryRow, DocRow } from '../models/types.js';

export async function createDocCategory(
  lecturerId: number,
  name: string
): Promise<DocCategoryRow> {
  const row = await queryOne<DocCategoryRow>(
    'INSERT INTO doc_categories (name, lecturer_id) VALUES ($1, $2) RETURNING *',
    [name, lecturerId]
  );
  if (!row) throw new Error('Không thể tạo danh mục tài liệu');
  return row;
}

export async function updateDocCategoryName(
  categoryId: number,
  newName: string
): Promise<void> {
  await query(
    'UPDATE doc_categories SET name = $1 WHERE id = $2',
    [newName, categoryId]
  );
}

export async function deleteDocCategory(categoryId: number): Promise<void> {
  // Cascade deletes docs automatically
  await query('DELETE FROM doc_categories WHERE id = $1', [categoryId]);
}

export async function getAllDocCategoriesAndDocs(lecturerId: number): Promise<{
  doc_category_id: number;
  category_name: string;
  doc_id: number | null;
  file_name: string | null;
}[]> {
  return query(
    `SELECT dc.id AS doc_category_id, dc.name AS category_name,
            d.id AS doc_id, d.file_name
     FROM doc_categories dc
     LEFT JOIN docs d ON d.doc_category_id = dc.id
     WHERE dc.lecturer_id = $1
     ORDER BY dc.id, d.id`,
    [lecturerId]
  );
}

export async function getAllDocsByCategory(categoryId: number): Promise<DocRow[]> {
  return query<DocRow>(
    'SELECT id, file_name, doc_category_id FROM docs WHERE doc_category_id = $1 ORDER BY id',
    [categoryId]
  );
}

export async function createDoc(
  fileName: string,
  docCategoryId: number
): Promise<DocRow> {
  const row = await queryOne<DocRow>(
    'INSERT INTO docs (file_name, doc_category_id) VALUES ($1, $2) RETURNING *',
    [fileName, docCategoryId]
  );
  if (!row) throw new Error('Không thể tạo tài liệu');
  return row;
}

export async function deleteDoc(docId: number): Promise<void> {
  await query('DELETE FROM docs WHERE id = $1', [docId]);
}

export async function checkDocOwnership(
  lecturerId: number,
  docCategoryId: number
): Promise<boolean> {
  const row = await queryOne(
    'SELECT 1 FROM doc_categories WHERE id = $1 AND lecturer_id = $2',
    [docCategoryId, lecturerId]
  );
  return !!row;
}
