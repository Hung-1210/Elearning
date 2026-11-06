"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signupLecturer = signupLecturer;
exports.loginUser = loginUser;
exports.signupAndAddStudentToClass = signupAndAddStudentToClass;
exports.saveRefreshToken = saveRefreshToken;
exports.findRefreshToken = findRefreshToken;
exports.deleteRefreshToken = deleteRefreshToken;
exports.deleteAllUserRefreshTokens = deleteAllUserRefreshTokens;
const bcrypt_1 = __importDefault(require("bcrypt"));
const database_js_1 = require("../config/database.js");
const SALT_ROUNDS = 10;
async function signupLecturer(name, loginId, password) {
    // Check if loginId already exists
    const existing = await (0, database_js_1.queryOne)('SELECT id FROM user_login_id WHERE login_id = $1', [loginId]);
    if (existing) {
        throw new Error('Tên đăng nhập đã tồn tại');
    }
    const hashedPassword = await bcrypt_1.default.hash(password, SALT_ROUNDS);
    // Insert user
    const userRow = await (0, database_js_1.queryOne)(`INSERT INTO users (is_lecturer, name, password) VALUES (TRUE, $1, $2) RETURNING *`, [name, hashedPassword]);
    if (!userRow)
        throw new Error('Không thể tạo tài khoản');
    // Insert into lecturers table
    await (0, database_js_1.query)('INSERT INTO lecturers (id) VALUES ($1)', [userRow.id]);
    // Insert login_id
    await (0, database_js_1.query)('INSERT INTO user_login_id (user_id, login_id) VALUES ($1, $2)', [userRow.id, loginId]);
    return {
        userId: userRow.id,
        name: userRow.name,
        isLecturer: true,
    };
}
async function loginUser(loginId, enteredPassword) {
    // Find user by login_id
    const row = await (0, database_js_1.queryOne)(`SELECT u.id, u.name, u.password, u.is_lecturer, ul.login_id
     FROM users u
     JOIN user_login_id ul ON u.id = ul.user_id
     WHERE ul.login_id = $1`, [loginId]);
    if (!row) {
        throw new Error('Tên tài khoản không chính xác');
    }
    const passwordIsCorrect = await bcrypt_1.default.compare(enteredPassword, row.password);
    if (!passwordIsCorrect) {
        throw new Error('Mật khẩu không chính xác');
    }
    return {
        userId: row.id,
        name: row.name,
        isLecturer: row.is_lecturer,
    };
}
async function signupAndAddStudentToClass(name, loginId, password, classId) {
    // Check if loginId exists
    const existingLogin = await (0, database_js_1.queryOne)('SELECT id FROM user_login_id WHERE login_id = $1', [loginId]);
    let studentId;
    if (existingLogin) {
        // Student already has account — check if already in class
        const userRow = await (0, database_js_1.queryOne)('SELECT user_id FROM user_login_id WHERE login_id = $1', [loginId]);
        if (!userRow)
            throw new Error('Không tìm thấy tài khoản');
        studentId = userRow.user_id;
        // Check if student is in the class
        const inClass = await (0, database_js_1.queryOne)('SELECT 1 FROM classes_n_students WHERE class_id = $1 AND student_id = $2', [classId, studentId]);
        if (inClass)
            throw new Error('Học viên đã có mặt trong lớp');
        throw new Error('Học viên đã có tài khoản từ trước');
    }
    const hashedPassword = await bcrypt_1.default.hash(password, SALT_ROUNDS);
    // Insert user
    const userRow = await (0, database_js_1.queryOne)(`INSERT INTO users (is_lecturer, name, password) VALUES (FALSE, $1, $2) RETURNING *`, [name, hashedPassword]);
    if (!userRow)
        throw new Error('Không thể tạo tài khoản');
    studentId = userRow.id;
    // Insert into students table
    await (0, database_js_1.query)('INSERT INTO students (id) VALUES ($1)', [studentId]);
    // Insert login_id
    await (0, database_js_1.query)('INSERT INTO user_login_id (user_id, login_id) VALUES ($1, $2)', [studentId, loginId]);
    // Add to class
    await (0, database_js_1.query)('INSERT INTO classes_n_students (class_id, student_id) VALUES ($1, $2)', [classId, studentId]);
}
async function saveRefreshToken(userId, token, expiresAt) {
    await (0, database_js_1.query)('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)', [userId, token, expiresAt]);
}
async function findRefreshToken(token) {
    return (0, database_js_1.queryOne)('SELECT id, user_id, expires_at FROM refresh_tokens WHERE token = $1', [token]);
}
async function deleteRefreshToken(token) {
    await (0, database_js_1.query)('DELETE FROM refresh_tokens WHERE token = $1', [token]);
}
async function deleteAllUserRefreshTokens(userId) {
    await (0, database_js_1.query)('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
}
//# sourceMappingURL=auth.service.js.map