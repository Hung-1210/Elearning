import { Router } from 'express';
import * as exerciseController from '../controllers/exercise.controller.js';
import { requireLogin, requireLecturer, requireStudent } from '../middleware/auth.middleware.js';
import { uploadArray, formOnly } from '../middleware/upload.middleware.js';

const router = Router();
router.use(requireLogin);

// Exercises of a class
router.get('/class/:classId', exerciseController.getExercisesByClass);

// Lecturer routes
router.post('/', requireLecturer, formOnly, exerciseController.createExercise);
router.put('/:id', requireLecturer, formOnly, exerciseController.updateExercise);
router.delete('/:id', requireLecturer, formOnly, exerciseController.deleteExercise);
router.get('/:id', requireLecturer, exerciseController.getExerciseForLecturer);

// Submission management (lecturer)
router.get('/class/:classId/submissions/:exerciseId', requireLecturer, exerciseController.getSubmissionStatus);
router.get('/class/:classId/submissions/:exerciseId/download', requireLecturer, exerciseController.downloadSubmissions);

// Student submission routes
router.post('/:exerciseId/submit', requireStudent, uploadArray, exerciseController.submitExercise);
router.delete('/:exerciseId/submit', requireStudent, formOnly, exerciseController.unsubmitExercise);
router.get('/:exerciseId/submit', requireStudent, exerciseController.getSubmittedFiles);
router.delete('/:exerciseId/submit/file', requireStudent, formOnly, exerciseController.deleteSubmittedFile);

export default router;
