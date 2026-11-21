// src/routes/face-attendance.routes.ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { HttpError, sendError } from '../utils/http-error.js';
import { requireLogin, requireLecturer, requireStudent } from '../middleware/auth.middleware.js';
import { requireClassOwnership } from '../middleware/class-access.middleware.js';
import * as faceProfileService from '../services/face-profile.service.js';
import * as attendanceService from '../services/attendance.service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 4 },
});

const router = Router();
const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });

// Rate limiter nhẹ cho các endpoint gọi AI
const rateBuckets = new Map<string, number[]>();
function rateLimit(opts: { windowMs: number; max: number; key: (req: Request) => string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const k = opts.key(req);
    const now = Date.now();
    const cutoff = now - opts.windowMs;
    const prev = (rateBuckets.get(k) ?? []).filter((t) => t > cutoff);
    if (prev.length >= opts.max) {
      res.status(429).json({
        success: false,
        error: 'Thao tác quá nhanh, vui lòng thử lại sau giây lát.',
      });
      return;
    }
    prev.push(now);
    rateBuckets.set(k, prev);
    next();
  };
}

// ===========================================================================
// 1. HỒ SƠ KHUÔN MẶT SINH VIÊN (/api/face-profile/...)
// ===========================================================================
router.get('/face-profile/me', requireLogin, requireStudent, async (req, res) => {
  try {
    ok(res, await faceProfileService.getMyFaceProfile(req.user!.userId));
  } catch (err) {
    sendError(res, err);
  }
});

router.post(
  '/face-profile/validate-step',
  requireLogin,
  requireStudent,
  rateLimit({ windowMs: 60_000, max: 30, key: (req) => `fp-val:${req.user?.userId}` }),
  upload.single('photo'),
  async (req, res) => {
    try {
      if (!req.file) throw new HttpError(400, 'Thiếu ảnh khuôn mặt cần kiểm tra');
      const stepNo = Number(req.body?.stepNo || 1);
      ok(res, await faceProfileService.validateEnrollmentStep(req.file.buffer, stepNo));
    } catch (err) {
      sendError(res, err);
    }
  },
);

router.post(
  '/face-profile/enroll',
  requireLogin,
  requireStudent,
  rateLimit({ windowMs: 60_000, max: 10, key: (req) => `fp-enroll:${req.user?.userId}` }),
  upload.array('photos', 4),
  async (req, res) => {
    try {
      const files = (req.files as Express.Multer.File[]) || [];
      const consented =
        req.body?.consented === true ||
        req.body?.consented === 'true' ||
        req.body?.consented === '1';
      const buffers = files.map((f) => f.buffer);
      const profile = await faceProfileService.enrollFaceProfile(
        req.user!.userId,
        buffers,
        consented,
      );
      ok(res, profile, 201);
    } catch (err) {
      sendError(res, err);
    }
  },
);

