import { Router } from 'express';
import * as documentController from '../controllers/document.controller.js';
import { requireLogin, requireLecturer } from '../middleware/auth.middleware.js';
import { uploadArray, formOnly } from '../middleware/upload.middleware.js';

const router = Router();
router.use(requireLogin);

// All document operations are lecturer-only
router.get('/', requireLecturer, documentController.getDocCategoriesAndDocs);

// Categories
router.post('/categories', requireLecturer, formOnly, documentController.createDocCategory);
router.put('/categories/:id', requireLecturer, formOnly, documentController.updateDocCategoryName);
router.delete('/categories/:id', requireLecturer, documentController.deleteDocCategory);
router.get('/categories/:id/docs', documentController.getDocsByCategory);

// Docs
router.post('/upload', requireLecturer, uploadArray, documentController.uploadDocs);
router.delete('/:id', requireLecturer, formOnly, documentController.deleteDoc);

export default router;
