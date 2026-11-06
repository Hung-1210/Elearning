"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClass = createClass;
exports.updateClassName = updateClassName;
exports.deleteClass = deleteClass;
exports.getAllLecturerClasses = getAllLecturerClasses;
exports.getAllStudentClasses = getAllStudentClasses;
exports.getClassById = getClassById;
exports.checkClassExists = checkClassExists;
exports.checkUserAccessToClass = checkUserAccessToClass;
exports.joinClassWithInviteCode = joinClassWithInviteCode;
exports.toggleClassInviteStatus = toggleClassInviteStatus;
exports.getAllStudentsOfClass = getAllStudentsOfClass;
exports.removeStudentFromClass = removeStudentFromClass;
exports.getClassAttachFiles = getClassAttachFiles;
exports.attachFileToClass = attachFileToClass;
exports.removeAttachFileFromClass = removeAttachFileFromClass;
const database_js_1 = require("../config/database.js");
async function createClass(lecturerId, name) {
    const row = await (0, database_js_1.queryOne)(`INSERT INTO classes (name, lecturer_id)
     VALUES ($1, $2)
     RETURNING *`, [name, lecturerId]);
    if (!row)
        throw new Error('Không thể tạo lớp học');
    return row;
}
async function updateClassName(classId, newName) {
    await (0, database_js_1.query)('UPDATE classes SET name = $1 WHERE id = $2', [newName, classId]);
}
async function deleteClass(classId) {
    await (0, database_js_1.query)('DELETE FROM classes WHERE id = $1', [classId]);
}
async function getAllLecturerClasses(lecturerId) {
    return (0, database_js_1.query)(`SELECT c.*, 
            COUNT(DISTINCT cs.student_id) AS member_count
     FROM classes c
     LEFT JOIN classes_n_students cs ON c.id = cs.class_id
     WHERE c.lecturer_id = $1
     GROUP BY c.id
     ORDER BY c.id DESC`, [lecturerId]);
}
async function getAllStudentClasses(studentId) {
    return (0, database_js_1.query)(`SELECT c.*,
            u.name AS lecturer_name,
            COUNT(DISTINCT cs2.student_id) AS member_count
     FROM classes c
     JOIN classes_n_students cs ON c.id = cs.class_id AND cs.student_id = $1
     JOIN users u ON c.lecturer_id = u.id
     LEFT JOIN classes_n_students cs2 ON c.id = cs2.class_id
     GROUP BY c.id, u.name
     ORDER BY c.id DESC`, [studentId]);
}
async function getClassById(classId) {
    return (0, database_js_1.queryOne)(`SELECT c.*,
            u.name AS lecturer_name,
            COUNT(DISTINCT cs.student_id) AS member_count
     FROM classes c
     JOIN users u ON c.lecturer_id = u.id
     LEFT JOIN classes_n_students cs ON c.id = cs.class_id
     WHERE c.id = $1
     GROUP BY c.id, u.name`, [classId]);
}
async function checkClassExists(classId) {
    const row = await (0, database_js_1.queryOne)('SELECT id FROM classes WHERE id = $1', [classId]);
    return !!row;
}
async function checkUserAccessToClass(userId, classId) {
    // Is lecturer of class?
    const isLecturer = await (0, database_js_1.queryOne)('SELECT 1 FROM classes WHERE id = $1 AND lecturer_id = $2', [classId, userId]);
    if (isLecturer)
        return true;
    // Is student in class?
    const isStudent = await (0, database_js_1.queryOne)('SELECT 1 FROM classes_n_students WHERE class_id = $1 AND student_id = $2', [classId, userId]);
    return !!isStudent;
}
async function joinClassWithInviteCode(studentId, inviteCode) {
    // Find class by invite code
    const classRow = await (0, database_js_1.queryOne)('SELECT * FROM classes WHERE invite_code_students = $1 AND is_open_students = TRUE', [inviteCode]);
    if (!classRow) {
        return { classId: 0, success: false };
    }
    // Check if already joined
    const existing = await (0, database_js_1.queryOne)('SELECT 1 FROM classes_n_students WHERE class_id = $1 AND student_id = $2', [classRow.id, studentId]);
    if (existing) {
        return { classId: classRow.id, success: false };
    }
    // Make sure student exists in students table
    const isStudent = await (0, database_js_1.queryOne)('SELECT 1 FROM students WHERE id = $1', [studentId]);
    if (!isStudent) {
        await (0, database_js_1.query)('INSERT INTO students (id) VALUES ($1) ON CONFLICT DO NOTHING', [studentId]);
    }
    // Add student to class
    await (0, database_js_1.query)('INSERT INTO classes_n_students (class_id, student_id) VALUES ($1, $2)', [classRow.id, studentId]);
    return { classId: classRow.id, success: true };
}
async function toggleClassInviteStatus(classId, isOpen) {
    await (0, database_js_1.query)('UPDATE classes SET is_open_students = $1 WHERE id = $2', [isOpen, classId]);
}
async function getAllStudentsOfClass(classId) {
    return (0, database_js_1.query)(`SELECT u.id, u.name, ul.login_id
     FROM classes_n_students cs
     JOIN users u ON cs.student_id = u.id
     JOIN user_login_id ul ON ul.user_id = u.id
     WHERE cs.class_id = $1
     ORDER BY u.name`, [classId]);
}
async function removeStudentFromClass(classId, studentId) {
    await (0, database_js_1.query)('DELETE FROM classes_n_students WHERE class_id = $1 AND student_id = $2', [classId, studentId]);
}
async function getClassAttachFiles(classId) {
    return (0, database_js_1.query)(`SELECT caf.class_id, caf.doc_id, d.file_name, dc.name AS category_name
     FROM class_attach_files caf
     JOIN docs d ON caf.doc_id = d.id
     JOIN doc_categories dc ON d.doc_category_id = dc.id
     WHERE caf.class_id = $1
     ORDER BY dc.name, d.file_name`, [classId]);
}
async function attachFileToClass(classId, docId) {
    await (0, database_js_1.query)('INSERT INTO class_attach_files (class_id, doc_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [classId, docId]);
}
async function removeAttachFileFromClass(classId, docId) {
    await (0, database_js_1.query)('DELETE FROM class_attach_files WHERE class_id = $1 AND doc_id = $2', [classId, docId]);
}
//# sourceMappingURL=class.service.js.map