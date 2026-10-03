import multer, { StorageEngine } from 'multer';
import path from 'path';
import fs from 'fs';
import { Request } from 'express';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const userStorage: StorageEngine = multer.diskStorage({
  destination: (req: Request, _file, cb) => {
    const userId = req.user?.userId;
    if (!userId) {
      cb(new Error('Unauthorized'), '');
      return;
    }
    const userDir = path.join(UPLOADS_DIR, userId.toString());
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    cb(null, userDir);
  },
  filename: (_req, file, cb) => {
    // Handle UTF-8 filenames
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

export const uploadSingle = multer({ storage: userStorage }).single('file');
export const uploadArray = multer({ storage: userStorage }).array('files');
export const uploadFields = (fields: multer.Field[]) =>
  multer({ storage: userStorage }).fields(fields);
export const formOnly = multer().none();
