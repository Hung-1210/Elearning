"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireClassOwnership = requireClassOwnership;
exports.requireClassMembership = requireClassMembership;
const database_js_1 = require("../config/database.js");
const http_error_js_1 = require("../utils/http-error.js");
async function requireClassOwnership(req, res, next) {
    try {
        const classId = Number(req.params.classId ?? req.params.id);
        if (!classId || isNaN(classId)) {
            throw new http_error_js_1.HttpError(400, 'Mã lớp học không hợp lệ');
        }
        const userId = req.user?.userId;
        if (!userId) {
            throw new http_error_js_1.HttpError(401, 'Chưa đăng nhập');
        }
        const owns = await (0, database_js_1.queryOne)(`SELECT 1 FROM classes c
       WHERE c.id = $1 AND (
         c.lecturer_id = $2
         OR EXISTS (SELECT 1 FROM class_collaborators cc WHERE cc.class_id = c.id AND cc.lecturer_id = $2)
       )`, [classId, userId]);
        if (!owns) {
            throw new http_error_js_1.HttpError(403, 'Bạn không có quyền quản trị lớp học này');
        }
        next();
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
}
async function requireClassMembership(req, res, next) {
    try {
        const classId = Number(req.params.classId ?? req.params.id);
        if (!classId || isNaN(classId)) {
            throw new http_error_js_1.HttpError(400, 'Mã lớp học không hợp lệ');
        }
        const { userId, isLecturer } = req.user ?? {};
        if (!userId) {
            throw new http_error_js_1.HttpError(401, 'Chưa đăng nhập');
        }
        if (isLecturer) {
            const owns = await (0, database_js_1.queryOne)(`SELECT 1 FROM classes c
         WHERE c.id = $1 AND (
           c.lecturer_id = $2
           OR EXISTS (SELECT 1 FROM class_collaborators cc WHERE cc.class_id = c.id AND cc.lecturer_id = $2)
         )`, [classId, userId]);
            if (!owns) {
                throw new http_error_js_1.HttpError(403, 'Bạn không thuộc danh sách giảng viên của lớp này');
            }
            return next();
        }
        const enrolled = await (0, database_js_1.queryOne)(`SELECT 1 FROM classes_n_students WHERE class_id = $1 AND student_id = $2`, [classId, userId]);
        if (!enrolled) {
            throw new http_error_js_1.HttpError(403, 'Bạn chưa tham gia lớp học này');
        }
        next();
    }
    catch (err) {
        (0, http_error_js_1.sendError)(res, err);
    }
}
//# sourceMappingURL=class-access.middleware.js.map