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
exports.getDocCategoriesAndDocs = getDocCategoriesAndDocs;
exports.createDocCategory = createDocCategory;
exports.updateDocCategoryName = updateDocCategoryName;
exports.deleteDocCategory = deleteDocCategory;
exports.uploadDocs = uploadDocs;
exports.deleteDoc = deleteDoc;
exports.getDocsByCategory = getDocsByCategory;
const documentService = __importStar(require("../services/document.service.js"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const UPLOADS_DIR = path_1.default.join(process.cwd(), 'uploads');
const p = (v) => parseInt(Array.isArray(v) ? v[0] : v, 10);
async function getDocCategoriesAndDocs(req, res) {
    try {
        const { userId } = req.user;
        const result = await documentService.getAllDocCategoriesAndDocs(userId);
        res.json({ success: true, data: result });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function createDocCategory(req, res) {
    try {
        const { userId } = req.user;
        const { name } = req.body;
        const category = await documentService.createDocCategory(userId, name);
        res.status(201).json({ success: true, data: category });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function updateDocCategoryName(req, res) {
    try {
        const categoryId = p(req.params.id);
        const { name } = req.body;
        await documentService.updateDocCategoryName(categoryId, name);
        res.json({ success: true, message: 'Đổi tên thành công' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function deleteDocCategory(req, res) {
    try {
        const categoryId = p(req.params.id);
        const docs = await documentService.getAllDocsByCategory(categoryId);
        for (const doc of docs) {
            const filePath = path_1.default.join(UPLOADS_DIR, doc.file_name);
            await fs_1.default.promises.unlink(filePath).catch(() => { });
        }
        await documentService.deleteDocCategory(categoryId);
        res.json({ success: true, message: 'Xóa danh mục thành công' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function uploadDocs(req, res) {
    try {
        const { userId } = req.user;
        const { docCategoryId } = req.body;
        const categoryIdNum = parseInt(docCategoryId, 10);
        const isOwner = await documentService.checkDocOwnership(userId, categoryIdNum);
        if (!isOwner) {
            res.status(403).json({ success: false, error: 'Bạn không có quyền' });
            return;
        }
        const files = req.files;
        const uploaded = [];
        for (const file of files) {
            const fileName = `${userId}/${file.filename}`;
            const doc = await documentService.createDoc(fileName, categoryIdNum);
            uploaded.push(doc);
        }
        res.status(201).json({ success: true, data: uploaded });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function deleteDoc(req, res) {
    try {
        const { userId } = req.user;
        const docId = p(req.params.id);
        const { fileName } = req.body;
        const filePath = path_1.default.join(UPLOADS_DIR, userId.toString(), path_1.default.basename(fileName));
        await fs_1.default.promises.unlink(filePath).catch(() => { });
        await documentService.deleteDoc(docId);
        res.json({ success: true, message: 'Xóa tài liệu thành công' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function getDocsByCategory(req, res) {
    try {
        const categoryId = p(req.params.id);
        const docs = await documentService.getAllDocsByCategory(categoryId);
        res.json({ success: true, data: docs });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
//# sourceMappingURL=document.controller.js.map