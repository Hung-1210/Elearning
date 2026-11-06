import { Request, Response, NextFunction } from 'express';
import { queryOne } from '../config/database.js';
import { HttpError, sendError } from '../utils/http-error.js';

export async function requireClassOwnership(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const classId = Number(req.params.classId ?? req.params.id);
    if (!classId || isNaN(classId)) {
      throw new HttpError(400, 'Mã lớp học không hợp lệ');
    }

    const userId = req.user?.userId;
    if (!userId) {
      throw new HttpError(401, 'Chưa đăng nhập');
    }

    const owns = await queryOne(
      `SELECT 1 FROM classes c
       WHERE c.id = $1 AND (
         c.lecturer_id = $2
         OR EXISTS (SELECT 1 FROM class_collaborators cc WHERE cc.class_id = c.id AND cc.lecturer_id = $2)
       )`,
      [classId, userId]
    );

    if (!owns) {
      throw new HttpError(403, 'Bạn không có quyền quản trị lớp học này');
    }

    next();
  } catch (err) {
    sendError(res, err);
  }
}

export async function requireClassMembership(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const classId = Number(req.params.classId ?? req.params.id);
    if (!classId || isNaN(classId)) {
      throw new HttpError(400, 'Mã lớp học không hợp lệ');
    }

    const { userId, isLecturer } = req.user ?? {};
    if (!userId) {
      throw new HttpError(401, 'Chưa đăng nhập');
    }

    if (isLecturer) {
      const owns = await queryOne(
        `SELECT 1 FROM classes c
         WHERE c.id = $1 AND (
           c.lecturer_id = $2
           OR EXISTS (SELECT 1 FROM class_collaborators cc WHERE cc.class_id = c.id AND cc.lecturer_id = $2)
         )`,
        [classId, userId]
      );
      if (!owns) {
        throw new HttpError(403, 'Bạn không thuộc danh sách giảng viên của lớp này');
      }
      return next();
    }

    const enrolled = await queryOne(
      `SELECT 1 FROM classes_n_students WHERE class_id = $1 AND student_id = $2`,
      [classId, userId]
    );

    if (!enrolled) {
      throw new HttpError(403, 'Bạn chưa tham gia lớp học này');
    }

    next();
  } catch (err) {
    sendError(res, err);
  }
}
