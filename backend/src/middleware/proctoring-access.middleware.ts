// src/middleware/proctoring-access.middleware.ts
import type { Request, Response, NextFunction } from 'express';
import { queryOne } from '../config/database.js';
import { HttpError, sendError } from '../utils/http-error.js';

interface ExamRow { id: number; class_id: number; created_by: number; status: string }
interface AttemptRow { id: number; exam_id: number; student_id: number; status: string; deadline_at: Date }

/** Giảng viên phải là chủ lớp (lecturer_id) hoặc collaborator của lớp chứa exam:examId. */
export async function requireExamOwnership(req: Request, res: Response, next: NextFunction) {
  try {
    const examId = Number(req.params.examId ?? req.params.id);
    if (!Number.isInteger(examId)) throw new HttpError(400, 'examId không hợp lệ');

    const exam = await queryOne<ExamRow>(
      `SELECT e.id, e.class_id, e.created_by, e.status
         FROM exams e WHERE e.id = $1`,
      [examId],
    );
    if (!exam) throw new HttpError(404, 'Không tìm thấy đề thi');

    const lecturerId = req.user!.userId;
    const owns = await queryOne(
      `SELECT 1 FROM classes c
        WHERE c.id = $1 AND (
          c.lecturer_id = $2
          OR EXISTS (SELECT 1 FROM class_collaborators cc WHERE cc.class_id = c.id AND cc.lecturer_id = $2)
        )`,
      [exam.class_id, lecturerId],
    );
    if (!owns) throw new HttpError(403, 'Bạn không có quyền trên đề thi này');

    res.locals.exam = exam;
    next();
  } catch (err) {
    sendError(res, err);
  }
}

/** Học sinh phải thuộc lớp chứa exam:examId. */
export async function requireEnrolledInExamClass(req: Request, res: Response, next: NextFunction) {
  try {
    const examId = Number(req.params.examId ?? req.params.id);
    if (!Number.isInteger(examId)) throw new HttpError(400, 'examId không hợp lệ');

    const exam = await queryOne<ExamRow>(`SELECT id, class_id, created_by, status FROM exams WHERE id = $1`, [examId]);
    if (!exam) throw new HttpError(404, 'Không tìm thấy đề thi');
    if (exam.status !== 'published') throw new HttpError(404, 'Đề thi chưa được mở');

    const studentId = req.user!.userId;
    const enrolled = await queryOne(
      `SELECT 1 FROM classes_n_students WHERE class_id = $1 AND student_id = $2`,
      [exam.class_id, studentId],
    );
    if (!enrolled) throw new HttpError(403, 'Bạn không thuộc lớp học này');

    res.locals.exam = exam;
    next();
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * Attempt phải thuộc về chính học sinh đang đăng nhập
 */
export async function requireAttemptOwner(req: Request, res: Response, next: NextFunction) {
  try {
    const attemptId = Number(req.params.attemptId);
    if (!Number.isInteger(attemptId)) throw new HttpError(400, 'attemptId không hợp lệ');

    const attempt = await queryOne<AttemptRow>(
      `SELECT id, exam_id, student_id, status, deadline_at FROM exam_attempts WHERE id = $1`,
      [attemptId],
    );
    if (!attempt) throw new HttpError(404, 'Không tìm thấy lần làm bài');
    if (attempt.student_id !== req.user!.userId) throw new HttpError(403, 'Không có quyền trên lần làm bài này');

    res.locals.attempt = attempt;
    next();
  } catch (err) {
    sendError(res, err);
  }
}

/** Giảng viên xem attempt (giám sát/chấm điểm) - phải là chủ/collaborator của lớp chứa exam đó. */
export async function requireAttemptExamOwnership(req: Request, res: Response, next: NextFunction) {
  try {
    const attemptId = Number(req.params.attemptId);
    if (!Number.isInteger(attemptId)) throw new HttpError(400, 'attemptId không hợp lệ');

    const row = await queryOne<{ attempt_id: number; exam_id: number; class_id: number }>(
      `SELECT a.id AS attempt_id, e.id AS exam_id, e.class_id
         FROM exam_attempts a JOIN exams e ON e.id = a.exam_id
        WHERE a.id = $1`,
      [attemptId],
    );
    if (!row) throw new HttpError(404, 'Không tìm thấy lần làm bài');

    const lecturerId = req.user!.userId;
    const owns = await queryOne(
      `SELECT 1 FROM classes c
        WHERE c.id = $1 AND (
          c.lecturer_id = $2
          OR EXISTS (SELECT 1 FROM class_collaborators cc WHERE cc.class_id = c.id AND cc.lecturer_id = $2)
        )`,
      [row.class_id, lecturerId],
    );
    if (!owns) throw new HttpError(403, 'Bạn không có quyền trên lần làm bài này');

    res.locals.examId = row.exam_id;
    next();
  } catch (err) {
    sendError(res, err);
  }
}
