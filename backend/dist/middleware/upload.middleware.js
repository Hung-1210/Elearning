"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formOnly = exports.uploadFields = exports.uploadArray = exports.uploadSingle = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const UPLOADS_DIR = path_1.default.join(process.cwd(), 'uploads');
// Ensure uploads directory exists
if (!fs_1.default.existsSync(UPLOADS_DIR)) {
    fs_1.default.mkdirSync(UPLOADS_DIR, { recursive: true });
}
const userStorage = multer_1.default.diskStorage({
    destination: (req, _file, cb) => {
        const userId = req.user?.userId;
        if (!userId) {
            cb(new Error('Unauthorized'), '');
            return;
        }
        const userDir = path_1.default.join(UPLOADS_DIR, userId.toString());
        if (!fs_1.default.existsSync(userDir)) {
            fs_1.default.mkdirSync(userDir, { recursive: true });
        }
        cb(null, userDir);
    },
    filename: (_req, file, cb) => {
        // Handle UTF-8 filenames
        file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
        cb(null, `${Date.now()}-${file.originalname}`);
    },
});
exports.uploadSingle = (0, multer_1.default)({ storage: userStorage }).single('file');
exports.uploadArray = (0, multer_1.default)({ storage: userStorage }).array('files');
const uploadFields = (fields) => (0, multer_1.default)({ storage: userStorage }).fields(fields);
exports.uploadFields = uploadFields;
exports.formOnly = (0, multer_1.default)().none();
//# sourceMappingURL=upload.middleware.js.map