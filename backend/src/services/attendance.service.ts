// src/services/attendance.service.ts
import xlsx from 'node-xlsx';
import { query, queryOne, withTransaction } from '../config/database.js';
import { HttpError } from '../utils/http-error.js';
import { analyzeFrame, aiReadiness, AiServiceError } from './proctoring/ai-client.js';
import { saveAttendanceEvidence, readEvidenceImage } from './proctoring/storage.js';
import { toCsvBuffer } from './exam/export.service.js';
import {
  ensureFaceAttendanceTables,
  getUsableApprovedEmbedding,
  cosineSimilarity,
} from './face-profile.service.js';
import { emitToMeetingRoom } from '../sockets/attendance.socket.js';

export const MAX_ATTENDANCE_ATTEMPTS = 3;
export const EVIDENCE_RETENTION_DAYS = 30;

export const STRICTNESS_THRESHOLDS: Record<'relaxed' | 'balanced' | 'strict', number> = {
  relaxed: 0.38,
  balanced: 0.45,
  strict: 0.52,
};

export interface StartAttendanceInput {
  classId?: number;
  mode?: 'once' | 'periodic';
  windowSec?: number;
  strictness?: 'relaxed' | 'balanced' | 'strict';
  threshold?: number;
  intervalMin?: number;
  maxRounds?: number | null;
  passRatio?: number;
}

// Quản lý timer đóng cửa sổ đợt & lập lịch đợt định kỳ tiếp theo
const roundEndTimers = new Map<number, NodeJS.Timeout>();
const nextRoundTimers = new Map<number, NodeJS.Timeout>();

function clearSessionTimers(sessionId: number) {
  const t1 = roundEndTimers.get(sessionId);
  if (t1) {
    clearTimeout(t1);
    roundEndTimers.delete(sessionId);
  }
  const t2 = nextRoundTimers.get(sessionId);
  if (t2) {
    clearTimeout(t2);
    nextRoundTimers.delete(sessionId);
  }
}

export async function ensureLecturerClassAccess(lecturerId: number, classId: number): Promise<void> {
  const owns = await queryOne(
    `SELECT 1
       FROM classes c
      WHERE c.id = $1
        AND (
          c.lecturer_id = $2
          OR EXISTS (
            SELECT 1 FROM class_collaborators cc
             WHERE cc.class_id = c.id AND cc.lecturer_id = $2
          )
        )`,
    [classId, lecturerId],
  );
  if (!owns) {
    throw new HttpError(403, 'Bạn không phải giảng viên hoặc trợ giảng phụ trách lớp học này');
  }
}

export async function ensureStudentClassAccess(studentId: number, classId: number): Promise<void> {
  const enrolled = await queryOne(
    `SELECT 1 FROM classes_n_students WHERE class_id = $1 AND student_id = $2`,
    [classId, studentId],
  );
  if (!enrolled) {
    throw new HttpError(403, 'Bạn không thuộc danh sách học viên của lớp học này');
  }
}

async function resolveMeetingContext(
  meetingIdentifier: string,
  fallbackClassId?: number,
): Promise<{ meetingCode: string; classId: number; meetingName: string }> {
  // Kiểm tra theo meeting_code UUID trước
  const byCode = await queryOne<{ meeting_code: string; class_id: number; name: string }>(
    `SELECT meeting_code::text AS meeting_code, class_id, name
       FROM meetings
      WHERE meeting_code::text = $1`,
    [meetingIdentifier],
  );
  if (byCode) {
    return {
      meetingCode: byCode.meeting_code,
      classId: Number(byCode.class_id),
      meetingName: byCode.name,
    };
  }

  // Kiểm tra nếu truyền id số nguyên
  if (/^\d+$/.test(meetingIdentifier)) {
    const byId = await queryOne<{ meeting_code: string; class_id: number; name: string }>(
      `SELECT meeting_code::text AS meeting_code, class_id, name
         FROM meetings
        WHERE id = $1`,
      [Number(meetingIdentifier)],
    );
    if (byId) {
      return {
        meetingCode: byId.meeting_code,
        classId: Number(byId.class_id),
        meetingName: byId.name,
      };
    }
  }

  if (fallbackClassId && Number.isInteger(Number(fallbackClassId)) && Number(fallbackClassId) > 0) {
    return {
      meetingCode: meetingIdentifier,
      classId: Number(fallbackClassId),
      meetingName: `Phòng học ${meetingIdentifier.slice(0, 8)}`,
    };
  }

  throw new HttpError(404, 'Không tìm thấy thông tin phòng học trực tuyến');
}

/** Phát hiện hai sinh viên trong cùng lớp dùng chung một khuôn mặt để đăng ký hồ sơ (Mục 7 & P6). */
export async function detectDuplicateFaceProfilesInClass(classId: number): Promise<
  Array<{
    studentAId: number;
    studentAName: string;
    studentBId: number;
    studentBName: string;
    similarity: number;
  }>
> {
  const rows = await query<{
    user_id: number;
    name: string;
    embedding: number[];
    approved_embedding: number[] | null;
    review_status: string;
  }>(
    `SELECT u.id AS user_id,
            u.name,
            ufp.embedding,
            ufp.approved_embedding,
            ufp.review_status
       FROM classes_n_students cs
       JOIN users u ON u.id = cs.student_id
       JOIN user_face_profiles ufp ON ufp.user_id = u.id
      WHERE cs.class_id = $1
        AND (ufp.review_status = 'approved' OR (ufp.review_status = 'pending' AND ufp.approved_embedding IS NOT NULL))`,
    [classId],
  );

  const warnings: Array<{
    studentAId: number;
    studentAName: string;
    studentBId: number;
    studentBName: string;
    similarity: number;
  }> = [];

  for (let i = 0; i < rows.length; i++) {
    const embA =
      rows[i].review_status === 'approved' ? rows[i].embedding : rows[i].approved_embedding;
    if (!Array.isArray(embA) || embA.length !== 512) continue;
    for (let j = i + 1; j < rows.length; j++) {
      const embB =
        rows[j].review_status === 'approved' ? rows[j].embedding : rows[j].approved_embedding;
      if (!Array.isArray(embB) || embB.length !== 512) continue;
      const sim = cosineSimilarity(embA, embB);
      if (sim >= 0.58) {
        warnings.push({
          studentAId: Number(rows[i].user_id),
          studentAName: rows[i].name,
          studentBId: Number(rows[j].user_id),
          studentBName: rows[j].name,
          similarity: sim,
        });
      }
    }
  }
  return warnings;
}

