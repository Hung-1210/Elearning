import { Request, Response } from 'express';
import * as authService from '../services/auth.service.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../middleware/auth.middleware.js';
import { ApiResponse, AuthPayload } from '../models/types.js';

const REFRESH_TOKEN_COOKIE = 'refreshToken';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function signup(req: Request, res: Response): Promise<void> {
  try {
    const { name, loginId, password } = req.body;
    if (!name || !loginId || !password) {
      res.status(400).json({ success: false, error: 'Vui lòng điền đầy đủ thông tin' });
      return;
    }

    const payload = await authService.signupLecturer(name, loginId, password);
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

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
    } satisfies ApiResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi máy chủ';
    res.status(400).json({ success: false, error: message });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { loginId, password } = req.body;
    if (!loginId || !password) {
      res.status(400).json({ success: false, error: 'Vui lòng điền đầy đủ thông tin' });
      return;
    }

    const payload = await authService.loginUser(loginId, password);
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

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
    } satisfies ApiResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi máy chủ';
    res.status(401).json({ success: false, error: message });
  }
}

export async function refresh(req: Request, res: Response): Promise<void> {
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

    const decoded = verifyRefreshToken(token) as AuthPayload;
    const newAccessToken = generateAccessToken({
      userId: decoded.userId,
      name: decoded.name,
      isLecturer: decoded.isLecturer,
    });

    res.json({ success: true, data: { accessToken: newAccessToken } });
  } catch {
    res.clearCookie(REFRESH_TOKEN_COOKIE);
    res.status(401).json({ success: false, error: 'Token không hợp lệ' });
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  try {
    const token = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (token) {
      await authService.deleteRefreshToken(token);
    }
    res.clearCookie(REFRESH_TOKEN_COOKIE);
    res.json({ success: true, message: 'Đã đăng xuất' });
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function getMe(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: { user: req.user } });
}
