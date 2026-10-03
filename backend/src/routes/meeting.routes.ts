import { Router } from 'express';
import * as meetingController from '../controllers/meeting.controller.js';
import { requireLogin, requireLecturer } from '../middleware/auth.middleware.js';
import { formOnly } from '../middleware/upload.middleware.js';

const router = Router();
router.use(requireLogin);

router.get('/class/:classId', meetingController.getMeetingsOfClass);
router.get('/code/:code', meetingController.getMeetingByCode);
router.get('/:id', meetingController.getMeetingById);

router.post('/', requireLecturer, formOnly, meetingController.createMeeting);
router.put('/:id', requireLecturer, formOnly, meetingController.updateMeeting);
router.delete('/:id', requireLecturer, meetingController.deleteMeeting);

export default router;