/** Khởi tạo danh sách bản ghi điểm danh cho 1 đợt (roundNo) từ danh sách sinh viên của lớp. */
async function populateRoundRecords(sessionId: number, classId: number, roundNo: number) {
  const students = await query<{
    student_id: number;
    review_status: string | null;
    has_approved_emb: boolean;
  }>(
    `SELECT cs.student_id,
            ufp.review_status,
            (ufp.review_status = 'pending' AND ufp.approved_embedding IS NOT NULL) AS has_approved_emb
       FROM classes_n_students cs
       LEFT JOIN user_face_profiles ufp ON ufp.user_id = cs.student_id
      WHERE cs.class_id = $1`,
    [classId],
  );

  for (const st of students) {
    const hasUsable =
      st.review_status === 'approved' ||
      (st.review_status === 'pending' && Boolean(st.has_approved_emb));
    let status: 'pending' | 'no_profile' = 'pending';
    let subStatus: string | null = null;
    if (!hasUsable) {
      status = 'no_profile';
      if (st.review_status === 'pending') subStatus = 'pending_review';
      else if (st.review_status === 'rejected') subStatus = 'rejected';
      else subStatus = 'unregistered';
    }

    await query(
      `INSERT INTO attendance_records (session_id, round_no, student_id, status, sub_status, attempts)
       VALUES ($1, $2, $3, $4, $5, 0)
       ON CONFLICT (session_id, round_no, student_id) DO NOTHING`,
      [sessionId, roundNo, st.student_id, status, subStatus],
    );
  }
}

/** Lập lịch tự động đóng cửa sổ điểm danh của đợt hiện tại. */
function scheduleRoundWindowExpiry(sessionId: number, delayMs: number) {
  const prev = roundEndTimers.get(sessionId);
  if (prev) clearTimeout(prev);

  const timer = setTimeout(() => {
    roundEndTimers.delete(sessionId);
    void handleRoundWindowExpired(sessionId).catch((err) =>
      console.error(`[attendance] Lỗi khi đóng cửa sổ phiên ${sessionId}:`, err),
    );
  }, Math.max(500, delayMs));

  roundEndTimers.set(sessionId, timer);
}

/** Xử lý khi hết thời gian chờ của một đợt điểm danh. */
export async function handleRoundWindowExpired(sessionId: number): Promise<void> {
  const session = await queryOne<any>(
    `SELECT * FROM attendance_sessions WHERE id = $1`,
    [sessionId],
  );
  if (!session || session.ended_at) return;

  // Chuyển toàn bộ bản ghi đang 'pending' của đợt hiện tại thành 'absent'
  await query(
    `UPDATE attendance_records
        SET status = 'absent',
            sub_status = COALESCE(sub_status, 'timeout'),
            checked_at = COALESCE(checked_at, NOW())
      WHERE session_id = $1
        AND round_no = $2
        AND status = 'pending'`,
    [sessionId, session.current_round],
  );

  const isOnce = session.mode === 'once';
  const reachedMaxRounds =
    session.mode === 'periodic' &&
    session.max_rounds !== null &&
    Number(session.current_round) >= Number(session.max_rounds);

  if (isOnce || reachedMaxRounds) {
    clearSessionTimers(sessionId);
    await query(
      `UPDATE attendance_sessions
          SET round_open = FALSE,
              next_round_at = NULL,
              ended_at = NOW()
        WHERE id = $1`,
      [sessionId],
    );
    const full = await getAttendanceSessionDetails(sessionId);
    emitToMeetingRoom(session.meeting_id, 'attendance-ended', {
      sessionId,
      meetingCode: session.meeting_id,
      roundNo: session.current_round,
      session: full,
    });
    return;
  }

  // Chế độ định kỳ ('periodic'): đóng cửa sổ đợt hiện tại và hẹn giờ đợt kế tiếp (kèm jitter ngẫu nhiên ±15%)
  const intervalMin = Math.max(1, Number(session.interval_min || 10));
  const baseMs = intervalMin * 60 * 1000;
  const jitterFactor = 0.85 + Math.random() * 0.3; // 0.85 .. 1.15
  const nextDelayMs = Math.max(30_000, Math.round(baseMs * jitterFactor));
  const nextRoundAt = new Date(Date.now() + nextRoundMsOrMin(nextDelayMs));

  await query(
    `UPDATE attendance_sessions
        SET round_open = FALSE,
            next_round_at = $2
      WHERE id = $1`,
    [sessionId, nextRoundAt],
  );

  const full = await getAttendanceSessionDetails(sessionId);
  emitToMeetingRoom(session.meeting_id, 'attendance-update', {
    sessionId,
    roundNo: session.current_round,
    roundClosed: true,
    nextRoundAt: nextRoundAt.toISOString(),
    session: full,
  });

  const prevNext = nextRoundTimers.get(sessionId);
  if (prevNext) clearTimeout(prevNext);
  const nextTimer = setTimeout(() => {
    nextRoundTimers.delete(sessionId);
    void startNextPeriodicRound(sessionId).catch((err) =>
      console.error(`[attendance] Lỗi khi mở đợt định kỳ tiếp theo cho phiên ${sessionId}:`, err),
    );
  }, nextDelayMs);
  nextRoundTimers.set(sessionId, nextTimer);
}

function nextRoundMsOrMin(ms: number): number {
  return Math.max(10_000, ms);
}

