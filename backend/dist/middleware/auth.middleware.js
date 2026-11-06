"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAccessToken = generateAccessToken;
exports.generateRefreshToken = generateRefreshToken;
exports.verifyAccessToken = verifyAccessToken;
exports.verifyRefreshToken = verifyRefreshToken;
exports.requireLogin = requireLogin;
exports.requireLecturer = requireLecturer;
exports.requireStudent = requireStudent;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = require("crypto");
function generateAccessToken(payload) {
    return jsonwebtoken_1.default.sign(payload, process.env.JWT_SECRET, {
        expiresIn: (process.env.JWT_EXPIRES_IN || '15m'),
    });
}
function generateRefreshToken(payload) {
    return jsonwebtoken_1.default.sign(payload, process.env.JWT_REFRESH_SECRET, {
        expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d'),
        jwtid: (0, crypto_1.randomUUID)(),
    });
}
function verifyAccessToken(token) {
    return jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
}
function verifyRefreshToken(token) {
    return jsonwebtoken_1.default.verify(token, process.env.JWT_REFRESH_SECRET);
}
function requireLogin(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
        res.status(401).json({ success: false, error: 'Chưa đăng nhập' });
        return;
    }
    try {
        const payload = verifyAccessToken(token);
        req.user = payload;
        next();
    }
    catch {
        res.status(401).json({ success: false, error: 'Token không hợp lệ hoặc đã hết hạn' });
    }
}
function requireLecturer(req, res, next) {
    if (!req.user?.isLecturer) {
        res.status(403).json({ success: false, error: 'Bạn không có quyền thực hiện thao tác này' });
        return;
    }
    next();
}
function requireStudent(req, res, next) {
    if (req.user?.isLecturer) {
        res.status(403).json({ success: false, error: 'Bạn không có quyền thực hiện thao tác này' });
        return;
    }
    next();
}
//# sourceMappingURL=auth.middleware.js.map