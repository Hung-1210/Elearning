import { Router } from 'express';
import * as classController from '../controllers/class.controller.js';
import { requireLogin, requireLecturer } from '../middleware/auth.middleware.js';
import { uploadArray, uploadFields, uploadSingle } from '../middleware/upload.middleware.js';

const router = Router();

// All class routes require login
router.use(requireLogin);

router.get('/', classController.getMyClasses);
router.post('/', requireLecturer, classController.createClass);
router.post('/join', classController.joinClass);

router.get('/:id', classController.getClassById);
router.put('/:id/name', requireLecturer, classController.updateClassName);
router.put('/:id/invite-status', requireLecturer, classController.toggleInviteStatus);

// Students
router.get('/:id/students', classController.getClassStudents);
router.post(
  '/:id/students/import',
  requireLecturer,
  uploadSingle,
  classController.importStudents
);
router.delete('/:id/students/:studentId', requireLecturer, classController.removeStudentFromClass);

// Attach files to class
router.get('/:id/attach-files', classController.getClassAttachFiles);
router.post('/:id/attach-files', requireLecturer, classController.attachFile);
router.delete('/:id/attach-files', requireLecturer, classController.removeAttachFile);

export default router;