/** Mở đợt điểm danh tiếp theo cho phiên định kỳ ('periodic'). */
export async function startNextPeriodicRound(sessionId: number, lecturerId?: number) {
  await ensureFaceAttendanceTables();
  const session = await queryOne<any>(
    `SELECT * FROM attendance_sessions WHERE id = $1`,
    [sessionId],
  );
  if (!session) throw new HttpError(404, 'Không tìm thấy phiên điểm danh');
  if (lecturerId) {
    await ensureLecturerClassAccess(lecturerId, Number(session.class_id));
  }
  if (session.ended_at) {
    throw new HttpError(400, 'Phiên điểm danh này đã kết thúc');
  }
  if (session.mode !== 'periodic') {
    throw new HttpError(400, 'Chỉ phiên điểm danh định kỳ mới có nhiều đợt');
  }

  // Nếu đợt hiện tại đang mở, chốt các bản ghi pending của đợt cũ thành absent trước khi sang đợt mới
  if (session.round_open) {
    await query(
      `UPDATE attendance_records
          SET status = 'absent',
              sub_status = COALESCE(sub_status, 'timeout'),
              checked_at = COALESCE(checked_at, NOW())
        WHERE session_id = $1 AND round_no = $2 AND status = 'pending'`,
      [sessionId, session.current_round],
    );
  }

  clearSessionTimers(sessionId);

  const nextRoundNo = Number(session.current_round) + 1;
  const windowSec = Number(session.window_sec || 120);
  const roundEndsAt = new Date(Date.now() + windowSec * 1000);

  await query(
    `UPDATE attendance_sessions
        SET current_round = $2,
            round_open    = TRUE,
            round_ends_at = $3,
            next_round_at = NULL
      WHERE id = $1`,
    [sessionId, nextRoundNo, roundEndsAt],
  );

  await populateRoundRecords(sessionId, Number(session.class_id), nextRoundNo);
  scheduleRoundWindowExpiry(sessionId, windowSec * 1000);

  const details = await getAttendanceSessionDetails(sessionId);
  emitToMeetingRoom(session.meeting_id, 'attendance-started', {
    sessionId,
    meetingCode: session.meeting_id,
    classId: Number(session.class_id),
    mode: session.mode,
    roundNo: nextRoundNo,
    maxRounds: session.max_rounds,
    windowSec,
    endsAt: roundEndsAt.toISOString(),
    strictness: session.strictness,
    session: details,
  });

  return details;
}

// ===========================================================================
// 1. BẮT ĐẦU PHIÊN ĐIỂM DANH
// ===========================================================================
export async function startAttendanceSession(
  lecturerId: number,
  meetingIdentifier: string,
  input: StartAttendanceInput,
) {
  await ensureFaceAttendanceTables();
  const { meetingCode, classId } = await resolveMeetingContext(meetingIdentifier, input.classId);
  await ensureLecturerClassAccess(lecturerId, classId);

  // Đóng phiên cũ chưa kết thúc của cùng phòng học (nếu có)
  const existingActive = await query<{ id: number }>(
    `SELECT id FROM attendance_sessions WHERE meeting_id = $1 AND ended_at IS NULL`,
    [meetingCode],
  );
  for (const old of existingActive) {
    clearSessionTimers(old.id);
    await query(
      `UPDATE attendance_records
          SET status = 'absent', sub_status = COALESCE(sub_status, 'timeout')
        WHERE session_id = $1 AND status = 'pending'`,
      [old.id],
    );
    await query(
      `UPDATE attendance_sessions SET round_open = FALSE, ended_at = NOW() WHERE id = $1`,
      [old.id],
    );
  }

  const mode: 'once' | 'periodic' = input.mode === 'periodic' ? 'periodic' : 'once';
  const strictness: 'relaxed' | 'balanced' | 'strict' =
    input.strictness === 'relaxed' || input.strictness === 'strict'
      ? input.strictness
      : 'balanced';
  const threshold =
    input.threshold !== undefined && Number.isFinite(Number(input.threshold))
      ? Math.min(0.85, Math.max(0.25, Number(input.threshold)))
      : STRICTNESS_THRESHOLDS[strictness];
  const windowSec = Math.min(600, Math.max(30, Math.round(Number(input.windowSec) || 120)));
  const intervalMin =
    mode === 'periodic'
      ? Math.min(60, Math.max(1, Math.round(Number(input.intervalMin) || 10)))
      : null;
  const maxRounds =
    mode === 'periodic' && input.maxRounds && Number(input.maxRounds) > 0
      ? Math.min(20, Math.max(1, Math.round(Number(input.maxRounds))))
      : null;
  const passRatio =
    input.passRatio !== undefined && Number.isFinite(Number(input.passRatio))
      ? Math.min(1, Math.max(0.25, Number(input.passRatio)))
      : 0.7;

  const roundEndsAt = new Date(Date.now() + windowSec * 1000);
  const duplicateWarnings = await detectDuplicateFaceProfilesInClass(classId);

  const created = await queryOne<{ id: number }>(
    `INSERT INTO attendance_sessions (
       meeting_id, class_id, started_by, mode, strictness, window_sec, threshold,
       interval_min, max_rounds, current_round, round_open, round_ends_at,
       pass_ratio, duplicate_warnings
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, TRUE, $10, $11, $12::jsonb)
     RETURNING id`,
    [
      meetingCode,
      classId,
      lecturerId,
      mode,
      strictness,
      windowSec,
      threshold,
      intervalMin,
      maxRounds,
      roundEndsAt,
      passRatio,
      JSON.stringify(duplicateWarnings),
    ],
  );

  const sessionId = created!.id;
  await populateRoundRecords(sessionId, classId, 1);
  scheduleRoundWindowExpiry(sessionId, windowSec * 1000);

  const details = await getAttendanceSessionDetails(sessionId);

  emitToMeetingRoom(meetingCode, 'attendance-started', {
    sessionId,
    meetingCode,
    classId,
    mode,
    roundNo: 1,
    maxRounds,
    windowSec,
    endsAt: roundEndsAt.toISOString(),
    strictness,
    session: details,
  });

  return details;
}

// ===========================================================================
// 2. XEM CHI TIẾT PHIÊN ĐIỂM DANH & TỔNG HỢP ĐỊNH KỲ (P2 + P4)
// ===========================================================================
export function computeEffectiveStatus(record: {
  status: string;
  sub_status?: string | null;
}): 'present' | 'pending' | 'mismatch' | 'absent' | 'no_profile' {
  if (record.status === 'manual') {
    if (record.sub_status === 'manual_absent') return 'absent';
    return 'present'; // manual_present hoặc excused được tính vào nhóm đạt điểm danh
  }
  return record.status as 'present' | 'pending' | 'mismatch' | 'absent' | 'no_profile';
}

