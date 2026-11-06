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
exports.signup = signup;
exports.login = login;
exports.refresh = refresh;
exports.logout = logout;
exports.getMe = getMe;
const authService = __importStar(require("../services/auth.service.js"));
const auth_middleware_js_1 = require("../middleware/auth.middleware.js");
const REFRESH_TOKEN_COOKIE = 'refreshToken';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
async function signup(req, res) {
    try {
        const { name, loginId, password } = req.body;
        if (!name || !loginId || !password) {
            res.status(400).json({ success: false, error: 'Vui lòng điền đầy đủ thông tin' });
            return;
        }
        const payload = await authService.signupLecturer(name, loginId, password);
        const accessToken = (0, auth_middleware_js_1.generateAccessToken)(payload);
        const refreshToken = (0, auth_middleware_js_1.generateRefreshToken)(payload);
        const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
        await authService.saveRefreshToken(payload.userId, refreshToken, expiresAt);
        res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: REFRESH_TOKEN_TTL_MS,
        });
        res.json({
            success: true,
            data: { accessToken, user: payload },
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Lỗi máy chủ';
        res.status(400).json({ success: false, error: message });
    }
}
async function login(req, res) {
    try {
        const { loginId, password } = req.body;
        if (!loginId || !password) {
            res.status(400).json({ success: false, error: 'Vui lòng điền đầy đủ thông tin' });
            return;
        }
        const payload = await authService.loginUser(loginId, password);
        const accessToken = (0, auth_middleware_js_1.generateAccessToken)(payload);
        const refreshToken = (0, auth_middleware_js_1.generateRefreshToken)(payload);
        const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
        await authService.saveRefreshToken(payload.userId, refreshToken, expiresAt);
        res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: REFRESH_TOKEN_TTL_MS,
        });
        res.json({
            success: true,
            data: { accessToken, user: payload },
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Lỗi máy chủ';
        res.status(401).json({ success: false, error: message });
    }
}
async function refresh(req, res) {
    try {
        const token = req.cookies?.[REFRESH_TOKEN_COOKIE];
        if (!token) {
            res.status(401).json({ success: false, error: 'Không có refresh token' });
            return;
        }
        // Verify refresh token exists in DB
        const storedToken = await authService.findRefreshToken(token);
        if (!storedToken || new Date(storedToken.expires_at) < new Date()) {
            res.clearCookie(REFRESH_TOKEN_COOKIE);
            res.status(401).json({ success: false, error: 'Refresh token không hợp lệ hoặc đã hết hạn' });
            return;
        }
        const decoded = (0, auth_middleware_js_1.verifyRefreshToken)(token);
        const newAccessToken = (0, auth_middleware_js_1.generateAccessToken)({
            userId: decoded.userId,
            name: decoded.name,
            isLecturer: decoded.isLecturer,
        });
        res.json({ success: true, data: { accessToken: newAccessToken } });
    }
    catch {
        res.clearCookie(REFRESH_TOKEN_COOKIE);
        res.status(401).json({ success: false, error: 'Token không hợp lệ' });
    }
}
async function logout(req, res) {
    try {
        const token = req.cookies?.[REFRESH_TOKEN_COOKIE];
        if (token) {
            await authService.deleteRefreshToken(token);
        }
        res.clearCookie(REFRESH_TOKEN_COOKIE);
        res.json({ success: true, message: 'Đã đăng xuất' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function getMe(req, res) {
    res.json({ success: true, data: { user: req.user } });
}
//# sourceMappingURL=auth.controller.js.map