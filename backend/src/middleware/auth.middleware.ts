import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { AuthPayload } from '../models/types.js';

// Augment Express Request with user info
declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function generateAccessToken(payload: AuthPayload): string {
  return jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as jwt.SignOptions['expiresIn'],
  });
}

export function generateRefreshToken(payload: AuthPayload): string {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET as string, {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'],
    jwtid: randomUUID(),
  });
}

export function verifyAccessToken(token: string): AuthPayload {
  return jwt.verify(token, process.env.JWT_SECRET as string) as AuthPayload;
}

export function verifyRefreshToken(token: string): AuthPayload {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET as string) as AuthPayload;
}

export function requireLogin(req: Request, res: Response, next: NextFunction): void {
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
  } catch {
    res.status(401).json({ success: false, error: 'Token không hợp lệ hoặc đã hết hạn' });
  }
}

export function requireLecturer(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.isLecturer) {
    res.status(403).json({ success: false, error: 'Bạn không có quyền thực hiện thao tác này' });
    return;
  }
  next();
}

export function requireStudent(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.isLecturer) {
    res.status(403).json({ success: false, error: 'Bạn không có quyền thực hiện thao tác này' });
    return;
  }
  next();
}