export async function getAttendanceSessionDetails(sessionId: number) {
  await ensureFaceAttendanceTables();
  const session = await queryOne<any>(
    `SELECT s.*,
            c.name AS class_name,
            u.name AS started_by_name
       FROM attendance_sessions s
       JOIN classes c ON c.id = s.class_id
       LEFT JOIN users u ON u.id = s.started_by
      WHERE s.id = $1`,
    [sessionId],
  );
  if (!session) throw new HttpError(404, 'Không tìm thấy phiên điểm danh');

  // Nếu cửa sổ đợt hiện tại đã quá hạn mà timer chưa kịp chạy (vd: sau khi restart server), tự chốt đợt
  if (
    !session.ended_at &&
    session.round_open &&
    new Date(session.round_ends_at).getTime() <= Date.now()
  ) {
    await query(
      `UPDATE attendance_records
          SET status = 'absent',
              sub_status = COALESCE(sub_status, 'timeout'),
              checked_at = COALESCE(checked_at, NOW())
        WHERE session_id = $1 AND round_no = $2 AND status = 'pending'`,
      [sessionId, session.current_round],
    );
    if (session.mode === 'once') {
      await query(
        `UPDATE attendance_sessions SET round_open = FALSE, ended_at = NOW() WHERE id = $1`,
        [sessionId],
      );
      session.round_open = false;
      session.ended_at = new Date();
    } else {
      await query(`UPDATE attendance_sessions SET round_open = FALSE WHERE id = $1`, [sessionId]);
      session.round_open = false;
    }
  }

  const allRecords = await query<any>(
    `SELECT ar.*,
            u.name AS student_name,
            COALESCE(ul.login_id, '') AS login_id,
            ov.name AS override_by_name
       FROM attendance_records ar
       JOIN users u ON u.id = ar.student_id
       LEFT JOIN user_login_id ul ON ul.user_id = u.id
       LEFT JOIN users ov ON ov.id = ar.override_by
      WHERE ar.session_id = $1
      ORDER BY ar.round_no ASC, u.name ASC`,
    [sessionId],
  );

  const currentRound = Number(session.current_round || 1);
  const currentRoundRecords = allRecords.filter((r) => Number(r.round_no) === currentRound);

  // Tính tổng hợp các đợt cho từng sinh viên (đặc biệt hữu ích ở chế độ Định kỳ)
  const byStudent = new Map<number, any[]>();
  for (const rec of allRecords) {
    const sid = Number(rec.student_id);
    const list = byStudent.get(sid) ?? [];
    list.push(rec);
    byStudent.set(sid, list);
  }

  const passRatio = Number(session.pass_ratio ?? 0.7);
  const recordsFormatted = currentRoundRecords.map((r) => {
    const sid = Number(r.student_id);
    const studentRounds = byStudent.get(sid) ?? [r];
    const roundsPassed = studentRounds.filter(
      (sr) => computeEffectiveStatus(sr) === 'present',
    ).length;
    const totalRounds = currentRound;
    const ratio = totalRounds > 0 ? roundsPassed / totalRounds : 0;

    const currentEffective = computeEffectiveStatus(r);
    let periodicOverall: 'present' | 'partial' | 'mismatch' | 'absent' | 'no_profile' | 'pending' =
      currentEffective;

    if (session.mode === 'periodic' && (totalRounds > 1 || session.ended_at)) {
      if (studentRounds.every((sr) => sr.status === 'no_profile')) {
        periodicOverall = 'no_profile';
      } else if (ratio >= passRatio) {
        periodicOverall = 'present';
      } else if (roundsPassed > 0) {
        periodicOverall = 'partial';
      } else if (studentRounds.some((sr) => sr.status === 'mismatch')) {
        periodicOverall = 'mismatch';
      } else if (studentRounds.some((sr) => sr.status === 'pending')) {
        periodicOverall = 'pending';
      } else {
        periodicOverall = 'absent';
      }
    }

    return {
      id: Number(r.id),
      sessionId: Number(r.session_id),
      roundNo: Number(r.round_no),
      studentId: sid,
      studentName: r.student_name as string,
      loginId: r.login_id as string,
      status: r.status as 'pending' | 'present' | 'mismatch' | 'absent' | 'no_profile' | 'manual',
      effectiveStatus: currentEffective,
      subStatus: r.sub_status ?? null,
      similarity: r.similarity !== null ? Number(r.similarity) : null,
      faceCount: r.face_count !== null ? Number(r.face_count) : null,
      attempts: Number(r.attempts ?? 0),
      hasEvidence: Boolean(r.evidence_path),
      checkedAt: r.checked_at ?? null,
      overrideBy: r.override_by ? Number(r.override_by) : null,
      overrideByName: r.override_by_name ?? null,
      overrideAt: r.override_at ?? null,
      overrideReason: r.override_reason ?? null,
      roundsPassed,
      totalRounds,
      periodicOverall,
      roundHistory: studentRounds.map((sr) => ({
        roundNo: Number(sr.round_no),
        status: sr.status,
        effectiveStatus: computeEffectiveStatus(sr),
        similarity: sr.similarity !== null ? Number(sr.similarity) : null,
        checkedAt: sr.checked_at ?? null,
      })),
    };
  });

  const summary = {
    total: recordsFormatted.length,
    present: recordsFormatted.filter((r) => r.effectiveStatus === 'present').length,
    pending: recordsFormatted.filter((r) => r.effectiveStatus === 'pending').length,
    mismatch: recordsFormatted.filter((r) => r.effectiveStatus === 'mismatch').length,
    absent: recordsFormatted.filter((r) => r.effectiveStatus === 'absent').length,
    noProfile: recordsFormatted.filter((r) => r.effectiveStatus === 'no_profile').length,
    pendingReviewProfile: recordsFormatted.filter((r) => r.subStatus === 'pending_review').length,
    manual: recordsFormatted.filter((r) => r.status === 'manual').length,
    partialPeriodic: recordsFormatted.filter((r) => r.periodicOverall === 'partial').length,
  };

  const readiness = await aiReadiness().catch(() => ({ state: 'unreachable' as const }));

  return {
    id: Number(session.id),
    meetingCode: session.meeting_id as string,
    classId: Number(session.class_id),
    className: session.class_name as string,
    startedBy: Number(session.started_by),
    startedByName: session.started_by_name ?? null,
    mode: session.mode as 'once' | 'periodic',
    strictness: session.strictness as 'relaxed' | 'balanced' | 'strict',
    windowSec: Number(session.window_sec),
    threshold: Number(session.threshold),
    intervalMin: session.interval_min ? Number(session.interval_min) : null,
    maxRounds: session.max_rounds ? Number(session.max_rounds) : null,
    currentRound,
    roundOpen: Boolean(session.round_open && !session.ended_at),
    roundEndsAt: session.round_ends_at,
    nextRoundAt: session.next_round_at ?? null,
    passRatio,
    duplicateWarnings: Array.isArray(session.duplicate_warnings) ? session.duplicate_warnings : [],
    startedAt: session.started_at,
    endedAt: session.ended_at ?? null,
    aiState: readiness.state,
    summary,
    records: recordsFormatted,
  };
}

