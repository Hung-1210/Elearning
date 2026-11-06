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
exports.getMyClasses = getMyClasses;
exports.getClassById = getClassById;
exports.createClass = createClass;
exports.updateClassName = updateClassName;
exports.toggleInviteStatus = toggleInviteStatus;
exports.joinClass = joinClass;
exports.getClassStudents = getClassStudents;
exports.removeStudentFromClass = removeStudentFromClass;
exports.importStudents = importStudents;
exports.getClassAttachFiles = getClassAttachFiles;
exports.attachFile = attachFile;
exports.removeAttachFile = removeAttachFile;
const classService = __importStar(require("../services/class.service.js"));
const authService = __importStar(require("../services/auth.service.js"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const node_xlsx_1 = __importDefault(require("node-xlsx"));
const utils_js_1 = __importDefault(require("../utils/utils.js"));
const p = (v) => parseInt(Array.isArray(v) ? v[0] : v, 10);
const s = (v) => Array.isArray(v) ? v[0] : v;
async function getMyClasses(req, res) {
    try {
        const { userId, isLecturer } = req.user;
        const classes = isLecturer
            ? await classService.getAllLecturerClasses(userId)
            : await classService.getAllStudentClasses(userId);
        res.json({ success: true, data: classes });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function getClassById(req, res) {
    try {
        const classId = p(req.params.id);
        const cls = await classService.getClassById(classId);
        if (!cls) {
            res.status(404).json({ success: false, error: 'Không tìm thấy lớp học' });
            return;
        }
        res.json({ success: true, data: cls });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function createClass(req, res) {
    try {
        const { userId } = req.user;
        const { name } = req.body;
        if (!name?.trim()) {
            res.status(400).json({ success: false, error: 'Tên lớp không được để trống' });
            return;
        }
        const cls = await classService.createClass(userId, name.trim());
        res.status(201).json({ success: true, data: cls });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function updateClassName(req, res) {
    try {
        const classId = p(req.params.id);
        const { name } = req.body;
        await classService.updateClassName(classId, name);
        res.json({ success: true, message: 'Cập nhật tên lớp thành công' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function toggleInviteStatus(req, res) {
    try {
        const classId = p(req.params.id);
        const { isOpen } = req.body;
        await classService.toggleClassInviteStatus(classId, Boolean(isOpen));
        res.json({ success: true, message: 'Cập nhật trạng thái mời thành công' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function joinClass(req, res) {
    try {
        const { userId } = req.user;
        const { inviteCode } = req.body;
        const result = await classService.joinClassWithInviteCode(userId, inviteCode);
        res.json({ success: true, data: result });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function getClassStudents(req, res) {
    try {
        const classId = p(req.params.id);
        const students = await classService.getAllStudentsOfClass(classId);
        res.json({ success: true, data: students });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function removeStudentFromClass(req, res) {
    try {
        const classId = p(req.params.id);
        const studentId = p(req.params.studentId);
        await classService.removeStudentFromClass(classId, studentId);
        res.json({ success: true, message: 'Đã xóa học viên khỏi lớp' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function importStudents(req, res) {
    try {
        const classId = p(req.params.id) || parseInt(req.body.classId, 10);
        const filesObj = req.files;
        const file = req.file || filesObj?.['file']?.[0];
        if (!file) {
            res.status(400).json({ success: false, error: 'Vui lòng tải lên file Excel' });
            return;
        }
        const workSheets = node_xlsx_1.default.parse(file.path);
        const sheet = workSheets[0].data;
        const studentIdCache = [];
        const studentsWithPasswords = [];
        const promises = [];
        for (const row of sheet.slice(1)) {
            if (!row[0] || studentIdCache.includes(row[0]))
                continue;
            studentIdCache.push(row[0]);
            const student = {
                id: row[0],
                name: String(row[1]).toUpperCase(),
                password: utils_js_1.default.generateRandomPassword(),
                note: '',
            };
            const promise = authService
                .signupAndAddStudentToClass(student.name, String(student.id), student.password, classId)
                .catch((error) => {
                const errorMessages = ['Học viên đã có mặt trong lớp', 'Học viên đã có tài khoản từ trước'];
                const idx = errorMessages.indexOf(error.message);
                if (idx >= 0) {
                    student.password = '';
                    student.note = errorMessages[idx];
                }
                else {
                    throw error;
                }
            });
            promises.push(promise);
            studentsWithPasswords.push(student);
        }
        await Promise.all(promises);
        const userId = req.user.userId;
        const UPLOADS_DIR = path_1.default.join(process.cwd(), 'uploads');
        const userDir = path_1.default.join(UPLOADS_DIR, userId.toString());
        if (!fs_1.default.existsSync(userDir))
            fs_1.default.mkdirSync(userDir, { recursive: true });
        const outputPath = path_1.default.join(userDir, `${Date.now()}-students_with_passwords.xlsx`);
        const buffer = node_xlsx_1.default.build([{
                name: 'Học viên',
                data: [
                    ['Định danh', 'Tên học viên', 'Mật khẩu', 'Ghi chú'],
                    ...studentsWithPasswords.map(s => [s.id, s.name, s.password, s.note]),
                ],
                options: {},
            }]);
        fs_1.default.writeFileSync(outputPath, buffer);
        const cls = await classService.getClassById(classId);
        res.download(outputPath, `Danh sách tài khoản - ${cls?.name ?? 'class'}.xlsx`, () => {
            fs_1.default.unlinkSync(outputPath);
            fs_1.default.unlinkSync(file.path);
        });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function getClassAttachFiles(req, res) {
    try {
        const classId = p(req.params.id);
        const files = await classService.getClassAttachFiles(classId);
        res.json({ success: true, data: files });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function attachFile(req, res) {
    try {
        const classId = p(req.params.id);
        const { docId } = req.body;
        await classService.attachFileToClass(classId, parseInt(docId, 10));
        res.json({ success: true, message: 'Đính kèm file thành công' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function removeAttachFile(req, res) {
    try {
        const classId = p(req.params.id);
        const docId = parseInt(req.body.docId, 10);
        await classService.removeAttachFileFromClass(classId, docId);
        res.json({ success: true, message: 'Xóa file đính kèm thành công' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
//# sourceMappingURL=class.controller.js.map