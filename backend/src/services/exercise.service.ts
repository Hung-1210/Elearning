import { query, queryOne } from '../config/database.js';
import { ExerciseRow, ExerciseWithMeta, SubmittedFileRow } from '../models/types.js';

export async function createExercise(
  classId: number,
  startTime: string,
  endTime: string,
  name: string,
  description: string
): Promise<ExerciseRow> {
  const row = await queryOne<ExerciseRow>(
    `INSERT INTO exercises (class_id, start_time, end_time, name, description)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [classId, startTime, endTime, name, description]
  );
  if (!row) throw new Error('Không thể tạo bài tập');
  return row;
}

export async function updateExercise(
  exerciseId: number,
  startTime: string,
  endTime: string,
  name: string,
  description: string
): Promise<void> {
  await query(
    `UPDATE exercises
     SET start_time = $1, end_time = $2, name = $3, description = $4
     WHERE id = $5`,
    [startTime, endTime, name, description, exerciseId]
  );
}

export async function deleteExercise(exerciseId: number): Promise<void> {
  await query('DELETE FROM exercises WHERE id = $1', [exerciseId]);
}

export async function getExerciseById(
  exerciseId: number
): Promise<ExerciseRow | null> {
  return queryOne<ExerciseRow>(
    'SELECT * FROM exercises WHERE id = $1',
    [exerciseId]
  );
}

export async function getExerciseIdsForClass(
  classId: number
): Promise<{ id: number }[]> {
  return query<{ id: number }>(
    'SELECT id FROM exercises WHERE class_id = $1 ORDER BY id DESC',
    [classId]
  );
}

export async function getAllExercisesForClass(
  classId: number,
  userId: number,
  isLecturer: boolean
) {
  const exerciseIds = await getExerciseIdsForClass(classId);
  const list = await Promise.all(
    exerciseIds.map(async ({ id }) => {
      const info = isLecturer
        ? await getExerciseInfoForLecturer(id)
        : await getExerciseInfoForStudent(id, userId);
      if (!info) return null;
      const attachFiles = await getAttachFilesOfExercise(id);
      return { ...info, attachFiles };
    })
  );
  return list.filter((ex): ex is NonNullable<typeof ex> => ex !== null);
}

export async function getExerciseInfoForLecturer(
  exerciseId: number
): Promise<ExerciseWithMeta | null> {
  return queryOne<ExerciseWithMeta>(
    `SELECT e.*,
            COUNT(DISTINCT se.id) FILTER (WHERE se.is_submitted = TRUE) AS submission_count
     FROM exercises e
     LEFT JOIN submitted_exercises se ON se.exercise_id = e.id
     WHERE e.id = $1
     GROUP BY e.id`,
    [exerciseId]
  );
}

export async function getExerciseInfoForStudent(
  exerciseId: number,
  studentId: number
): Promise<ExerciseWithMeta | null> {
  return queryOne<ExerciseWithMeta>(
    `SELECT e.*,
            CASE
              WHEN se.id IS NULL THEN 'not_submitted'
              WHEN se.is_submitted = TRUE THEN 'submitted'
              ELSE 'in_progress'
            END AS submission_status
     FROM exercises e
     LEFT JOIN submitted_exercises se ON se.exercise_id = e.id AND se.student_id = $2
     WHERE e.id = $1`,
    [exerciseId, studentId]
  );
}

export async function attachFileToExercise(
  exerciseId: number,
  docId: number
): Promise<void> {
  await query(
    'INSERT INTO exercise_attach_files (exercise_id, doc_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [exerciseId, docId]
  );
}

export async function resetExerciseAttachFiles(exerciseId: number): Promise<void> {
  await query(
    'DELETE FROM exercise_attach_files WHERE exercise_id = $1',
    [exerciseId]
  );
}

export async function getAttachFilesOfExercise(exerciseId: number) {
  return query<{ exercise_id: number; doc_id: number; file_name: string }>(
    `SELECT eaf.exercise_id, eaf.doc_id, d.file_name
     FROM exercise_attach_files eaf
     JOIN docs d ON eaf.doc_id = d.id
     WHERE eaf.exercise_id = $1`,
    [exerciseId]
  );
}

// ── Submissions ───────────────────────────────────────────────
export async function getOrCreateSubmittedExercise(
  exerciseId: number,
  studentId: number
): Promise<{ submitted_exercise_id: number }> {
  // Try to get existing
  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM submitted_exercises WHERE exercise_id = $1 AND student_id = $2',
    [exerciseId, studentId]
  );
  if (existing) return { submitted_exercise_id: existing.id };

  // Create new submission record
  const created = await queryOne<{ id: number }>(
    `INSERT INTO submitted_exercises (exercise_id, student_id, is_submitted)
     VALUES ($1, $2, FALSE)
     RETURNING id`,
    [exerciseId, studentId]
  );
  if (!created) throw new Error('Không thể tạo bài nộp');
  return { submitted_exercise_id: created.id };
}

export async function attachFileToSubmittedExercise(
  submittedExerciseId: number,
  fileName: string
): Promise<SubmittedFileRow> {
  const row = await queryOne<SubmittedFileRow>(
    `INSERT INTO submitted_exercise_attach_file (submitted_exercises_id, file_name)
     VALUES ($1, $2)
     RETURNING *`,
    [submittedExerciseId, fileName]
  );
  if (!row) throw new Error('Không thể đính kèm file');
  return row;
}

export async function getSubmittedExerciseFiles(
  exerciseId: number,
  studentId: number
): Promise<SubmittedFileRow[]> {
  return query<SubmittedFileRow>(
    `SELECT seaf.*
     FROM submitted_exercise_attach_file seaf
     JOIN submitted_exercises se ON seaf.submitted_exercises_id = se.id
     WHERE se.exercise_id = $1 AND se.student_id = $2`,
    [exerciseId, studentId]
  );
}

export async function deleteSubmittedExerciseFile(
  fileId: number,
  studentId: number,
  exerciseId: number
): Promise<void> {
  await query(
    `DELETE FROM submitted_exercise_attach_file
     WHERE id = $1
     AND submitted_exercises_id IN (
       SELECT id FROM submitted_exercises WHERE student_id = $2 AND exercise_id = $3
     )`,
    [fileId, studentId, exerciseId]
  );
}

export async function unsubmitExercise(
  exerciseId: number,
  studentId: number
): Promise<void> {
  // Delete all submitted files
  await query(
    `DELETE FROM submitted_exercise_attach_file
     WHERE submitted_exercises_id IN (
       SELECT id FROM submitted_exercises WHERE exercise_id = $1 AND student_id = $2
     )`,
    [exerciseId, studentId]
  );
  // Reset submission record
  await query(
    'UPDATE submitted_exercises SET is_submitted = FALSE WHERE exercise_id = $1 AND student_id = $2',
    [exerciseId, studentId]
  );
}

export async function markExerciseAsSubmitted(
  exerciseId: number,
  studentId: number
): Promise<void> {
  await query(
    'UPDATE submitted_exercises SET is_submitted = TRUE WHERE exercise_id = $1 AND student_id = $2',
    [exerciseId, studentId]
  );
}

export async function getStudentsSubmissionStatus(classId: number, exerciseId: number) {
  return query<{
    student_id: number;
    login_id: string;
    student_name: string;
    submission_status: string;
  }>(
    `SELECT u.id AS student_id, ul.login_id, u.name AS student_name,
            CASE
              WHEN se.id IS NULL THEN 'not_submitted'
              WHEN se.is_submitted = TRUE THEN 'submitted'
              ELSE 'in_progress'
            END AS submission_status
     FROM classes_n_students cns
     JOIN users u ON cns.student_id = u.id
     JOIN user_login_id ul ON ul.user_id = u.id
     LEFT JOIN submitted_exercises se ON se.student_id = cns.student_id AND se.exercise_id = $2
     WHERE cns.class_id = $1
     ORDER BY u.name`,
    [classId, exerciseId]
  );
}

export async function getStudentsSubmissionStatusWithFiles(classId: number, exerciseId: number) {
  return query<{
    student_id: number;
    login_id: string;
    student_name: string;
    submission_status: string;
    submitted_files: string | null;
  }>(
    `SELECT u.id AS student_id, ul.login_id, u.name AS student_name,
            CASE
              WHEN se.id IS NULL THEN 'not_submitted'
              WHEN se.is_submitted = TRUE THEN 'submitted'
              ELSE 'in_progress'
            END AS submission_status,
            STRING_AGG(seaf.file_name, ',') AS submitted_files
     FROM classes_n_students cns
     JOIN users u ON cns.student_id = u.id
     JOIN user_login_id ul ON ul.user_id = u.id
     LEFT JOIN submitted_exercises se ON se.student_id = cns.student_id AND se.exercise_id = $2
     LEFT JOIN submitted_exercise_attach_file seaf ON seaf.submitted_exercises_id = se.id
     WHERE cns.class_id = $1
     GROUP BY u.id, ul.login_id, u.name, se.id
     ORDER BY u.name`,
    [classId, exerciseId]
  );
}

export async function getAllSubmittedExerciseFiles(exerciseId: number): Promise<{ file_name: string }[]> {
  return query<{ file_name: string }>(
    `SELECT seaf.file_name
     FROM submitted_exercise_attach_file seaf
     JOIN submitted_exercises se ON seaf.submitted_exercises_id = se.id
     WHERE se.exercise_id = $1`,
    [exerciseId]
  );
}