/** Lấy phiên điểm danh mới nhất của phòng học (kể cả vừa chốt) kèm thống kê số hồ sơ đã đăng ký của lớp. */
export async function getMeetingAttendanceOverview(
  userId: number,
  isLecturer: boolean,
  meetingIdentifier: string,
  fallbackClassId?: number,
) {
  await ensureFaceAttendanceTables();
  const { meetingCode, classId } = await resolveMeetingContext(meetingIdentifier, fallbackClassId);

  if (isLecturer) {
    await ensureLecturerClassAccess(userId, classId);
  } else {
    await ensureStudentClassAccess(userId, classId);
  }

  const profileStats = await queryOne<{
    total_students: string;
    approved_count: string;
    pending_count: string;
    rejected_count: string;
  }>(
    `SELECT COUNT(*)::text AS total_students,
            COUNT(*) FILTER (WHERE ufp.review_status = 'approved' OR (ufp.review_status = 'pending' AND ufp.approved_embedding IS NOT NULL))::text AS approved_count,
            COUNT(*) FILTER (WHERE ufp.review_status = 'pending' AND ufp.approved_embedding IS NULL)::text AS pending_count,
            COUNT(*) FILTER (WHERE ufp.review_status = 'rejected')::text AS rejected_count
       FROM classes_n_students cs
       LEFT JOIN user_face_profiles ufp ON ufp.user_id = cs.student_id
      WHERE cs.class_id = $1`,
    [classId],
  );

  const totalStudents = Number(profileStats?.total_students ?? 0);
  const approvedCount = Number(profileStats?.approved_count ?? 0);
  const pendingCount = Number(profileStats?.pending_count ?? 0);
  const rejectedCount = Number(profileStats?.rejected_count ?? 0);
  const unregisteredCount = Math.max(0, totalStudents - approvedCount - pendingCount - rejectedCount);

  const latestSession = await queryOne<{ id: number }>(
    `SELECT id
       FROM attendance_sessions
      WHERE meeting_id = $1
      ORDER BY started_at DESC
      LIMIT 1`,
    [meetingCode],
  );

  if (!latestSession) {
    return {
      meetingCode,
      classId,
      classProfileSummary: {
        totalStudents,
        approvedCount,
        pendingCount,
        rejectedCount,
        unregisteredCount,
      },
      session: null,
      myRecord: null,
    };
  }

  const details = await getAttendanceSessionDetails(latestSession.id);

  if (!isLecturer) {
    const myRecord = details.records.find((r) => r.studentId === userId) ?? null;
    return {
      meetingCode,
      classId,
      classProfileSummary: null,
      session: {
        id: details.id,
        meetingCode: details.meetingCode,
        classId: details.classId,
        mode: details.mode,
        currentRound: details.currentRound,
        maxRounds: details.maxRounds,
        windowSec: details.windowSec,
        roundOpen: details.roundOpen,
        roundEndsAt: details.roundEndsAt,
        nextRoundAt: details.nextRoundAt,
        endedAt: details.endedAt,
        aiState: details.aiState,
      },
      myRecord,
    };
  }

  return {
    meetingCode,
    classId,
    classProfileSummary: {
      totalStudents,
      approvedCount,
      pendingCount,
      rejectedCount,
      unregisteredCount,
    },
    session: details,
    myRecord: null,
  };
}

