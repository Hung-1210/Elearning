import { query, queryOne } from '../config/database.js';
import { ClassRow, ClassWithMeta } from '../models/types.js';

export async function createClass(
  lecturerId: number,
  name: string
): Promise<ClassRow> {
  const row = await queryOne<ClassRow>(
    `INSERT INTO classes (name, lecturer_id)
     VALUES ($1, $2)
     RETURNING *`,
    [name, lecturerId]
  );
  if (!row) throw new Error('Không thể tạo lớp học');
  return row;
}

export async function updateClassName(
  classId: number,
  newName: string
): Promise<void> {
  await query('UPDATE classes SET name = $1 WHERE id = $2', [newName, classId]);
}

export async function deleteClass(classId: number): Promise<void> {
  await query('DELETE FROM classes WHERE id = $1', [classId]);
}

export async function getAllLecturerClasses(
  lecturerId: number
): Promise<ClassWithMeta[]> {
  return query<ClassWithMeta>(
    `SELECT c.*, 
            COUNT(DISTINCT cs.student_id) AS member_count
     FROM classes c
     LEFT JOIN classes_n_students cs ON c.id = cs.class_id
     WHERE c.lecturer_id = $1
     GROUP BY c.id
     ORDER BY c.id DESC`,
    [lecturerId]
  );
}

export async function getAllStudentClasses(
  studentId: number
): Promise<ClassWithMeta[]> {
  return query<ClassWithMeta>(
    `SELECT c.*,
            u.name AS lecturer_name,
            COUNT(DISTINCT cs2.student_id) AS member_count
     FROM classes c
     JOIN classes_n_students cs ON c.id = cs.class_id AND cs.student_id = $1
     JOIN users u ON c.lecturer_id = u.id
     LEFT JOIN classes_n_students cs2 ON c.id = cs2.class_id
     GROUP BY c.id, u.name
     ORDER BY c.id DESC`,
    [studentId]
  );
}

export async function getClassById(classId: number): Promise<ClassWithMeta | null> {
  return queryOne<ClassWithMeta>(
    `SELECT c.*,
            u.name AS lecturer_name,
            COUNT(DISTINCT cs.student_id) AS member_count
     FROM classes c
     JOIN users u ON c.lecturer_id = u.id
     LEFT JOIN classes_n_students cs ON c.id = cs.class_id
     WHERE c.id = $1
     GROUP BY c.id, u.name`,
    [classId]
  );
}

export async function checkClassExists(classId: number): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM classes WHERE id = $1',
    [classId]
  );
  return !!row;
}

export async function checkUserAccessToClass(
  userId: number,
  classId: number
): Promise<boolean> {
  // Is lecturer of class?
  const isLecturer = await queryOne(
    'SELECT 1 FROM classes WHERE id = $1 AND lecturer_id = $2',
    [classId, userId]
  );
  if (isLecturer) return true;

  // Is student in class?
  const isStudent = await queryOne(
    'SELECT 1 FROM classes_n_students WHERE class_id = $1 AND student_id = $2',
    [classId, userId]
  );
  return !!isStudent;
}

export async function joinClassWithInviteCode(
  studentId: number,
  inviteCode: string
): Promise<{ classId: number; success: boolean }> {
  // Find class by invite code
  const classRow = await queryOne<ClassRow>(
    'SELECT * FROM classes WHERE invite_code_students = $1 AND is_open_students = TRUE',
    [inviteCode]
  );

  if (!classRow) {
    return { classId: 0, success: false };
  }

  // Check if already joined
  const existing = await queryOne(
    'SELECT 1 FROM classes_n_students WHERE class_id = $1 AND student_id = $2',
    [classRow.id, studentId]
  );
  if (existing) {
    return { classId: classRow.id, success: false };
  }

  // Make sure student exists in students table
  const isStudent = await queryOne(
    'SELECT 1 FROM students WHERE id = $1',
    [studentId]
  );
  if (!isStudent) {
    await query('INSERT INTO students (id) VALUES ($1) ON CONFLICT DO NOTHING', [studentId]);
  }

  // Add student to class
  await query(
    'INSERT INTO classes_n_students (class_id, student_id) VALUES ($1, $2)',
    [classRow.id, studentId]
  );

  return { classId: classRow.id, success: true };
}

export async function toggleClassInviteStatus(
  classId: number,
  isOpen: boolean
): Promise<void> {
  await query(
    'UPDATE classes SET is_open_students = $1 WHERE id = $2',
    [isOpen, classId]
  );
}

export async function getAllStudentsOfClass(classId: number) {
  return query<{ id: number; name: string; login_id: string }>(
    `SELECT u.id, u.name, ul.login_id
     FROM classes_n_students cs
     JOIN users u ON cs.student_id = u.id
     JOIN user_login_id ul ON ul.user_id = u.id
     WHERE cs.class_id = $1
     ORDER BY u.name`,
    [classId]
  );
}

export async function removeStudentFromClass(
  classId: number,
  studentId: number
): Promise<void> {
  await query('DELETE FROM classes_n_students WHERE class_id = $1 AND student_id = $2', [classId, studentId]);
}

export async function getClassAttachFiles(classId: number) {
  return query<{ class_id: number; doc_id: number; file_name: string; category_name: string }>(
    `SELECT caf.class_id, caf.doc_id, d.file_name, dc.name AS category_name
     FROM class_attach_files caf
     JOIN docs d ON caf.doc_id = d.id
     JOIN doc_categories dc ON d.doc_category_id = dc.id
     WHERE caf.class_id = $1
     ORDER BY dc.name, d.file_name`,
    [classId]
  );
}

export async function attachFileToClass(
  classId: number,
  docId: number
): Promise<void> {
  await query(
    'INSERT INTO class_attach_files (class_id, doc_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [classId, docId]
  );
}

export async function removeAttachFileFromClass(
  classId: number,
  docId: number
): Promise<void> {
  await query(
    'DELETE FROM class_attach_files WHERE class_id = $1 AND doc_id = $2',
    [classId, docId]
  );
}
