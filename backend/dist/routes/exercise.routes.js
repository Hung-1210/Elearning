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
const exerciseController = __importStar(require("../controllers/exercise.controller.js"));
const auth_middleware_js_1 = require("../middleware/auth.middleware.js");
const upload_middleware_js_1 = require("../middleware/upload.middleware.js");
const router = (0, express_1.Router)();
router.use(auth_middleware_js_1.requireLogin);
// Exercises of a class
router.get('/class/:classId', exerciseController.getExercisesByClass);
// Lecturer routes
router.post('/', auth_middleware_js_1.requireLecturer, upload_middleware_js_1.formOnly, exerciseController.createExercise);
router.put('/:id', auth_middleware_js_1.requireLecturer, upload_middleware_js_1.formOnly, exerciseController.updateExercise);
router.delete('/:id', auth_middleware_js_1.requireLecturer, upload_middleware_js_1.formOnly, exerciseController.deleteExercise);
router.get('/:id', auth_middleware_js_1.requireLecturer, exerciseController.getExerciseForLecturer);
// Submission management (lecturer)
router.get('/class/:classId/submissions/:exerciseId', auth_middleware_js_1.requireLecturer, exerciseController.getSubmissionStatus);
router.get('/class/:classId/submissions/:exerciseId/download', auth_middleware_js_1.requireLecturer, exerciseController.downloadSubmissions);
// Student submission routes
router.post('/:exerciseId/submit', auth_middleware_js_1.requireStudent, upload_middleware_js_1.uploadArray, exerciseController.submitExercise);
router.delete('/:exerciseId/submit', auth_middleware_js_1.requireStudent, upload_middleware_js_1.formOnly, exerciseController.unsubmitExercise);
router.get('/:exerciseId/submit', auth_middleware_js_1.requireStudent, exerciseController.getSubmittedFiles);
router.delete('/:exerciseId/submit/file', auth_middleware_js_1.requireStudent, upload_middleware_js_1.formOnly, exerciseController.deleteSubmittedFile);
exports.default = router;
//# sourceMappingURL=exercise.routes.js.map