// ===========================================================================
// 3. SINH VIÊN GỬI FRAME XÁC THỰC ĐIỂM DANH (POST /api/attendance/:sessionId/check)
// ===========================================================================
export async function checkStudentAttendance(
  sessionId: number,
  studentId: number,
  imageBuffer: Buffer,
) {
  await ensureFaceAttendanceTables();
  const session = await queryOne<any>(
    `SELECT * FROM attendance_sessions WHERE id = $1`,
    [sessionId],
  );
  if (!session) throw new HttpError(404, 'Không tìm thấy phiên điểm danh');
  await ensureStudentClassAccess(studentId, Number(session.class_id));

  if (session.ended_at) {
    throw new HttpError(400, 'Phiên điểm danh đã kết thúc');
  }
  if (!session.round_open || new Date(session.round_ends_at).getTime() <= Date.now()) {
    await handleRoundWindowExpired(sessionId);
    throw new HttpError(400, 'Đã hết thời gian phản hồi cho đợt điểm danh này');
  }

  const roundNo = Number(session.current_round || 1);

  let record = await queryOne<any>(
    `SELECT * FROM attendance_records
      WHERE session_id = $1 AND round_no = $2 AND student_id = $3`,
    [sessionId, roundNo, studentId],
  );

  // Nếu sinh viên mới tham gia lớp sau lúc phiên mở thì tạo bổ sung bản ghi
  if (!record) {
    await populateRoundRecords(sessionId, Number(session.class_id), roundNo);
    record = await queryOne<any>(
      `SELECT * FROM attendance_records
        WHERE session_id = $1 AND round_no = $2 AND student_id = $3`,
      [sessionId, roundNo, studentId],
    );
  }
  if (!record) {
    throw new HttpError(404, 'Không tìm thấy bản ghi điểm danh của bạn trong lớp này');
  }

  // Giữ kết quả đã present/manual trong cùng đợt (Mục 10: rời phòng vào lại không phải điểm danh lại)
  if (record.status === 'present' || record.status === 'manual') {
    return {
      status: 'present' as const,
      alreadyChecked: true,
      roundNo,
      attempts: Number(record.attempts),
      attemptsLeft: Math.max(0, MAX_ATTENDANCE_ATTEMPTS - Number(record.attempts)),
      similarity: record.similarity !== null ? Number(record.similarity) : null,
      checkedAt: record.checked_at,
      messageVi: 'Bạn đã điểm danh thành công trong đợt này.',
    };
  }

  // Kiểm tra hồ sơ khuôn mặt đã duyệt
  const profile = await getUsableApprovedEmbedding(studentId);
  if (!profile.usableEmbedding) {
    const subStatus =
      profile.status === 'pending'
        ? 'pending_review'
        : profile.status === 'rejected'
          ? 'rejected'
          : 'unregistered';
    await query(
      `UPDATE attendance_records
          SET status = 'no_profile', sub_status = $4
        WHERE session_id = $1 AND round_no = $2 AND student_id = $3`,
      [sessionId, roundNo, studentId, subStatus],
    );

    const msg =
      profile.status === 'pending'
        ? 'Hồ sơ khuôn mặt của bạn đang chờ giảng viên duyệt. Vui lòng nhờ giảng viên duyệt hoặc điểm danh thủ công.'
        : profile.status === 'rejected'
          ? `Hồ sơ khuôn mặt của bạn đã bị từ chối (${profile.rejectReason || 'ảnh chưa đạt'}). Vui lòng đăng ký lại.`
          : 'Bạn chưa đăng ký hồ sơ khuôn mặt. Hãy bấm "Đăng ký ngay" để tạo hồ sơ.';
    throw new HttpError(403, msg);
  }

  // Nếu trước đó là no_profile nhưng giảng viên vừa duyệt xong, chuyển sang pending
  if (record.status === 'no_profile') {
    await query(
      `UPDATE attendance_records
          SET status = 'pending', sub_status = NULL
        WHERE id = $1`,
      [record.id],
    );
    record.status = 'pending';
  }

  if (record.status === 'mismatch' || Number(record.attempts) >= MAX_ATTENDANCE_ATTEMPTS) {
    return {
      status: 'mismatch' as const,
      roundNo,
      attempts: Number(record.attempts),
      attemptsLeft: 0,
      messageVi: 'Chưa xác thực được. Giảng viên sẽ xem xét thủ công.',
    };
  }

  // Gọi AI service chỉ với cờ face + identity (không chạy YOLO, gaze, head pose — Mục 2 & 8.4)
  let analysis;
  try {
    analysis = await analyzeFrame({
      imageBuffer,
      referenceEmbedding: profile.usableEmbedding,
      run: {
        face: true,
        identity: true,
        headPose: false,
        gaze: false,
        objects: false,
      },
    });
  } catch (err) {
    if (err instanceof AiServiceError) {
      if (err.code === 'AI_BUSY') {
        throw new HttpError(
          429,
          'Hệ thống nhận diện AI đang xử lý nhiều yêu cầu cùng lúc, trình duyệt sẽ tự thử lại sau ít giây.',
        );
      }
      throw new HttpError(
        503,
        'Hệ thống nhận diện tạm thời bận. Giảng viên sẽ điểm danh thủ công cho bạn.',
      );
    }
    throw err;
  }

  const faceCount = analysis.faceCount ?? 0;
  const similarity =
    analysis.primary?.similarity !== null && analysis.primary?.similarity !== undefined
      ? Math.round(Number(analysis.primary.similarity) * 10000) / 10000
      : null;
  const threshold = Number(session.threshold || 0.45);
  const nextAttempts = Number(record.attempts || 0) + 1;

  // Trường hợp 1: Đúng 1 khuôn mặt và độ tương đồng >= ngưỡng => CÓ MẶT
  if (faceCount === 1 && similarity !== null && similarity >= threshold) {
    await query(
      `UPDATE attendance_records
          SET status     = 'present',
              sub_status = NULL,
              similarity = $2,
              face_count = 1,
              attempts   = $3,
              checked_at = NOW()
        WHERE id = $1`,
      [record.id, similarity, nextAttempts],
    );

    const updatedSession = await getAttendanceSessionDetails(sessionId);
    const updatedRecord = updatedSession.records.find((r) => r.studentId === studentId);
    emitToMeetingRoom(session.meeting_id, 'attendance-update', {
      sessionId,
      roundNo,
      record: updatedRecord,
      summary: updatedSession.summary,
      session: updatedSession,
    });

    return {
      status: 'present' as const,
      roundNo,
      attempts: nextAttempts,
      attemptsLeft: Math.max(0, MAX_ATTENDANCE_ATTEMPTS - nextAttempts),
      similarity,
      checkedAt: new Date().toISOString(),
      messageVi: 'Đã điểm danh thành công',
    };
  }

  // Trường hợp 2: Chưa khớp (0 mặt, nhiều mặt, hoặc similarity < ngưỡng)
  const subStatus =
    faceCount >= 2 ? 'multiple_faces' : faceCount === 0 ? 'no_face' : 'low_similarity';
  const attemptsLeft = Math.max(0, MAX_ATTENDANCE_ATTEMPTS - nextAttempts);

  if (attemptsLeft > 0) {
    await query(
      `UPDATE attendance_records
          SET status     = 'pending',
              sub_status = $2,
              similarity = $3,
              face_count = $4,
              attempts   = $5,
              checked_at = NOW()
        WHERE id = $1`,
      [record.id, subStatus, similarity, faceCount, nextAttempts],
    );

    const updatedSession = await getAttendanceSessionDetails(sessionId);
    const updatedRecord = updatedSession.records.find((r) => r.studentId === studentId);
    emitToMeetingRoom(session.meeting_id, 'attendance-update', {
      sessionId,
      roundNo,
      record: updatedRecord,
      summary: updatedSession.summary,
      session: updatedSession,
    });

    let retryReasonVi = `Chưa nhận diện được bạn. Hãy nhìn thẳng, đủ sáng. (Thử lại ${nextAttempts}/${MAX_ATTENDANCE_ATTEMPTS})`;
    if (faceCount >= 2) {
      retryReasonVi = `Phát hiện ${faceCount} khuôn mặt trong khung hình. Vui lòng chỉ để một mình bạn trước camera. (Thử lại ${nextAttempts}/${MAX_ATTENDANCE_ATTEMPTS})`;
    } else if (faceCount === 0) {
      retryReasonVi = `Chưa thấy rõ khuôn mặt trong camera. Hãy nhìn thẳng, đủ sáng. (Thử lại ${nextAttempts}/${MAX_ATTENDANCE_ATTEMPTS})`;
    }

    return {
      status: 'retry' as const,
      roundNo,
      attempts: nextAttempts,
      attemptsLeft,
      subStatus,
      messageVi: retryReasonVi,
    };
  }

  // Hết lượt thử (3/3): Lưu ảnh bằng chứng vào private-uploads/ và đánh dấu 'mismatch'
  const evidencePath = await saveAttendanceEvidence(sessionId, roundNo, studentId, imageBuffer);

  await query(
    `UPDATE attendance_records
        SET status              = 'mismatch',
            sub_status          = $2,
            similarity          = $3,
            face_count          = $4,
            attempts            = $5,
            evidence_path       = $6,
            evidence_expires_at = NOW() + make_interval(days => $7),
            checked_at          = NOW()
      WHERE id = $1`,
    [
      record.id,
      subStatus,
      similarity,
      faceCount,
      nextAttempts,
      evidencePath,
      EVIDENCE_RETENTION_DAYS,
    ],
  );

  const updatedSession = await getAttendanceSessionDetails(sessionId);
  const updatedRecord = updatedSession.records.find((r) => r.studentId === studentId);
  emitToMeetingRoom(session.meeting_id, 'attendance-update', {
    sessionId,
    roundNo,
    record: updatedRecord,
    summary: updatedSession.summary,
    session: updatedSession,
  });

  return {
    status: 'mismatch' as const,
    roundNo,
    attempts: nextAttempts,
    attemptsLeft: 0,
    subStatus,
    messageVi: 'Chưa xác thực được. Giảng viên sẽ xem xét thủ công.',
  };
}

