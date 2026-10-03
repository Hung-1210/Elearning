import { Request, Response } from 'express';
import * as documentService from '../services/document.service.js';
import { ApiResponse } from '../models/types.js';
import path from 'path';
import fs from 'fs';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const p = (v: string | string[]) => parseInt(Array.isArray(v) ? v[0] : v, 10);

export async function getDocCategoriesAndDocs(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.user!;
    const result = await documentService.getAllDocCategoriesAndDocs(userId);
    res.json({ success: true, data: result } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function createDocCategory(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.user!;
    const { name } = req.body;
    const category = await documentService.createDocCategory(userId, name);
    res.status(201).json({ success: true, data: category } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function updateDocCategoryName(req: Request, res: Response): Promise<void> {
  try {
    const categoryId = p(req.params.id);
    const { name } = req.body;
    await documentService.updateDocCategoryName(categoryId, name);
    res.json({ success: true, message: 'Đổi tên thành công' } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function deleteDocCategory(req: Request, res: Response): Promise<void> {
  try {
    const categoryId = p(req.params.id);
    const docs = await documentService.getAllDocsByCategory(categoryId);
    for (const doc of docs) {
      const filePath = path.join(UPLOADS_DIR, doc.file_name);
      await fs.promises.unlink(filePath).catch(() => {});
    }
    await documentService.deleteDocCategory(categoryId);
    res.json({ success: true, message: 'Xóa danh mục thành công' } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function uploadDocs(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.user!;
    const { docCategoryId } = req.body;
    const categoryIdNum = parseInt(docCategoryId, 10);

    const isOwner = await documentService.checkDocOwnership(userId, categoryIdNum);
    if (!isOwner) {
      res.status(403).json({ success: false, error: 'Bạn không có quyền' });
      return;
    }

    const files = req.files as Express.Multer.File[];
    const uploaded = [];
    for (const file of files) {
      const fileName = `${userId}/${file.filename}`;
      const doc = await documentService.createDoc(fileName, categoryIdNum);
      uploaded.push(doc);
    }
    res.status(201).json({ success: true, data: uploaded } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function deleteDoc(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.user!;
    const docId = p(req.params.id);
    const { fileName } = req.body;
    const filePath = path.join(UPLOADS_DIR, userId.toString(), path.basename(fileName));
    await fs.promises.unlink(filePath).catch(() => {});
    await documentService.deleteDoc(docId);
    res.json({ success: true, message: 'Xóa tài liệu thành công' } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function getDocsByCategory(req: Request, res: Response): Promise<void> {
  try {
    const categoryId = p(req.params.id);
    const docs = await documentService.getAllDocsByCategory(categoryId);
    res.json({ success: true, data: docs } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}
