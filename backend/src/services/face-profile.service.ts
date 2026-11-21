// src/services/face-profile.service.ts
import { pool, query, queryOne, withTransaction } from '../config/database.js';
import { HttpError } from '../utils/http-error.js';
import {
  registerFace,
  aiReadiness,
  AiInputError,
  AiServiceError,
} from './proctoring/ai-client.js';
import {
  saveFaceProfilePhoto,
  deleteUserFaceProfileDir,
  readEvidenceImage,
  deleteEvidenceImage,
} from './proctoring/storage.js';

export const CURRENT_FACE_MODEL_VERSION = 'buffalo_sc_v1';
export const REQUIRED_ENROLL_PHOTOS = 4;
export const MIN_INTRA_PROFILE_SIMILARITY = 0.28;

// ===========================================================================
// 1. AUTO-ENSURE DB TABLES ON STARTUP
// ===========================================================================
let schemaEnsured = false;

export async function ensureFaceAttendanceTables(): Promise<void> {
  if (schemaEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_face_profiles (
      user_id               INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      embedding             REAL[] NOT NULL,
      photo_path            TEXT,
      sample_count          INTEGER NOT NULL DEFAULT 4,
      model_version         TEXT NOT NULL DEFAULT 'buffalo_sc_v1',
      consented_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      review_status         TEXT NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending', 'approved', 'rejected')),
      reviewed_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at           TIMESTAMPTZ,
      reject_reason         TEXT,
      approved_embedding    REAL[],
      approved_photo_path   TEXT,
      approved_at           TIMESTAMPTZ,
      approved_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
      enrollment_count      INTEGER NOT NULL DEFAULT 1,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_face_profile_photos (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      step_no     SMALLINT NOT NULL CHECK (step_no BETWEEN 1 AND 4),
      photo_path  TEXT NOT NULL,
      face_score  REAL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, step_no)
    );

    CREATE TABLE IF NOT EXISTS attendance_sessions (
      id                 SERIAL PRIMARY KEY,
      meeting_id         TEXT NOT NULL,
      class_id           INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      started_by         INTEGER NOT NULL REFERENCES users(id),
      mode               TEXT NOT NULL DEFAULT 'once'
        CHECK (mode IN ('once', 'periodic')),
      strictness         TEXT NOT NULL DEFAULT 'balanced'
        CHECK (strictness IN ('relaxed', 'balanced', 'strict')),
      window_sec         INTEGER NOT NULL DEFAULT 120,
      threshold          REAL NOT NULL DEFAULT 0.45,
      interval_min       INTEGER,
      max_rounds         INTEGER,
      current_round      INTEGER NOT NULL DEFAULT 1,
      round_open         BOOLEAN NOT NULL DEFAULT TRUE,
      round_ends_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 minutes'),
      next_round_at      TIMESTAMPTZ,
      pass_ratio         REAL NOT NULL DEFAULT 0.7,
      duplicate_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
      started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at           TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      id                  SERIAL PRIMARY KEY,
      session_id          INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      round_no            INTEGER NOT NULL DEFAULT 1,
      student_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status              TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'present', 'mismatch', 'absent', 'no_profile', 'manual')),
      sub_status          TEXT,
      similarity          REAL,
      face_count          INTEGER,
      attempts            INTEGER NOT NULL DEFAULT 0,
      evidence_path       TEXT,
      evidence_expires_at TIMESTAMPTZ,
      checked_at          TIMESTAMPTZ,
      override_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
      override_at         TIMESTAMPTZ,
      override_reason     TEXT,
      UNIQUE (session_id, round_no, student_id)
    );

    ALTER TABLE exam_proctoring_settings
      ADD COLUMN IF NOT EXISTS require_face_profile BOOLEAN NOT NULL DEFAULT TRUE;

    CREATE INDEX IF NOT EXISTS idx_face_profiles_review_status
      ON user_face_profiles(review_status);
    CREATE INDEX IF NOT EXISTS idx_face_profile_photos_user
      ON user_face_profile_photos(user_id, step_no);
    CREATE INDEX IF NOT EXISTS idx_attendance_sessions_meeting
      ON attendance_sessions(meeting_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_attendance_sessions_class
      ON attendance_sessions(class_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_attendance_records_session_round
      ON attendance_records(session_id, round_no);
    CREATE INDEX IF NOT EXISTS idx_attendance_records_evidence_expiry
      ON attendance_records(evidence_expires_at) WHERE evidence_path IS NOT NULL;
  `);
  schemaEnsured = true;
}

// ===========================================================================
// 2. TOÁN HỌC VECTOR EMBEDDING 512 CHIỀU (CÓ UNIT TEST)
// ===========================================================================
export function l2Normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    const v = Number(vec[i]) || 0;
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  if (norm < 1e-12) return vec.map(() => 0);
  return vec.map((v) => Math.round(((Number(v) || 0) / norm) * 1e6) / 1e6);
}

/** Tính trung bình cộng 4 vector 512 chiều rồi chuẩn hóa L2 về độ dài đơn vị. */
export function computeNormalizedMeanEmbedding(embeddings: number[][]): number[] {
  if (!embeddings.length) {
    throw new Error('Danh sách embedding không được rỗng');
  }
  const dim = embeddings[0].length;
  if (dim !== 512) {
    throw new Error(`Chiều vector không hợp lệ (${dim}, cần 512)`);
  }
  const mean = new Array<number>(dim).fill(0);
  for (const emb of embeddings) {
    if (!Array.isArray(emb) || emb.length !== dim) {
      throw new Error('Kích thước các vector embedding không đồng nhất');
    }
    for (let i = 0; i < dim; i++) {
      mean[i] += Number(emb[i]) || 0;
    }
  }
  for (let i = 0; i < dim; i++) {
    mean[i] /= embeddings.length;
  }
  return l2Normalize(mean);
}

/** Độ tương đồng Cosine giữa 2 vector (đã hoặc chưa chuẩn hóa L2). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = Number(a[i]) || 0;
    const vb = Number(b[i]) || 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom < 1e-12) return 0;
  return Math.round((dot / denom) * 10000) / 10000;
}

/** Kiểm tra 4 ảnh đăng ký có cùng thuộc về một người hay không. */
export function checkIntraProfileConsistency(
  embeddings: number[][],
  minPairwiseSim = MIN_INTRA_PROFILE_SIMILARITY,
): { ok: boolean; minSim: number; badPair?: [number, number] } {
  let minSim = 1;
  let badPair: [number, number] | undefined;
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      const sim = cosineSimilarity(embeddings[i], embeddings[j]);
      if (sim < minSim) {
        minSim = sim;
        if (sim < minPairwiseSim && !badPair) {
          badPair = [i + 1, j + 1];
        }
      }
    }
  }
  return {
    ok: !badPair,
    minSim,
    badPair,
  };
}

/** Chuyển mã lỗi AI sang thông báo tiếng Việt thân thiện cho sinh viên. */
export function translateAiFaceErrorVi(err: unknown): string {
  if (err instanceof AiInputError) {
    const code = (err.code || '').toUpperCase();
    const rawMsg = err.message || '';
    if (code.includes('NO_FACE') || /không.*khuôn mặt|no face/i.test(rawMsg)) {
      return 'Không phát hiện thấy khuôn mặt trong khung hình. Hãy nhìn thẳng vào khung oval, bỏ khẩu trang và đảm bảo đủ ánh sáng.';
    }
    if (code.includes('MULTIPLE') || /nhiều.*khuôn mặt|multiple/i.test(rawMsg)) {
      return 'Phát hiện nhiều hơn một khuôn mặt trong khung hình. Vui lòng đảm bảo chỉ có một mình bạn trước camera.';
    }
    if (code.includes('SMALL') || code.includes('QUALITY') || code.includes('BLUR') || /mờ|nhỏ|tối/i.test(rawMsg)) {
      return 'Ảnh khuôn mặt bị mờ, thiếu sáng hoặc quá xa camera. Hãy tiến lại gần và giữ đầu ổn định.';
    }
    return rawMsg || 'Ảnh khuôn mặt chưa đạt yêu cầu chất lượng. Vui lòng chụp lại.';
  }
  if (err instanceof AiServiceError) {
    if (err.code === 'AI_BUSY') {
      return 'Hệ thống nhận diện AI đang xử lý nhiều yêu cầu cùng lúc. Vui lòng thử lại sau vài giây.';
    }
    return 'Hệ thống nhận diện khuôn mặt đang tạm bận hoặc bảo trì. Vui lòng thử lại sau ít phút.';
  }
  return 'Không thể xử lý ảnh khuôn mặt. Vui lòng thử lại.';
}

// ===========================================================================
// 3. SINH VIÊN: XEM TRẠNG THÁI, KIỂM TRA TỪNG BƯỚC, ĐĂNG KÝ 4 ẢNH, XÓA HỒ SƠ
// ===========================================================================
export async function getMyFaceProfile(userId: number) {
  await ensureFaceAttendanceTables();
  const row = await queryOne<any>(
    `SELECT ufp.*,
            r.name AS reviewer_name,
            ap.name AS approved_by_name
       FROM user_face_profiles ufp
       LEFT JOIN users r ON r.id = ufp.reviewed_by
       LEFT JOIN users ap ON ap.id = ufp.approved_by
      WHERE ufp.user_id = $1`,
    [userId],
  );

  const photos = await query<{ step_no: number; face_score: number | null; created_at: Date }>(
    `SELECT step_no, face_score, created_at
       FROM user_face_profile_photos
      WHERE user_id = $1
      ORDER BY step_no ASC`,
    [userId],
  );

  const readiness = await aiReadiness().catch(() => ({ state: 'unreachable' as const }));

  if (!row) {
    return {
      enrolled: false,
      reviewStatus: 'unregistered' as const,
      hasUsableApprovedProfile: false,
      usingPreviousApproved: false,
      needsReEnroll: false,
      sidebarDotColor: 'red' as const,
      sampleCount: 0,
      modelVersion: null,
      consentedAt: null,
      reviewedAt: null,
      reviewerName: null,
      rejectReason: null,
      enrollmentCount: 0,
      createdAt: null,
      updatedAt: null,
      photos: [],
      aiState: readiness.state,
    };
  }

  const hasPreviousApproved =
    row.review_status === 'pending' &&
    Array.isArray(row.approved_embedding) &&
    row.approved_embedding.length === 512;
  const hasUsableApprovedProfile =
    row.review_status === 'approved' || hasPreviousApproved;
  const usingPreviousApproved = row.review_status === 'pending' && hasPreviousApproved;
  const needsReEnroll = Boolean(
    row.model_version &&
      row.model_version !== CURRENT_FACE_MODEL_VERSION &&
      !row.model_version.startsWith('buffalo'),
  );

  let sidebarDotColor: 'green' | 'yellow' | 'red' = 'red';
  if (row.review_status === 'approved' && !needsReEnroll) {
    sidebarDotColor = 'green';
  } else if (row.review_status === 'pending') {
    sidebarDotColor = 'yellow';
  }

  return {
    enrolled: true,
    reviewStatus: row.review_status as 'pending' | 'approved' | 'rejected',
    hasUsableApprovedProfile,
    usingPreviousApproved,
    needsReEnroll,
    sidebarDotColor,
    sampleCount: Number(row.sample_count ?? 4),
    modelVersion: row.model_version,
    consentedAt: row.consented_at,
    reviewedAt: row.reviewed_at,
    reviewerName: row.reviewer_name ?? row.approved_by_name ?? null,
    rejectReason: row.reject_reason ?? null,
    enrollmentCount: Number(row.enrollment_count ?? 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    photos: photos.map((p) => ({
      stepNo: Number(p.step_no),
      faceScore: p.face_score !== null ? Number(p.face_score) : null,
      createdAt: p.created_at,
    })),
    aiState: readiness.state,
  };
}

/** Kiểm tra chất lượng ngay từng ảnh trong Wizard 4 bước trước khi gửi lưu. */
export async function validateEnrollmentStep(imageBuffer: Buffer, stepNo: number) {
  if (!Number.isInteger(stepNo) || stepNo < 1 || stepNo > REQUIRED_ENROLL_PHOTOS) {
    throw new HttpError(400, 'Bước chụp ảnh không hợp lệ (cần từ 1 đến 4)');
  }
  try {
    const res = await registerFace(imageBuffer);
    return {
      valid: true,
      stepNo,
      faceScore: res.faceScore,
      modelVersion: res.modelVersions?.face || CURRENT_FACE_MODEL_VERSION,
    };
  } catch (err) {
    if (err instanceof AiInputError) {
      throw new HttpError(422, translateAiFaceErrorVi(err));
    }
    if (err instanceof AiServiceError) {
      throw new HttpError(503, translateAiFaceErrorVi(err));
    }
    throw err;
  }
}

/** Đăng ký hồ sơ khuôn mặt với 4 ảnh từ camera live. */
export async function enrollFaceProfile(
  userId: number,
  photoBuffers: Buffer[],
  consented: boolean,
) {
  await ensureFaceAttendanceTables();
  if (!consented) {
    throw new HttpError(
      400,
      'Bạn cần xác nhận đồng ý cho phép hệ thống lưu trữ đặc trưng khuôn mặt để điểm danh và xác thực thi.',
    );
  }
  if (!Array.isArray(photoBuffers) || photoBuffers.length !== REQUIRED_ENROLL_PHOTOS) {
    throw new HttpError(
      400,
      `Cần cung cấp đủ ${REQUIRED_ENROLL_PHOTOS} ảnh khuôn mặt theo các bước hướng dẫn (hiện nhận được ${photoBuffers?.length ?? 0} ảnh).`,
    );
  }

  const embeddings: number[][] = [];
  const faceScores: (number | null)[] = [];
  let detectedModelVersion = CURRENT_FACE_MODEL_VERSION;

  for (let i = 0; i < REQUIRED_ENROLL_PHOTOS; i++) {
    const stepNo = i + 1;
    try {
      const reg = await registerFace(photoBuffers[i]);
      embeddings.push(reg.embedding);
      faceScores.push(reg.faceScore);
      if (reg.modelVersions?.face) {
        detectedModelVersion = reg.modelVersions.face;
      }
    } catch (err) {
      const msg = translateAiFaceErrorVi(err);
      if (err instanceof AiInputError) {
        throw new HttpError(422, `Ảnh bước ${stepNo}: ${msg}`);
      }
      if (err instanceof AiServiceError) {
        throw new HttpError(503, msg);
      }
      throw err;
    }
  }

  // Kiểm tra cả 4 ảnh có cùng một khuôn mặt hay không
  const consistency = checkIntraProfileConsistency(embeddings);
  if (!consistency.ok && consistency.badPair) {
    throw new HttpError(
      422,
      `Ảnh ở bước ${consistency.badPair[0]} và bước ${consistency.badPair[1]} có độ tương đồng thấp (${consistency.minSim.toFixed(2)}), không giống cùng một người. Vui lòng chụp lại đồng nhất khuôn mặt của bạn.`,
    );
  }

  const meanEmbedding = computeNormalizedMeanEmbedding(embeddings);

  const savedPaths: string[] = [];
  try {
    for (let i = 0; i < REQUIRED_ENROLL_PHOTOS; i++) {
      const p = await saveFaceProfilePhoto(userId, i + 1, photoBuffers[i]);
      savedPaths.push(p);
    }

    const oldPathsToDelete = await withTransaction(async (client) => {
      const prevPhotos = (
        await client.query<{ photo_path: string }>(
          'SELECT photo_path FROM user_face_profile_photos WHERE user_id = $1',
          [userId],
        )
      ).rows.map((r) => r.photo_path);

      const prevProfileRes = await client.query<{
        review_status: string;
        embedding: number[];
        photo_path: string | null;
        reviewed_at: Date | null;
        reviewed_by: number | null;
        approved_embedding: number[] | null;
        approved_photo_path: string | null;
      }>(
        `SELECT review_status, embedding, photo_path, reviewed_at, reviewed_by,
                approved_embedding, approved_photo_path
           FROM user_face_profiles
          WHERE user_id = $1
          FOR UPDATE`,
        [userId],
      );
      const prevProfile = prevProfileRes.rows[0] ?? null;

      // Nếu hồ sơ cũ đã được duyệt ('approved'), sao lưu sang approved_embedding để sinh viên
      // vẫn điểm danh / vào thi được trong thời gian chờ giảng viên duyệt bộ ảnh mới (Mục 5.0 & 10).
      await client.query(
        `INSERT INTO user_face_profiles (
           user_id, embedding, photo_path, sample_count, model_version, consented_at,
           review_status, reviewed_by, reviewed_at, reject_reason,
           enrollment_count, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, NOW(), 'pending', NULL, NULL, NULL, 1, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           approved_embedding = CASE
             WHEN user_face_profiles.review_status = 'approved' THEN user_face_profiles.embedding
             ELSE user_face_profiles.approved_embedding
           END,
           approved_photo_path = CASE
             WHEN user_face_profiles.review_status = 'approved' THEN user_face_profiles.photo_path
             ELSE user_face_profiles.approved_photo_path
           END,
           approved_at = CASE
             WHEN user_face_profiles.review_status = 'approved' THEN COALESCE(user_face_profiles.reviewed_at, NOW())
             ELSE user_face_profiles.approved_at
           END,
           approved_by = CASE
             WHEN user_face_profiles.review_status = 'approved' THEN user_face_profiles.reviewed_by
             ELSE user_face_profiles.approved_by
           END,
           embedding        = EXCLUDED.embedding,
           photo_path       = EXCLUDED.photo_path,
           sample_count     = EXCLUDED.sample_count,
           model_version    = EXCLUDED.model_version,
           consented_at     = NOW(),
           review_status    = 'pending',
           reviewed_by      = NULL,
           reviewed_at      = NULL,
           reject_reason    = NULL,
           enrollment_count = user_face_profiles.enrollment_count + 1,
           updated_at       = NOW()`,
        [userId, meanEmbedding, savedPaths[0], REQUIRED_ENROLL_PHOTOS, detectedModelVersion],
      );

      await client.query('DELETE FROM user_face_profile_photos WHERE user_id = $1', [userId]);
      for (let i = 0; i < REQUIRED_ENROLL_PHOTOS; i++) {
        await client.query(
          `INSERT INTO user_face_profile_photos (user_id, step_no, photo_path, face_score)
           VALUES ($1, $2, $3, $4)`,
          [userId, i + 1, savedPaths[i], faceScores[i]],
        );
      }

      const keepPath =
        prevProfile?.review_status === 'approved'
          ? prevProfile.photo_path
          : prevProfile?.approved_photo_path ?? null;

      return prevPhotos.filter((p) => p && p !== keepPath);
    });

    for (const oldPath of oldPathsToDelete) {
      await deleteEvidenceImage(oldPath).catch(() => {});
    }

    return getMyFaceProfile(userId);
  } catch (err) {
    for (const p of savedPaths) {
      await deleteEvidenceImage(p).catch(() => {});
    }
    throw err;
  }
}

/** Xóa hoàn toàn dữ liệu khuôn mặt của sinh viên (DB + 4 ảnh trên đĩa). */
export async function deleteMyFaceProfile(userId: number) {
  await ensureFaceAttendanceTables();
  await withTransaction(async (client) => {
    await client.query('DELETE FROM user_face_profile_photos WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM user_face_profiles WHERE user_id = $1', [userId]);
  });
  await deleteUserFaceProfileDir(userId).catch(() => {});
  return { deleted: true };
}

/** Đọc ảnh đăng ký của chính sinh viên theo bước 1..4. */
export async function getMyFaceProfilePhoto(userId: number, stepNo: number): Promise<Buffer> {
  await ensureFaceAttendanceTables();
  const row = await queryOne<{ photo_path: string }>(
    `SELECT photo_path FROM user_face_profile_photos WHERE user_id = $1 AND step_no = $2`,
    [userId, stepNo],
  );
  let relPath = row?.photo_path ?? null;
  if (!relPath && stepNo === 1) {
    const p = await queryOne<{ photo_path: string | null }>(
      `SELECT photo_path FROM user_face_profiles WHERE user_id = $1`,
      [userId],
    );
    relPath = p?.photo_path ?? null;
  }
  if (!relPath) throw new HttpError(404, 'Không tìm thấy ảnh khuôn mặt');
  try {
    return await readEvidenceImage(relPath);
  } catch {
    throw new HttpError(404, 'Tệp ảnh không tồn tại trên máy chủ');
  }
}

/** Lấy vector embedding đã duyệt (chính thức hoặc bản đã duyệt trước đó khi đang chờ duyệt lại). */
export async function getUsableApprovedEmbedding(studentId: number): Promise<{
  status: 'approved' | 'pending' | 'rejected' | 'unregistered';
  usableEmbedding: number[] | null;
  modelVersion: string | null;
  rejectReason: string | null;
  usingPreviousApproved: boolean;
}> {
  await ensureFaceAttendanceTables();
  const row = await queryOne<{
    embedding: number[];
    review_status: 'pending' | 'approved' | 'rejected';
    approved_embedding: number[] | null;
    model_version: string | null;
    reject_reason: string | null;
  }>(
    `SELECT embedding, review_status, approved_embedding, model_version, reject_reason
       FROM user_face_profiles
      WHERE user_id = $1`,
    [studentId],
  );
  if (!row) {
    return {
      status: 'unregistered',
      usableEmbedding: null,
      modelVersion: null,
      rejectReason: null,
      usingPreviousApproved: false,
    };
  }
  if (row.review_status === 'approved' && Array.isArray(row.embedding) && row.embedding.length === 512) {
    return {
      status: 'approved',
      usableEmbedding: row.embedding.map(Number),
      modelVersion: row.model_version,
      rejectReason: null,
      usingPreviousApproved: false,
    };
  }
  if (
    row.review_status === 'pending' &&
    Array.isArray(row.approved_embedding) &&
    row.approved_embedding.length === 512
  ) {
    return {
      status: row.review_status,
      usableEmbedding: row.approved_embedding.map(Number),
      modelVersion: row.model_version,
      rejectReason: row.reject_reason,
      usingPreviousApproved: true,
    };
  }
  return {
    status: row.review_status,
    usableEmbedding: null,
    modelVersion: row.model_version,
    rejectReason: row.reject_reason,
    usingPreviousApproved: false,
  };
}

// ===========================================================================
// 4. GIẢNG VIÊN: DANH SÁCH HỒ SƠ THEO LỚP, XEM 4 ẢNH, DUYỆT / TỪ CHỐI / DUYỆT HÀNG LOẠT
// ===========================================================================
export async function canLecturerAccessStudentProfile(
  lecturerId: number,
  studentId: number,
): Promise<boolean> {
  const row = await queryOne(
    `SELECT 1
       FROM classes_n_students cs
       JOIN classes c ON c.id = cs.class_id
      WHERE cs.student_id = $1
        AND (
          c.lecturer_id = $2
          OR EXISTS (
            SELECT 1 FROM class_collaborators cc
             WHERE cc.class_id = c.id AND cc.lecturer_id = $2
          )
        )
      LIMIT 1`,
    [studentId, lecturerId],
  );
  return Boolean(row);
}

export async function listClassFaceProfiles(
  classId: number,
  filters?: { status?: string; search?: string },
) {
  await ensureFaceAttendanceTables();
  const rows = await query<any>(
    `SELECT u.id AS student_id,
            u.name AS student_name,
            COALESCE(ul.login_id, '') AS login_id,
            ufp.review_status,
            ufp.sample_count,
            ufp.model_version,
            ufp.consented_at,
            ufp.reviewed_by,
            rv.name AS reviewer_name,
            ufp.reviewed_at,
            ufp.reject_reason,
            ufp.enrollment_count,
            ufp.created_at,
            ufp.updated_at,
            (ufp.review_status = 'pending' AND ufp.approved_embedding IS NOT NULL) AS has_previous_approved,
            COALESCE(
              ARRAY(
                SELECT p.step_no
                  FROM user_face_profile_photos p
                 WHERE p.user_id = u.id
                 ORDER BY p.step_no ASC
              ),
              '{}'::smallint[]
            ) AS photo_steps
       FROM classes_n_students cs
       JOIN users u ON u.id = cs.student_id
       LEFT JOIN user_login_id ul ON ul.user_id = u.id
       LEFT JOIN user_face_profiles ufp ON ufp.user_id = u.id
       LEFT JOIN users rv ON rv.id = ufp.reviewed_by
      WHERE cs.class_id = $1
      ORDER BY
        CASE
          WHEN ufp.review_status = 'pending' THEN 1
          WHEN ufp.review_status = 'rejected' THEN 2
          WHEN ufp.review_status IS NULL THEN 3
          ELSE 4
        END ASC,
        u.name ASC`,
    [classId],
  );

  const mapped = rows.map((r) => {
    const status: 'unregistered' | 'pending' | 'approved' | 'rejected' =
      r.review_status || 'unregistered';
    return {
      studentId: Number(r.student_id),
      studentName: r.student_name as string,
      loginId: r.login_id as string,
      status,
      sampleCount: Number(r.sample_count ?? 0),
      modelVersion: r.model_version ?? null,
      consentedAt: r.consented_at ?? null,
      reviewedBy: r.reviewed_by ? Number(r.reviewed_by) : null,
      reviewerName: r.reviewer_name ?? null,
      reviewedAt: r.reviewed_at ?? null,
      rejectReason: r.reject_reason ?? null,
      enrollmentCount: Number(r.enrollment_count ?? 0),
      hasPreviousApproved: Boolean(r.has_previous_approved),
      photoSteps: Array.isArray(r.photo_steps) ? r.photo_steps.map(Number) : [],
      updatedAt: r.updated_at ?? null,
    };
  });

  const summary = {
    total: mapped.length,
    pending: mapped.filter((m) => m.status === 'pending').length,
    approved: mapped.filter((m) => m.status === 'approved').length,
    rejected: mapped.filter((m) => m.status === 'rejected').length,
    unregistered: mapped.filter((m) => m.status === 'unregistered').length,
  };

  let filtered = mapped;
  if (filters?.status && filters.status !== 'all') {
    filtered = filtered.filter((m) => m.status === filters.status);
  }
  if (filters?.search?.trim()) {
    const q = filters.search.trim().toLowerCase();
    filtered = filtered.filter(
      (m) =>
        m.studentName.toLowerCase().includes(q) ||
        m.loginId.toLowerCase().includes(q),
    );
  }

  return { summary, items: filtered };
}

export async function getStudentFaceProfilePhotoForLecturer(
  lecturerId: number,
  studentId: number,
  stepNo: number,
): Promise<Buffer> {
  await ensureFaceAttendanceTables();
  const allowed = await canLecturerAccessStudentProfile(lecturerId, studentId);
  if (!allowed) {
    throw new HttpError(403, 'Bạn không phụ trách lớp học phần nào của sinh viên này');
  }
  return getMyFaceProfilePhoto(studentId, stepNo);
}

export async function reviewStudentFaceProfile(
  lecturerId: number,
  studentId: number,
  input: { action: 'approve' | 'reject'; reason?: string },
) {
  await ensureFaceAttendanceTables();
  const allowed = await canLecturerAccessStudentProfile(lecturerId, studentId);
  if (!allowed) {
    throw new HttpError(403, 'Bạn không có quyền duyệt hồ sơ khuôn mặt của sinh viên này');
  }

  if (input.action !== 'approve' && input.action !== 'reject') {
    throw new HttpError(400, 'Hành động duyệt không hợp lệ (approve hoặc reject)');
  }

  const reason = String(input.reason ?? '').trim();
  if (input.action === 'reject' && !reason) {
    throw new HttpError(400, 'Vui lòng chọn hoặc nhập lý do từ chối hồ sơ khuôn mặt');
  }

  await withTransaction(async (client) => {
    const profileRes = await client.query(
      'SELECT user_id FROM user_face_profiles WHERE user_id = $1 FOR UPDATE',
      [studentId],
    );
    if (profileRes.rows.length === 0) {
      throw new HttpError(404, 'Sinh viên này chưa gửi hồ sơ khuôn mặt');
    }

    if (input.action === 'approve') {
      await client.query(
        `UPDATE user_face_profiles
            SET review_status       = 'approved',
                reviewed_by         = $2,
                reviewed_at         = NOW(),
                reject_reason       = NULL,
                approved_embedding  = embedding,
                approved_photo_path = photo_path,
                approved_at         = NOW(),
                approved_by         = $2,
                updated_at          = NOW()
          WHERE user_id = $1`,
        [studentId, lecturerId],
      );

      // Mở khóa ngay các bản ghi điểm danh đang ở trạng thái 'no_profile' trong các phiên đang mở
      await client.query(
        `UPDATE attendance_records ar
            SET status = 'pending',
                sub_status = NULL
           FROM attendance_sessions s
          WHERE ar.session_id = s.id
            AND s.ended_at IS NULL
            AND s.round_open = TRUE
            AND ar.round_no = s.current_round
            AND ar.student_id = $1
            AND ar.status = 'no_profile'`,
        [studentId],
      );
    } else {
      await client.query(
        `UPDATE user_face_profiles
            SET review_status       = 'rejected',
                reviewed_by         = $2,
                reviewed_at         = NOW(),
                reject_reason       = $3,
                approved_embedding  = NULL,
                approved_photo_path = NULL,
                approved_at         = NULL,
                approved_by         = NULL,
                updated_at          = NOW()
          WHERE user_id = $1`,
        [studentId, lecturerId, reason],
      );

      // Chuyển các bản ghi đang 'pending' của sinh viên trong các phiên điểm danh đang mở sang 'no_profile' (rejected)
      await client.query(
        `UPDATE attendance_records ar
            SET status = 'no_profile',
                sub_status = 'rejected'
           FROM attendance_sessions s
          WHERE ar.session_id = s.id
            AND s.ended_at IS NULL
            AND s.round_open = TRUE
            AND ar.round_no = s.current_round
            AND ar.student_id = $1
            AND ar.status = 'pending'`,
        [studentId],
      );
    }
  });

  return {
    studentId,
    reviewStatus: input.action === 'approve' ? 'approved' : 'rejected',
    rejectReason: input.action === 'reject' ? reason : null,
  };
}

export async function reviewBulkStudentFaceProfiles(
  lecturerId: number,
  input: { userIds: number[]; action: 'approve' | 'reject'; reason?: string },
) {
  await ensureFaceAttendanceTables();
  if (!Array.isArray(input.userIds) || input.userIds.length === 0) {
    throw new HttpError(400, 'Vui lòng chọn ít nhất một hồ sơ sinh viên để duyệt');
  }
  const uniqueIds = Array.from(new Set(input.userIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)));
  const updatedUserIds: number[] = [];

  for (const uid of uniqueIds) {
    const canAccess = await canLecturerAccessStudentProfile(lecturerId, uid);
    if (!canAccess) continue;
    try {
      await reviewStudentFaceProfile(lecturerId, uid, {
        action: input.action,
        reason: input.reason,
      });
      updatedUserIds.push(uid);
    } catch {
      // Bỏ qua sinh viên chưa có hồ sơ khi chọn tất cả
    }
  }

  return {
    updatedCount: updatedUserIds.length,
    updatedUserIds,
  };
}