// ===========================================================================
// 4. GIẢNG VIÊN KẾT THÚC PHIÊN, NHẮC NHỞ, CHỈNH TAY CÓ LÝ DO, XEM BẰNG CHỨNG, XUẤT FILE
// ===========================================================================
export async function endAttendanceSession(lecturerId: number, sessionId: number) {
  await ensureFaceAttendanceTables();
  const session = await queryOne<any>(
    `SELECT * FROM attendance_sessions WHERE id = $1`,
    [sessionId],
  );
  if (!session) throw new HttpError(404, 'Không tìm thấy phiên điểm danh');
  await ensureLecturerClassAccess(lecturerId, Number(session.class_id));

  clearSessionTimers(sessionId);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE attendance_records
          SET status = 'absent',
              sub_status = COALESCE(sub_status, 'timeout'),
              checked_at = COALESCE(checked_at, NOW())
        WHERE session_id = $1 AND status = 'pending'`,
      [sessionId],
    );
    await client.query(
      `UPDATE attendance_sessions
          SET round_open    = FALSE,
              next_round_at = NULL,
              ended_at      = COALESCE(ended_at, NOW())
        WHERE id = $1`,
      [sessionId],
    );
  });

  const details = await getAttendanceSessionDetails(sessionId);
  emitToMeetingRoom(session.meeting_id, 'attendance-ended', {
    sessionId,
    meetingCode: session.meeting_id,
    roundNo: details.currentRound,
    session: details,
  });

  return details;
}

export async function sendAttendanceReminder(lecturerId: number, sessionId: number) {
  await ensureFaceAttendanceTables();
  const session = await queryOne<any>(
    `SELECT * FROM attendance_sessions WHERE id = $1`,
    [sessionId],
  );
  if (!session) throw new HttpError(404, 'Không tìm thấy phiên điểm danh');
  await ensureLecturerClassAccess(lecturerId, Number(session.class_id));

  const pendingRows = await query<{ student_id: number }>(
    `SELECT student_id
       FROM attendance_records
      WHERE session_id = $1 AND round_no = $2 AND status IN ('pending', 'no_profile')`,
    [sessionId, session.current_round],
  );
  const targetStudentIds = pendingRows.map((r) => Number(r.student_id));

  emitToMeetingRoom(session.meeting_id, 'attendance-reminder', {
    sessionId,
    roundNo: Number(session.current_round),
    endsAt: session.round_ends_at,
    targetStudentIds,
    message: 'Giảng viên nhắc bạn bật camera và hoàn tất điểm danh khuôn mặt.',
  });

  return { remindedCount: targetStudentIds.length, targetStudentIds };
}

export async function overrideAttendanceRecord(
  lecturerId: number,
  sessionId: number,
  studentId: number,
  input: {
    status: 'present' | 'absent' | 'excused' | 'manual';
    reason: string;
    roundNo?: number;
  },
) {
  await ensureFaceAttendanceTables();
  const session = await queryOne<any>(
    `SELECT * FROM attendance_sessions WHERE id = $1`,
    [sessionId],
  );
  if (!session) throw new HttpError(404, 'Không tìm thấy phiên điểm danh');
  await ensureLecturerClassAccess(lecturerId, Number(session.class_id));

  const reason = String(input.reason ?? '').trim();
  if (!reason) {
    throw new HttpError(400, 'Bắt buộc nhập lý do khi chỉnh sửa kết quả điểm danh thủ công');
  }

  let subStatus: 'manual_present' | 'manual_absent' | 'excused' = 'manual_present';
  if (input.status === 'absent') subStatus = 'manual_absent';
  else if (input.status === 'excused') subStatus = 'excused';

  const roundNo = input.roundNo ? Number(input.roundNo) : Number(session.current_round || 1);

  const updated = await queryOne<{ id: number }>(
    `UPDATE attendance_records
        SET status          = 'manual',
            sub_status      = $4,
            override_by     = $5,
            override_at     = NOW(),
            override_reason = $6,
            checked_at      = COALESCE(checked_at, NOW())
      WHERE session_id = $1 AND round_no = $2 AND student_id = $3
      RETURNING id`,
    [sessionId, roundNo, studentId, subStatus, lecturerId, reason],
  );

  if (!updated) {
    throw new HttpError(404, 'Không tìm thấy bản ghi điểm danh của sinh viên này');
  }

  const details = await getAttendanceSessionDetails(sessionId);
  const updatedRecord = details.records.find((r) => r.studentId === studentId);
  emitToMeetingRoom(session.meeting_id, 'attendance-update', {
    sessionId,
    roundNo,
    record: updatedRecord,
    summary: details.summary,
    session: details,
  });

  return details;
}

export async function getAttendanceEvidenceForLecturer(
  lecturerId: number,
  sessionId: number,
  studentId: number,
  roundNo?: number,
): Promise<Buffer> {
  await ensureFaceAttendanceTables();
  const session = await queryOne<any>(
    `SELECT * FROM attendance_sessions WHERE id = $1`,
    [sessionId],
  );
  if (!session) throw new HttpError(404, 'Không tìm thấy phiên điểm danh');
  await ensureLecturerClassAccess(lecturerId, Number(session.class_id));

  const targetRound = roundNo ? Number(roundNo) : Number(session.current_round || 1);
  const rec = await queryOne<{ evidence_path: string | null }>(
    `SELECT evidence_path
       FROM attendance_records
      WHERE session_id = $1 AND student_id = $2 AND round_no = $3`,
    [sessionId, studentId, targetRound],
  );
  let relPath = rec?.evidence_path ?? null;
  if (!relPath) {
    const anyRec = await queryOne<{ evidence_path: string | null }>(
      `SELECT evidence_path
         FROM attendance_records
        WHERE session_id = $1 AND student_id = $2 AND evidence_path IS NOT NULL
        ORDER BY round_no DESC
        LIMIT 1`,
      [sessionId, studentId],
    );
    relPath = anyRec?.evidence_path ?? null;
  }
  if (!relPath) {
    throw new HttpError(404, 'Bản ghi này không có ảnh bằng chứng');
  }

  try {
    return await readEvidenceImage(relPath);
  } catch {
    throw new HttpError(404, 'Không tìm thấy tệp ảnh bằng chứng trên máy chủ');
  }
}

function formatAttendanceStatusVi(rec: {
  status: string;
  subStatus?: string | null;
  periodicOverall?: string;
  mode?: string;
}): string {
  if (rec.status === 'manual') {
    if (rec.subStatus === 'manual_absent') return 'Vắng (Giảng viên chỉnh tay)';
    if (rec.subStatus === 'excused') return 'Vắng có phép (Giảng viên chỉnh tay)';
    return 'Có mặt (Giảng viên chỉnh tay)';
  }
  if (rec.mode === 'periodic' && rec.periodicOverall === 'partial') {
    return 'Vắng một phần (Chưa đủ số đợt)';
  }
  switch (rec.status) {
    case 'present':
      return 'Có mặt';
    case 'mismatch':
      return rec.subStatus === 'multiple_faces'
        ? 'Khuôn mặt không khớp (Nhiều khuôn mặt)'
        : 'Khuôn mặt không khớp';
    case 'absent':
      return 'Không có mặt (Vắng)';
    case 'no_profile':
      if (rec.subStatus === 'pending_review') return 'Chưa đăng ký (Đang chờ duyệt hồ sơ)';
      if (rec.subStatus === 'rejected') return 'Chưa đăng ký (Hồ sơ bị từ chối)';
      return 'Chưa đăng ký khuôn mặt';
    case 'pending':
    default:
      return 'Đang chờ xác thực';
  }
}

export async function exportAttendanceSession(
  lecturerId: number,
  sessionId: number,
  format: 'xlsx' | 'csv',
) {
  const details = await getAttendanceSessionDetails(sessionId);
  await ensureLecturerClassAccess(lecturerId, details.classId);

  const header = [
    'STT',
    'Mã sinh viên',
    'Họ và tên',
    'Trạng thái điểm danh',
    'Kết quả các đợt',
    'Độ tương đồng AI',
    'Số lượt thử',
    'Thời gian xác thực',
    'Người chỉnh tay',
    'Lý do chỉnh tay / Ghi chú',
  ];

  const dataRows = details.records.map((r, idx) => [
    idx + 1,
    r.loginId || '',
    r.studentName || '',
    formatAttendanceStatusVi({
      status: r.status,
      subStatus: r.subStatus,
      periodicOverall: r.periodicOverall,
      mode: details.mode,
    }),
    `${r.roundsPassed}/${r.totalRounds} đợt`,
    r.similarity !== null ? r.similarity.toFixed(3) : '',
    r.attempts,
    r.checkedAt ? new Date(r.checkedAt).toLocaleString('vi-VN', { hour12: false }) : '',
    r.overrideByName || '',
    r.overrideReason || '',
  ]);

  const safeClass = (details.className || `lop-${details.classId}`)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  if (format === 'csv') {
    return {
      buffer: toCsvBuffer([header, ...dataRows]),
      contentType: 'text/csv; charset=utf-8',
      filename: `diem-danh-${safeClass}-phien-${details.id}.csv`,
    };
  }

  const summarySheet = [
    ['Chỉ tiêu', 'Giá trị'],
    ['Lớp học phần', details.className || ''],
    ['Mã phòng họp', details.meetingCode],
    ['Chế độ điểm danh', details.mode === 'periodic' ? `Định kỳ (mỗi ${details.intervalMin} phút)` : 'Một lần'],
    ['Số đợt đã thực hiện', details.currentRound],
    ['Ngưỡng nhận diện Cosine', details.threshold],
    ['Tổng sĩ số lớp', details.summary.total],
    ['Có mặt', details.summary.present],
    ['Khuôn mặt không khớp', details.summary.mismatch],
    ['Không có mặt (Vắng)', details.summary.absent],
    ['Chưa đăng ký / Chờ duyệt', details.summary.noProfile],
    ['Thời gian bắt đầu', details.startedAt ? new Date(details.startedAt).toLocaleString('vi-VN', { hour12: false }) : ''],
    ['Thời gian kết thúc', details.endedAt ? new Date(details.endedAt).toLocaleString('vi-VN', { hour12: false }) : 'Đang mở'],
  ];

  const xlsxBuffer = xlsx.build([
    {
      name: 'Danh sach diem danh',
      data: [header, ...dataRows],
      options: {
        '!cols': [
          { wch: 6 },
          { wch: 16 },
          { wch: 26 },
          { wch: 34 },
          { wch: 14 },
          { wch: 18 },
          { wch: 12 },
          { wch: 22 },
          { wch: 22 },
          { wch: 36 },
        ],
      },
    },
    {
      name: 'Thong tin phien',
      data: summarySheet,
      options: {
        '!cols': [{ wch: 28 }, { wch: 40 }],
      },
    },
  ]);

  return {
    buffer: Buffer.from(xlsxBuffer),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename: `diem-danh-${safeClass}-phien-${details.id}.xlsx`,
  };
}

