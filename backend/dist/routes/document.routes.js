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
const documentController = __importStar(require("../controllers/document.controller.js"));
const auth_middleware_js_1 = require("../middleware/auth.middleware.js");
const upload_middleware_js_1 = require("../middleware/upload.middleware.js");
const router = (0, express_1.Router)();
router.use(auth_middleware_js_1.requireLogin);
// All document operations are lecturer-only
router.get('/', auth_middleware_js_1.requireLecturer, documentController.getDocCategoriesAndDocs);
// Categories
router.post('/categories', auth_middleware_js_1.requireLecturer, upload_middleware_js_1.formOnly, documentController.createDocCategory);
router.put('/categories/:id', auth_middleware_js_1.requireLecturer, upload_middleware_js_1.formOnly, documentController.updateDocCategoryName);
router.delete('/categories/:id', auth_middleware_js_1.requireLecturer, documentController.deleteDocCategory);
router.get('/categories/:id/docs', documentController.getDocsByCategory);
// Docs
router.post('/upload', auth_middleware_js_1.requireLecturer, upload_middleware_js_1.uploadArray, documentController.uploadDocs);
router.delete('/:id', auth_middleware_js_1.requireLecturer, upload_middleware_js_1.formOnly, documentController.deleteDoc);
exports.default = router;
//# sourceMappingURL=document.routes.js.map