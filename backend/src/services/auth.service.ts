import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../config/database.js';
import { UserRow, LoginIdRow, AuthPayload } from '../models/types.js';

const SALT_ROUNDS = 10;

export async function signupLecturer(
  name: string,
  loginId: string,
  password: string
): Promise<AuthPayload> {
  // Check if loginId already exists
  const existing = await queryOne<LoginIdRow>(
    'SELECT id FROM user_login_id WHERE login_id = $1',
    [loginId]
  );
  if (existing) {
    throw new Error('Tên đăng nhập đã tồn tại');
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  // Insert user
  const userRow = await queryOne<UserRow>(
    `INSERT INTO users (is_lecturer, name, password) VALUES (TRUE, $1, $2) RETURNING *`,
    [name, hashedPassword]
  );
  if (!userRow) throw new Error('Không thể tạo tài khoản');

  // Insert into lecturers table
  await query('INSERT INTO lecturers (id) VALUES ($1)', [userRow.id]);

  // Insert login_id
  await query(
    'INSERT INTO user_login_id (user_id, login_id) VALUES ($1, $2)',
    [userRow.id, loginId]
  );

  return {
    userId: userRow.id,
    name: userRow.name,
    isLecturer: true,
  };
}

export async function loginUser(
  loginId: string,
  enteredPassword: string
): Promise<AuthPayload> {
  // Find user by login_id
  const row = await queryOne<{
    id: number;
    name: string;
    password: string;
    is_lecturer: boolean;
    login_id: string;
  }>(
    `SELECT u.id, u.name, u.password, u.is_lecturer, ul.login_id
     FROM users u
     JOIN user_login_id ul ON u.id = ul.user_id
     WHERE ul.login_id = $1`,
    [loginId]
  );

  if (!row) {
    throw new Error('Tên tài khoản không chính xác');
  }

  const passwordIsCorrect = await bcrypt.compare(enteredPassword, row.password);
  if (!passwordIsCorrect) {
    throw new Error('Mật khẩu không chính xác');
  }

  return {
    userId: row.id,
    name: row.name,
    isLecturer: row.is_lecturer,
  };
}

export async function signupAndAddStudentToClass(
  name: string,
  loginId: string,
  password: string,
  classId: number
): Promise<void> {
  // Check if loginId exists
  const existingLogin = await queryOne<LoginIdRow>(
    'SELECT id FROM user_login_id WHERE login_id = $1',
    [loginId]
  );

  let studentId: number;

  if (existingLogin) {
    // Student already has account — check if already in class
    const userRow = await queryOne<{ user_id: number }>(
      'SELECT user_id FROM user_login_id WHERE login_id = $1',
      [loginId]
    );
    if (!userRow) throw new Error('Không tìm thấy tài khoản');
    studentId = userRow.user_id;

    // Check if student is in the class
    const inClass = await queryOne(
      'SELECT 1 FROM classes_n_students WHERE class_id = $1 AND student_id = $2',
      [classId, studentId]
    );
    if (inClass) throw new Error('Học viên đã có mặt trong lớp');

    throw new Error('Học viên đã có tài khoản từ trước');
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  // Insert user
  const userRow = await queryOne<UserRow>(
    `INSERT INTO users (is_lecturer, name, password) VALUES (FALSE, $1, $2) RETURNING *`,
    [name, hashedPassword]
  );
  if (!userRow) throw new Error('Không thể tạo tài khoản');
  studentId = userRow.id;

  // Insert into students table
  await query('INSERT INTO students (id) VALUES ($1)', [studentId]);

  // Insert login_id
  await query(
    'INSERT INTO user_login_id (user_id, login_id) VALUES ($1, $2)',
    [studentId, loginId]
  );

  // Add to class
  await query(
    'INSERT INTO classes_n_students (class_id, student_id) VALUES ($1, $2)',
    [classId, studentId]
  );
}

export async function saveRefreshToken(
  userId: number,
  token: string,
  expiresAt: Date
): Promise<void> {
  await query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expiresAt]
  );
}

export async function findRefreshToken(token: string) {
  return queryOne<{ id: number; user_id: number; expires_at: Date }>(
    'SELECT id, user_id, expires_at FROM refresh_tokens WHERE token = $1',
    [token]
  );
}

export async function deleteRefreshToken(token: string): Promise<void> {
  await query('DELETE FROM refresh_tokens WHERE token = $1', [token]);
}

export async function deleteAllUserRefreshTokens(userId: number): Promise<void> {
  await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
}
