"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExercise = createExercise;
exports.updateExercise = updateExercise;
exports.deleteExercise = deleteExercise;
exports.getExerciseById = getExerciseById;
exports.getExerciseIdsForClass = getExerciseIdsForClass;
exports.getAllExercisesForClass = getAllExercisesForClass;
exports.getExerciseInfoForLecturer = getExerciseInfoForLecturer;
exports.getExerciseInfoForStudent = getExerciseInfoForStudent;
exports.attachFileToExercise = attachFileToExercise;
exports.resetExerciseAttachFiles = resetExerciseAttachFiles;
exports.getAttachFilesOfExercise = getAttachFilesOfExercise;
exports.getOrCreateSubmittedExercise = getOrCreateSubmittedExercise;
exports.attachFileToSubmittedExercise = attachFileToSubmittedExercise;
exports.getSubmittedExerciseFiles = getSubmittedExerciseFiles;
exports.deleteSubmittedExerciseFile = deleteSubmittedExerciseFile;
exports.unsubmitExercise = unsubmitExercise;
exports.markExerciseAsSubmitted = markExerciseAsSubmitted;
exports.getStudentsSubmissionStatus = getStudentsSubmissionStatus;
exports.getStudentsSubmissionStatusWithFiles = getStudentsSubmissionStatusWithFiles;
exports.getAllSubmittedExerciseFiles = getAllSubmittedExerciseFiles;
const database_js_1 = require("../config/database.js");
async function createExercise(classId, startTime, endTime, name, description) {
    const row = await (0, database_js_1.queryOne)(`INSERT INTO exercises (class_id, start_time, end_time, name, description)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`, [classId, startTime, endTime, name, description]);
    if (!row)
        throw new Error('Không thể tạo bài tập');
    return row;
}
async function updateExercise(exerciseId, startTime, endTime, name, description) {
    await (0, database_js_1.query)(`UPDATE exercises
     SET start_time = $1, end_time = $2, name = $3, description = $4
     WHERE id = $5`, [startTime, endTime, name, description, exerciseId]);
}
async function deleteExercise(exerciseId) {
    await (0, database_js_1.query)('DELETE FROM exercises WHERE id = $1', [exerciseId]);
}
async function getExerciseById(exerciseId) {
    return (0, database_js_1.queryOne)('SELECT * FROM exercises WHERE id = $1', [exerciseId]);
}
async function getExerciseIdsForClass(classId) {
    return (0, database_js_1.query)('SELECT id FROM exercises WHERE class_id = $1 ORDER BY id DESC', [classId]);
}
async function getAllExercisesForClass(classId, userId, isLecturer) {
    const exerciseIds = await getExerciseIdsForClass(classId);
    const list = await Promise.all(exerciseIds.map(async ({ id }) => {
        const info = isLecturer
            ? await getExerciseInfoForLecturer(id)
            : await getExerciseInfoForStudent(id, userId);
        if (!info)
            return null;
        const attachFiles = await getAttachFilesOfExercise(id);
        return { ...info, attachFiles };
    }));
    return list.filter((ex) => ex !== null);
}
async function getExerciseInfoForLecturer(exerciseId) {
    return (0, database_js_1.queryOne)(`SELECT e.*,
            COUNT(DISTINCT se.id) FILTER (WHERE se.is_submitted = TRUE) AS submission_count
     FROM exercises e
     LEFT JOIN submitted_exercises se ON se.exercise_id = e.id
     WHERE e.id = $1
     GROUP BY e.id`, [exerciseId]);
}
async function getExerciseInfoForStudent(exerciseId, studentId) {
    return (0, database_js_1.queryOne)(`SELECT e.*,
            CASE
              WHEN se.id IS NULL THEN 'not_submitted'
              WHEN se.is_submitted = TRUE THEN 'submitted'
              ELSE 'in_progress'
            END AS submission_status
     FROM exercises e
     LEFT JOIN submitted_exercises se ON se.exercise_id = e.id AND se.student_id = $2
     WHERE e.id = $1`, [exerciseId, studentId]);
}
async function attachFileToExercise(exerciseId, docId) {
    await (0, database_js_1.query)('INSERT INTO exercise_attach_files (exercise_id, doc_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [exerciseId, docId]);
}
async function resetExerciseAttachFiles(exerciseId) {
    await (0, database_js_1.query)('DELETE FROM exercise_attach_files WHERE exercise_id = $1', [exerciseId]);
}
async function getAttachFilesOfExercise(exerciseId) {
    return (0, database_js_1.query)(`SELECT eaf.exercise_id, eaf.doc_id, d.file_name
     FROM exercise_attach_files eaf
     JOIN docs d ON eaf.doc_id = d.id
     WHERE eaf.exercise_id = $1`, [exerciseId]);
}
// ── Submissions ───────────────────────────────────────────────
async function getOrCreateSubmittedExercise(exerciseId, studentId) {
    // Try to get existing
    const existing = await (0, database_js_1.queryOne)('SELECT id FROM submitted_exercises WHERE exercise_id = $1 AND student_id = $2', [exerciseId, studentId]);
    if (existing)
        return { submitted_exercise_id: existing.id };
    // Create new submission record
    const created = await (0, database_js_1.queryOne)(`INSERT INTO submitted_exercises (exercise_id, student_id, is_submitted)
     VALUES ($1, $2, FALSE)
     RETURNING id`, [exerciseId, studentId]);
    if (!created)
        throw new Error('Không thể tạo bài nộp');
    return { submitted_exercise_id: created.id };
}
async function attachFileToSubmittedExercise(submittedExerciseId, fileName) {
    const row = await (0, database_js_1.queryOne)(`INSERT INTO submitted_exercise_attach_file (submitted_exercises_id, file_name)
     VALUES ($1, $2)
     RETURNING *`, [submittedExerciseId, fileName]);
    if (!row)
        throw new Error('Không thể đính kèm file');
    return row;
}
async function getSubmittedExerciseFiles(exerciseId, studentId) {
    return (0, database_js_1.query)(`SELECT seaf.*
     FROM submitted_exercise_attach_file seaf
     JOIN submitted_exercises se ON seaf.submitted_exercises_id = se.id
     WHERE se.exercise_id = $1 AND se.student_id = $2`, [exerciseId, studentId]);
}
async function deleteSubmittedExerciseFile(fileId, studentId, exerciseId) {
    await (0, database_js_1.query)(`DELETE FROM submitted_exercise_attach_file
     WHERE id = $1
     AND submitted_exercises_id IN (
       SELECT id FROM submitted_exercises WHERE student_id = $2 AND exercise_id = $3
     )`, [fileId, studentId, exerciseId]);
}
async function unsubmitExercise(exerciseId, studentId) {
    // Delete all submitted files
    await (0, database_js_1.query)(`DELETE FROM submitted_exercise_attach_file
     WHERE submitted_exercises_id IN (
       SELECT id FROM submitted_exercises WHERE exercise_id = $1 AND student_id = $2
     )`, [exerciseId, studentId]);
    // Reset submission record
    await (0, database_js_1.query)('UPDATE submitted_exercises SET is_submitted = FALSE WHERE exercise_id = $1 AND student_id = $2', [exerciseId, studentId]);
}
async function markExerciseAsSubmitted(exerciseId, studentId) {
    await (0, database_js_1.query)('UPDATE submitted_exercises SET is_submitted = TRUE WHERE exercise_id = $1 AND student_id = $2', [exerciseId, studentId]);
}
async function getStudentsSubmissionStatus(classId, exerciseId) {
    return (0, database_js_1.query)(`SELECT u.id AS student_id, ul.login_id, u.name AS student_name,
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
     ORDER BY u.name`, [classId, exerciseId]);
}
async function getStudentsSubmissionStatusWithFiles(classId, exerciseId) {
    return (0, database_js_1.query)(`SELECT u.id AS student_id, ul.login_id, u.name AS student_name,
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
     ORDER BY u.name`, [classId, exerciseId]);
}
async function getAllSubmittedExerciseFiles(exerciseId) {
    return (0, database_js_1.query)(`SELECT seaf.file_name
     FROM submitted_exercise_attach_file seaf
     JOIN submitted_exercises se ON seaf.submitted_exercises_id = se.id
     WHERE se.exercise_id = $1`, [exerciseId]);
}
//# sourceMappingURL=exercise.service.js.map