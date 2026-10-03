import { Request, Response } from 'express';
import * as classService from '../services/class.service.js';
import * as authService from '../services/auth.service.js';
import { ApiResponse } from '../models/types.js';
import path from 'path';
import fs from 'fs';
import xlsx from 'node-xlsx';
import Utils from '../utils/utils.js';

const p = (v: string | string[]) => parseInt(Array.isArray(v) ? v[0] : v, 10);
const s = (v: string | string[]) => Array.isArray(v) ? v[0] : v;

export async function getMyClasses(req: Request, res: Response): Promise<void> {
  try {
    const { userId, isLecturer } = req.user!;
    const classes = isLecturer
      ? await classService.getAllLecturerClasses(userId)
      : await classService.getAllStudentClasses(userId);
    res.json({ success: true, data: classes } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function getClassById(req: Request, res: Response): Promise<void> {
  try {
    const classId = p(req.params.id);
    const cls = await classService.getClassById(classId);
    if (!cls) {
      res.status(404).json({ success: false, error: 'Không tìm thấy lớp học' });
      return;
    }
    res.json({ success: true, data: cls } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function createClass(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.user!;
    const { name } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ success: false, error: 'Tên lớp không được để trống' });
      return;
    }
    const cls = await classService.createClass(userId, name.trim());
    res.status(201).json({ success: true, data: cls } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function updateClassName(req: Request, res: Response): Promise<void> {
  try {
    const classId = p(req.params.id);
    const { name } = req.body;
    await classService.updateClassName(classId, name);
    res.json({ success: true, message: 'Cập nhật tên lớp thành công' } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function toggleInviteStatus(req: Request, res: Response): Promise<void> {
  try {
    const classId = p(req.params.id);
    const { isOpen } = req.body;
    await classService.toggleClassInviteStatus(classId, Boolean(isOpen));
    res.json({ success: true, message: 'Cập nhật trạng thái mời thành công' } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function joinClass(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.user!;
    const { inviteCode } = req.body;
    const result = await classService.joinClassWithInviteCode(userId, inviteCode);
    res.json({ success: true, data: result } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function getClassStudents(req: Request, res: Response): Promise<void> {
  try {
    const classId = p(req.params.id);
    const students = await classService.getAllStudentsOfClass(classId);
    res.json({ success: true, data: students } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function removeStudentFromClass(req: Request, res: Response): Promise<void> {
  try {
    const classId = p(req.params.id);
    const studentId = p(req.params.studentId);
    await classService.removeStudentFromClass(classId, studentId);
    res.json({ success: true, message: 'Đã xóa học viên khỏi lớp' } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function importStudents(req: Request, res: Response): Promise<void> {
  try {
    const classId = p(req.params.id) || parseInt(req.body.classId, 10);
    const filesObj = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const file = (req as any).file || filesObj?.['file']?.[0];

    if (!file) {
      res.status(400).json({ success: false, error: 'Vui lòng tải lên file Excel' });
      return;
    }

    const workSheets = xlsx.parse(file.path);
    const sheet = workSheets[0].data as (string | number)[][];
    const studentIdCache: (string | number)[] = [];
    const studentsWithPasswords: { id: string | number; name: string; password: string; note: string }[] = [];
    const promises: Promise<void>[] = [];

    for (const row of sheet.slice(1)) {
      if (!row[0] || studentIdCache.includes(row[0])) continue;
      studentIdCache.push(row[0]);

      const student = {
        id: row[0],
        name: String(row[1]).toUpperCase(),
        password: Utils.generateRandomPassword(),
        note: '',
      };

      const promise = authService
        .signupAndAddStudentToClass(student.name, String(student.id), student.password, classId)
        .catch((error: Error) => {
          const errorMessages = ['Học viên đã có mặt trong lớp', 'Học viên đã có tài khoản từ trước'];
          const idx = errorMessages.indexOf(error.message);
          if (idx >= 0) {
            student.password = '';
            student.note = errorMessages[idx];
          } else {
            throw error;
          }
        });

      promises.push(promise);
      studentsWithPasswords.push(student);
    }

    await Promise.all(promises);

    const userId = req.user!.userId;
    const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
    const userDir = path.join(UPLOADS_DIR, userId.toString());
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    const outputPath = path.join(userDir, `${Date.now()}-students_with_passwords.xlsx`);
    const buffer = xlsx.build([{
      name: 'Học viên',
      data: [
        ['Định danh', 'Tên học viên', 'Mật khẩu', 'Ghi chú'],
        ...studentsWithPasswords.map(s => [s.id, s.name, s.password, s.note]),
      ],
      options: {},
    }]);
    fs.writeFileSync(outputPath, buffer);

    const cls = await classService.getClassById(classId);
    res.download(outputPath, `Danh sách tài khoản - ${cls?.name ?? 'class'}.xlsx`, () => {
      fs.unlinkSync(outputPath);
      fs.unlinkSync(file.path);
    });
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function getClassAttachFiles(req: Request, res: Response): Promise<void> {
  try {
    const classId = p(req.params.id);
    const files = await classService.getClassAttachFiles(classId);
    res.json({ success: true, data: files } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function attachFile(req: Request, res: Response): Promise<void> {
  try {
    const classId = p(req.params.id);
    const { docId } = req.body;
    await classService.attachFileToClass(classId, parseInt(docId, 10));
    res.json({ success: true, message: 'Đính kèm file thành công' } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function removeAttachFile(req: Request, res: Response): Promise<void> {
  try {
    const classId = p(req.params.id);
    const docId = parseInt(req.body.docId, 10);
    await classService.removeAttachFileFromClass(classId, docId);
    res.json({ success: true, message: 'Xóa file đính kèm thành công' } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}
