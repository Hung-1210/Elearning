import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { requireLogin } from '../middleware/auth.middleware.js';

const router = Router();

router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', requireLogin, authController.getMe);

export default router;