router.delete('/face-profile/me', requireLogin, requireStudent, async (req, res) => {
  try {
    ok(res, await faceProfileService.deleteMyFaceProfile(req.user!.userId));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/face-profile/me/photos/:step', requireLogin, requireStudent, async (req, res) => {
  try {
    const stepNo = Number(req.params.step);
    const buf = await faceProfileService.getMyFaceProfilePhoto(req.user!.userId, stepNo);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  } catch (err) {
    sendError(res, err);
  }
});

// ===========================================================================
// 2. GIẢNG VIÊN DUYỆT ẢNH ĐĂNG KÝ (/api/classes/:classId/face-profiles & /api/face-profiles/...)
// ===========================================================================
router.get(
  '/classes/:classId/face-profiles',
  requireLogin,
  requireLecturer,
  requireClassOwnership,
  async (req, res) => {
    try {
      const result = await faceProfileService.listClassFaceProfiles(Number(req.params.classId), {
        status: req.query.status as string | undefined,
        search: req.query.search as string | undefined,
      });
      ok(res, result);
    } catch (err) {
      sendError(res, err);
    }
  },
);

router.get(
  '/face-profiles/:userId/photos/:step',
  requireLogin,
  requireLecturer,
  async (req, res) => {
    try {
      const buf = await faceProfileService.getStudentFaceProfilePhotoForLecturer(
        req.user!.userId,
        Number(req.params.userId),
        Number(req.params.step),
      );
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(buf);
    } catch (err) {
      sendError(res, err);
    }
  },
);

router.put('/face-profiles/review-bulk', requireLogin, requireLecturer, async (req, res) => {
  try {
    const result = await faceProfileService.reviewBulkStudentFaceProfiles(req.user!.userId, {
      userIds: req.body?.userIds,
      action: req.body?.action,
      reason: req.body?.reason,
    });
    ok(res, result);
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/face-profiles/:userId/review', requireLogin, requireLecturer, async (req, res) => {
  try {
    const result = await faceProfileService.reviewStudentFaceProfile(
      req.user!.userId,
      Number(req.params.userId),
      {
        action: req.body?.action,
        reason: req.body?.reason,
      },
    );
    ok(res, result);
  } catch (err) {
    sendError(res, err);
  }
});

// ===========================================================================
// 3. ĐIỂM DANH KHUÔN MẶT TRONG PHÒNG HỌC (/api/meetings/:id/attendance & /api/attendance/...)
// ===========================================================================
router.get('/meetings/:id/attendance/overview', requireLogin, async (req, res) => {
  try {
    const classId = req.query.classId ? Number(req.query.classId) : undefined;
    const overview = await attendanceService.getMeetingAttendanceOverview(
      req.user!.userId,
      Boolean(req.user!.isLecturer),
      String(req.params.id),
      classId,
    );
    ok(res, overview);
  } catch (err) {
    sendError(res, err);
  }
});

router.post(
  '/meetings/:id/attendance/start',
  requireLogin,
  requireLecturer,
  async (req, res) => {
    try {
      const session = await attendanceService.startAttendanceSession(
        req.user!.userId,
        String(req.params.id),
        {
          classId: req.body?.classId ? Number(req.body.classId) : undefined,
          mode: req.body?.mode,
          windowSec: req.body?.windowSec,
          strictness: req.body?.strictness,
          threshold: req.body?.threshold,
          intervalMin: req.body?.intervalMin,
          maxRounds: req.body?.maxRounds,
          passRatio: req.body?.passRatio,
        },
      );
      ok(res, session, 201);
    } catch (err) {
      sendError(res, err);
    }
  },
);

router.post(
  '/attendance/:sessionId/check',
  requireLogin,
  requireStudent,
  rateLimit({
    windowMs: 60_000,
    max: 20,
    key: (req) => `att-check:${req.user?.userId}:${req.params.sessionId}`,
  }),
  upload.single('frame'),
  async (req, res) => {
    try {
      if (!req.file) throw new HttpError(400, 'Thiếu khung hình camera để điểm danh');
      const result = await attendanceService.checkStudentAttendance(
        Number(req.params.sessionId),
        req.user!.userId,
        req.file.buffer,
      );
      ok(res, result);
    } catch (err) {
      sendError(res, err);
    }
  },
);

router.post('/attendance/:sessionId/end', requireLogin, requireLecturer, async (req, res) => {
  try {
    const result = await attendanceService.endAttendanceSession(
      req.user!.userId,
      Number(req.params.sessionId),
    );
    ok(res, result);
  } catch (err) {
    sendError(res, err);
  }
});

router.post(
  '/attendance/:sessionId/next-round',
  requireLogin,
  requireLecturer,
  async (req, res) => {
    try {
      const result = await attendanceService.startNextPeriodicRound(
        Number(req.params.sessionId),
        req.user!.userId,
      );
      ok(res, result);
    } catch (err) {
      sendError(res, err);
    }
  },
);

router.post('/attendance/:sessionId/remind', requireLogin, requireLecturer, async (req, res) => {
  try {
    const result = await attendanceService.sendAttendanceReminder(
      req.user!.userId,
      Number(req.params.sessionId),
    );
    ok(res, result);
  } catch (err) {
    sendError(res, err);
  }
});

router.put(
  '/attendance/:sessionId/records/:studentId',
  requireLogin,
  requireLecturer,
  async (req, res) => {
    try {
      const result = await attendanceService.overrideAttendanceRecord(
        req.user!.userId,
        Number(req.params.sessionId),
        Number(req.params.studentId),
        {
          status: req.body?.status,
          reason: req.body?.reason,
          roundNo: req.body?.roundNo ? Number(req.body.roundNo) : undefined,
        },
      );
      ok(res, result);
    } catch (err) {
      sendError(res, err);
    }
  },
);

router.get('/attendance/:sessionId', requireLogin, requireLecturer, async (req, res) => {
  try {
    const details = await attendanceService.getAttendanceSessionDetails(
      Number(req.params.sessionId),
    );
    await attendanceService.ensureLecturerClassAccess(req.user!.userId, details.classId);
    ok(res, details);
  } catch (err) {
    sendError(res, err);
  }
});

router.get(
  '/attendance/:sessionId/export',
  requireLogin,
  requireLecturer,
  rateLimit({ windowMs: 60_000, max: 20, key: (req) => `att-export:${req.user?.userId}` }),
  async (req, res) => {
    try {
      const fmt = req.query.format === 'csv' ? 'csv' : 'xlsx';
      const file = await attendanceService.exportAttendanceSession(
        req.user!.userId,
        Number(req.params.sessionId),
        fmt,
      );
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(file.buffer);
    } catch (err) {
      sendError(res, err);
    }
  },
);

router.get(
  '/attendance/:sessionId/evidence/:studentId',
  requireLogin,
  requireLecturer,
  async (req, res) => {
    try {
      const roundNo = req.query.roundNo ? Number(req.query.roundNo) : undefined;
      const buf = await attendanceService.getAttendanceEvidenceForLecturer(
        req.user!.userId,
        Number(req.params.sessionId),
        Number(req.params.studentId),
        roundNo,
      );
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(buf);
    } catch (err) {
      sendError(res, err);
    }
  },
);

export default router;

