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
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const classController = __importStar(require("../controllers/class.controller.js"));
const auth_middleware_js_1 = require("../middleware/auth.middleware.js");
const upload_middleware_js_1 = require("../middleware/upload.middleware.js");
const router = (0, express_1.Router)();
// All class routes require login
router.use(auth_middleware_js_1.requireLogin);
router.get('/', classController.getMyClasses);
router.post('/', auth_middleware_js_1.requireLecturer, classController.createClass);
router.post('/join', classController.joinClass);
router.get('/:id', classController.getClassById);
router.put('/:id/name', auth_middleware_js_1.requireLecturer, classController.updateClassName);
router.put('/:id/invite-status', auth_middleware_js_1.requireLecturer, classController.toggleInviteStatus);
// Students
router.get('/:id/students', classController.getClassStudents);
router.post('/:id/students/import', auth_middleware_js_1.requireLecturer, upload_middleware_js_1.uploadSingle, classController.importStudents);
router.delete('/:id/students/:studentId', auth_middleware_js_1.requireLecturer, classController.removeStudentFromClass);
// Attach files to class
router.get('/:id/attach-files', classController.getClassAttachFiles);
router.post('/:id/attach-files', auth_middleware_js_1.requireLecturer, classController.attachFile);
router.delete('/:id/attach-files', auth_middleware_js_1.requireLecturer, classController.removeAttachFile);
exports.default = router;
//# sourceMappingURL=class.routes.js.map