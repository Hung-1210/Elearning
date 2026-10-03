import { Request, Response } from 'express';
import * as exerciseService from '../services/exercise.service.js';
import { ApiResponse } from '../models/types.js';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const p = (v: string | string[]) => parseInt(Array.isArray(v) ? v[0] : v, 10);

export async function getExercisesByClass(req: Request, res: Response): Promise<void> {
  try {
    const classId = p(req.params.classId);
    const { userId, isLecturer } = req.user!;
    const exercises = await exerciseService.getAllExercisesForClass(classId, userId, isLecturer);
    res.json({ success: true, data: exercises } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function createExercise(req: Request, res: Response): Promise<void> {
  try {
    const { classId, name, description, startTime, endTime, attachFileIds } = req.body;
    const exercise = await exerciseService.createExercise(
      parseInt(classId, 10), startTime, endTime, name, description ?? ''
    );
    const fileIds: number[] = JSON.parse(attachFileIds || '[]');
    for (const docId of fileIds) {
      await exerciseService.attachFileToExercise(exercise.id, docId);
    }
    const fullExercise = await exerciseService.getExerciseInfoForLecturer(exercise.id);
    const attachFiles = await exerciseService.getAttachFilesOfExercise(exercise.id);
    res.status(201).json({ success: true, data: { ...fullExercise, attachFiles } } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function updateExercise(req: Request, res: Response): Promise<void> {
  try {
    const exerciseId = p(req.params.id);
    const { name, description, startTime, endTime, attachFileIds } = req.body;
    await exerciseService.updateExercise(exerciseId, startTime, endTime, name, description ?? '');
    await exerciseService.resetExerciseAttachFiles(exerciseId);
    const fileIds: number[] = JSON.parse(attachFileIds || '[]');
    for (const docId of fileIds) {
      await exerciseService.attachFileToExercise(exerciseId, docId);
    }
    const fullExercise = await exerciseService.getExerciseInfoForLecturer(exerciseId);
    const attachFiles = await exerciseService.getAttachFilesOfExercise(exerciseId);
    res.json({ success: true, data: { ...fullExercise, attachFiles } } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function deleteExercise(req: Request, res: Response): Promise<void> {
  try {
    const exerciseId = p(req.params.id);
    const submittedFiles = await exerciseService.getAllSubmittedExerciseFiles(exerciseId);
    await Promise.all(submittedFiles.map(({ file_name }) =>
      fs.promises.unlink(path.join(UPLOADS_DIR, file_name)).catch(() => {})
    ));
    await exerciseService.deleteExercise(exerciseId);
    res.json({ success: true, message: 'Xóa bài tập thành công' } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function getExerciseForLecturer(req: Request, res: Response): Promise<void> {
  try {
    const exerciseId = p(req.params.id);
    const exercise = await exerciseService.getExerciseInfoForLecturer(exerciseId);
    const attachFiles = await exerciseService.getAttachFilesOfExercise(exerciseId);
    res.json({ success: true, data: { ...exercise, attachFiles } } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function getSubmissionStatus(req: Request, res: Response): Promise<void> {
  try {
    const classId = p(req.params.classId);
    const exerciseId = p(req.params.exerciseId);
    const students = await exerciseService.getStudentsSubmissionStatus(classId, exerciseId);
    res.json({ success: true, data: students } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function downloadSubmissions(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.user!;
    const classId = p(req.params.classId);
    const exerciseId = p(req.params.exerciseId);

    const listOfStudentAndFiles = await exerciseService.getStudentsSubmissionStatusWithFiles(classId, exerciseId);
    const exercise = await exerciseService.getExerciseInfoForLecturer(exerciseId);

    const tempDir = path.join(UPLOADS_DIR, userId.toString(), `submissions-${exerciseId}-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    for (const student of listOfStudentAndFiles) {
      const folderName = student.submitted_files ? student.login_id : `${student.login_id} (Chưa nộp bài)`;
      const studentDir = path.join(tempDir, folderName);
      fs.mkdirSync(studentDir, { recursive: true });

      if (student.submitted_files) {
        const files = student.submitted_files.split(',').filter(Boolean);
        for (const filePath of files) {
          const src = path.join(UPLOADS_DIR, filePath);
          if (fs.existsSync(src)) {
            const fileName = path.basename(filePath).replace(/^\d+-/, '');
            fs.copyFileSync(src, path.join(studentDir, fileName));
          }
        }
      }
    }

    const zipPath = `${tempDir}.zip`;
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      res.download(zipPath, `submissions-${exercise?.name ?? exerciseId}.zip`, () => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.unlinkSync(zipPath);
      });
    });

    archive.pipe(output);
    archive.directory(tempDir, false);
    await archive.finalize();
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function submitExercise(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.user!;
    const exerciseId = p(req.params.exerciseId);
    const files = req.files as Express.Multer.File[];

    const { submitted_exercise_id } = await exerciseService.getOrCreateSubmittedExercise(exerciseId, userId);
    const uploadedFiles = [];
    for (const file of files) {
      const fileName = `${userId}/${file.filename}`;
      const uploaded = await exerciseService.attachFileToSubmittedExercise(submitted_exercise_id, fileName);
      uploadedFiles.push(uploaded);
    }
    await exerciseService.markExerciseAsSubmitted(exerciseId, userId);
    const submissionStatus = await exerciseService.getExerciseInfoForStudent(exerciseId, userId);
    res.json({ success: true, data: { files: uploadedFiles, submissionStatus } } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function unsubmitExercise(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.user!;
    const exerciseId = parseInt(req.body.exerciseId, 10);

    const files = await exerciseService.getSubmittedExerciseFiles(exerciseId, userId);
    for (const { file_name } of files) {
      await fs.promises.unlink(path.join(UPLOADS_DIR, file_name)).catch(() => {});
    }
    await exerciseService.unsubmitExercise(exerciseId, userId);
    res.json({ success: true, message: 'Hủy nộp bài thành công' } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function getSubmittedFiles(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.user!;
    const exerciseId = p(req.params.exerciseId);
    const files = await exerciseService.getSubmittedExerciseFiles(exerciseId, userId);
    res.json({ success: true, data: files } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function deleteSubmittedFile(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.user!;
    const { fileId, exerciseId, fileName } = req.body;
    const filePath = path.join(UPLOADS_DIR, userId.toString(), fileName);
    await fs.promises.unlink(filePath).catch(() => {});
    await exerciseService.deleteSubmittedExerciseFile(parseInt(fileId, 10), userId, parseInt(exerciseId, 10));
    res.json({ success: true, message: 'Xóa file thành công' } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}
