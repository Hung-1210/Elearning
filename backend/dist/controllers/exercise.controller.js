"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExercisesByClass = getExercisesByClass;
exports.createExercise = createExercise;
exports.updateExercise = updateExercise;
exports.deleteExercise = deleteExercise;
exports.getExerciseForLecturer = getExerciseForLecturer;
exports.getSubmissionStatus = getSubmissionStatus;
exports.downloadSubmissions = downloadSubmissions;
exports.submitExercise = submitExercise;
exports.unsubmitExercise = unsubmitExercise;
exports.getSubmittedFiles = getSubmittedFiles;
exports.deleteSubmittedFile = deleteSubmittedFile;
const exerciseService = __importStar(require("../services/exercise.service.js"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const archiver_1 = __importDefault(require("archiver"));
const UPLOADS_DIR = path_1.default.join(process.cwd(), 'uploads');
const p = (v) => parseInt(Array.isArray(v) ? v[0] : v, 10);
async function getExercisesByClass(req, res) {
    try {
        const classId = p(req.params.classId);
        const { userId, isLecturer } = req.user;
        const exercises = await exerciseService.getAllExercisesForClass(classId, userId, isLecturer);
        res.json({ success: true, data: exercises });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function createExercise(req, res) {
    try {
        const { classId, name, description, startTime, endTime, attachFileIds } = req.body;
        const exercise = await exerciseService.createExercise(parseInt(classId, 10), startTime, endTime, name, description ?? '');
        const fileIds = JSON.parse(attachFileIds || '[]');
        for (const docId of fileIds) {
            await exerciseService.attachFileToExercise(exercise.id, docId);
        }
        const fullExercise = await exerciseService.getExerciseInfoForLecturer(exercise.id);
        const attachFiles = await exerciseService.getAttachFilesOfExercise(exercise.id);
        res.status(201).json({ success: true, data: { ...fullExercise, attachFiles } });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function updateExercise(req, res) {
    try {
        const exerciseId = p(req.params.id);
        const { name, description, startTime, endTime, attachFileIds } = req.body;
        await exerciseService.updateExercise(exerciseId, startTime, endTime, name, description ?? '');
        await exerciseService.resetExerciseAttachFiles(exerciseId);
        const fileIds = JSON.parse(attachFileIds || '[]');
        for (const docId of fileIds) {
            await exerciseService.attachFileToExercise(exerciseId, docId);
        }
        const fullExercise = await exerciseService.getExerciseInfoForLecturer(exerciseId);
        const attachFiles = await exerciseService.getAttachFilesOfExercise(exerciseId);
        res.json({ success: true, data: { ...fullExercise, attachFiles } });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function deleteExercise(req, res) {
    try {
        const exerciseId = p(req.params.id);
        const submittedFiles = await exerciseService.getAllSubmittedExerciseFiles(exerciseId);
        await Promise.all(submittedFiles.map(({ file_name }) => fs_1.default.promises.unlink(path_1.default.join(UPLOADS_DIR, file_name)).catch(() => { })));
        await exerciseService.deleteExercise(exerciseId);
        res.json({ success: true, message: 'Xóa bài tập thành công' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function getExerciseForLecturer(req, res) {
    try {
        const exerciseId = p(req.params.id);
        const exercise = await exerciseService.getExerciseInfoForLecturer(exerciseId);
        const attachFiles = await exerciseService.getAttachFilesOfExercise(exerciseId);
        res.json({ success: true, data: { ...exercise, attachFiles } });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function getSubmissionStatus(req, res) {
    try {
        const classId = p(req.params.classId);
        const exerciseId = p(req.params.exerciseId);
        const students = await exerciseService.getStudentsSubmissionStatus(classId, exerciseId);
        res.json({ success: true, data: students });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function downloadSubmissions(req, res) {
    try {
        const { userId } = req.user;
        const classId = p(req.params.classId);
        const exerciseId = p(req.params.exerciseId);
        const listOfStudentAndFiles = await exerciseService.getStudentsSubmissionStatusWithFiles(classId, exerciseId);
        const exercise = await exerciseService.getExerciseInfoForLecturer(exerciseId);
        const tempDir = path_1.default.join(UPLOADS_DIR, userId.toString(), `submissions-${exerciseId}-${Date.now()}`);
        fs_1.default.mkdirSync(tempDir, { recursive: true });
        for (const student of listOfStudentAndFiles) {
            const folderName = student.submitted_files ? student.login_id : `${student.login_id} (Chưa nộp bài)`;
            const studentDir = path_1.default.join(tempDir, folderName);
            fs_1.default.mkdirSync(studentDir, { recursive: true });
            if (student.submitted_files) {
                const files = student.submitted_files.split(',').filter(Boolean);
                for (const filePath of files) {
                    const src = path_1.default.join(UPLOADS_DIR, filePath);
                    if (fs_1.default.existsSync(src)) {
                        const fileName = path_1.default.basename(filePath).replace(/^\d+-/, '');
                        fs_1.default.copyFileSync(src, path_1.default.join(studentDir, fileName));
                    }
                }
            }
        }
        const zipPath = `${tempDir}.zip`;
        const output = fs_1.default.createWriteStream(zipPath);
        const archive = (0, archiver_1.default)('zip', { zlib: { level: 9 } });
        output.on('close', () => {
            res.download(zipPath, `submissions-${exercise?.name ?? exerciseId}.zip`, () => {
                fs_1.default.rmSync(tempDir, { recursive: true, force: true });
                fs_1.default.unlinkSync(zipPath);
            });
        });
        archive.pipe(output);
        archive.directory(tempDir, false);
        await archive.finalize();
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function submitExercise(req, res) {
    try {
        const { userId } = req.user;
        const exerciseId = p(req.params.exerciseId);
        const files = req.files;
        const { submitted_exercise_id } = await exerciseService.getOrCreateSubmittedExercise(exerciseId, userId);
        const uploadedFiles = [];
        for (const file of files) {
            const fileName = `${userId}/${file.filename}`;
            const uploaded = await exerciseService.attachFileToSubmittedExercise(submitted_exercise_id, fileName);
            uploadedFiles.push(uploaded);
        }
        await exerciseService.markExerciseAsSubmitted(exerciseId, userId);
        const submissionStatus = await exerciseService.getExerciseInfoForStudent(exerciseId, userId);
        res.json({ success: true, data: { files: uploadedFiles, submissionStatus } });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function unsubmitExercise(req, res) {
    try {
        const { userId } = req.user;
        const exerciseId = parseInt(req.body.exerciseId, 10);
        const files = await exerciseService.getSubmittedExerciseFiles(exerciseId, userId);
        for (const { file_name } of files) {
            await fs_1.default.promises.unlink(path_1.default.join(UPLOADS_DIR, file_name)).catch(() => { });
        }
        await exerciseService.unsubmitExercise(exerciseId, userId);
        res.json({ success: true, message: 'Hủy nộp bài thành công' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function getSubmittedFiles(req, res) {
    try {
        const { userId } = req.user;
        const exerciseId = p(req.params.exerciseId);
        const files = await exerciseService.getSubmittedExerciseFiles(exerciseId, userId);
        res.json({ success: true, data: files });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function deleteSubmittedFile(req, res) {
    try {
        const { userId } = req.user;
        const { fileId, exerciseId, fileName } = req.body;
        const filePath = path_1.default.join(UPLOADS_DIR, userId.toString(), fileName);
        await fs_1.default.promises.unlink(filePath).catch(() => { });
        await exerciseService.deleteSubmittedExerciseFile(parseInt(fileId, 10), userId, parseInt(exerciseId, 10));
        res.json({ success: true, message: 'Xóa file thành công' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
//# sourceMappingURL=exercise.controller.js.map