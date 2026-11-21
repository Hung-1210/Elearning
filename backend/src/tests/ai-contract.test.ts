// Contract test giữa Node AI client ↔ FastAPI (mô phỏng các phản hồi/lỗi HTTP ở biên fetch;
// hành vi với 4 model thật đã được kiểm bằng AI/tests/smoke_ai.py).
// Chạy: npm test --prefix backend
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let mode = 'ok';
let hits = 0;
let lastRequestIdHeader: string | null = null;

const okBody = (over: any = {}) => ({
  schema_version: 'proctoring.analyze.v2',
  request_id: 'r1',
  inference_started_at: '2026-01-01T00:00:00Z',
  completed_at: '2026-01-01T00:00:01Z',
  inference_ms: 500,
  modules: {
    face: { status: 'ok', face_count: 1, primary: { bbox: [1, 2, 3, 4], score: 0.9 } },
    identity: { status: 'ok', similarity: 0.8 },
    head_pose: { status: 'ok', yaw: 50, pitch: 1, roll: 0 },
    gaze: { status: 'not_requested' },
    objects: { status: 'ok', detections: [] },
  },
  model_versions: { face: 'f' },
  timings_ms: { total: 500 },
  ...over,
});

const jsonResponse = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const mockFetch: typeof fetch = async (input, init) => {
  hits += 1;
  const headers = new Headers(init?.headers);
  lastRequestIdHeader = headers.get('X-Request-Id');
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  if (url.endsWith('/ready')) {
    if (mode === 'ready-ok') {
      return jsonResponse(200, {
        status: 'ready',
        models: { face_detector: { status: 'loaded', version: 'buffalo_l', error: null } },
      });
    }
    if (mode === 'ready-missing') {
      return jsonResponse(503, {
        status: 'not_ready',
        models: { objects: { status: 'failed', version: null, error: 'missing checkpoint' } },
      });
    }
    throw new TypeError('fetch failed');
  }

  if (mode === 'timeout') {
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    });
  }
  if (mode === 'unreachable') {
    throw new TypeError('fetch failed');
  }
  if (mode === 'busy') return jsonResponse(429, { error: { code: 'AI_BUSY', message: 'busy' } });
  if (mode === 'unavailable') return jsonResponse(503, { error: { code: 'MODEL_UNAVAILABLE', message: 'chưa sẵn sàng' } });
  if (mode === 'old') return jsonResponse(200, { face_count: 1, primary: null, objects: [] });
  if (mode === 'badjson') {
    return new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (mode === 'noface') {
    return jsonResponse(200, okBody({
      modules: {
        face: { status: 'ok', face_count: 0, primary: null },
        identity: { status: 'no_face' },
        head_pose: { status: 'no_face' },
        gaze: { status: 'not_requested' },
        objects: { status: 'ok', detections: [] },
      },
    }));
  }
  if (mode === 'objdown') {
    return jsonResponse(200, okBody({
      modules: { ...okBody().modules, objects: { status: 'unavailable', error: 'no ckpt' } },
    }));
  }
  if (mode === 'register-noface') {
    return jsonResponse(422, { error: { code: 'NO_FACE', message: 'Không phát hiện khuôn mặt' } });
  }
  if (mode === 'register-ok') {
    return jsonResponse(200, {
      embedding: new Array(512).fill(0.05),
      model_versions: { face_recognition: 'buffalo_l' },
      face: { score: 0.92 },
    });
  }
  return jsonResponse(200, okBody());
};

let client: typeof import('../services/proctoring/ai-client.js');
let policy: typeof import('../services/proctoring/policy.js');
let visibility: typeof import('../services/exam/visibility.js');
let examService: typeof import('../services/exam/exam.service.js');
let exportService: typeof import('../services/exam/export.service.js');
let storageService: typeof import('../services/proctoring/storage.js');
let faceProfileService: typeof import('../services/face-profile.service.js');
let attendanceService: typeof import('../services/attendance.service.js');
let aiChunker: typeof import('../services/ai/chunker.js');
let aiTextExtract: typeof import('../services/ai/text-extract.js');
let aiSchema: typeof import('../services/ai/schema.js');
let aiVectorStore: typeof import('../services/ai/vector-store.js');
let aiQuestionGen: typeof import('../services/ai/question-gen.service.js');
let aiRagService: typeof import('../services/ai/rag.service.js');
let aiGeminiClient: typeof import('../services/ai/gemini.client.js');
let db: typeof import('../config/database.js');
let settings: ReturnType<typeof import('../services/proctoring/policy.js').resolveProctoringSettings>;
const run = { face: true, headPose: true, gaze: false, objects: true, identity: true };

before(async () => {
  process.env.AI_SERVICE_URL = 'http://127.0.0.1:8500';
  process.env.AI_SERVICE_TIMEOUT_MS = '120';
  process.env.AI_MAX_RETRIES = '0';
  process.env.AI_BREAKER_FAILURES = '3';
  process.env.AI_BREAKER_OPEN_MS = '60000';

  client = await import('../services/proctoring/ai-client.js');
  policy = await import('../services/proctoring/policy.js');
  visibility = await import('../services/exam/visibility.js');
  examService = await import('../services/exam/exam.service.js');
  exportService = await import('../services/exam/export.service.js');
  storageService = await import('../services/proctoring/storage.js');
  faceProfileService = await import('../services/face-profile.service.js');
  attendanceService = await import('../services/attendance.service.js');
  aiChunker = await import('../services/ai/chunker.js');
  aiTextExtract = await import('../services/ai/text-extract.js');
  aiSchema = await import('../services/ai/schema.js');
  aiVectorStore = await import('../services/ai/vector-store.js');
  aiQuestionGen = await import('../services/ai/question-gen.service.js');
  aiRagService = await import('../services/ai/rag.service.js');
  aiGeminiClient = await import('../services/ai/gemini.client.js');
  db = await import('../config/database.js');
  client.setFetchImplForTest(mockFetch);
  settings = policy.resolveProctoringSettings({
    enabled: true,
    trackHeadPose: true,
    detectPhone: true,
    detectNoFace: true,
    noFaceGraceSec: 1,
  });
});

after(async () => {
  client.setFetchImplForTest(null);
  client.resetBreakerForTest();
  await db.pool.end().catch(() => {});
});

const frame = (requestId?: string) => ({
  imageBuffer: Buffer.from([0xff, 0xd8, 0xff]),
  referenceEmbedding: new Array(512).fill(0.01),
  run,
  requestId,
});
const fail = async (p: Promise<any>) => p.then(() => assert.fail('phải ném lỗi'), (e) => e);

test('parse v2: camelCase, status từng module, metadata & X-Request-Id header', async () => {
  client.resetBreakerForTest();
  mode = 'ok';
  const a = await client.analyzeFrame(frame('req-trace-123'));
  assert.equal(lastRequestIdHeader, 'req-trace-123');
  assert.equal(a.faceCount, 1);
  assert.equal(a.moduleStatus.headPose, 'ok');
  assert.equal(a.moduleStatus.gaze, 'not_requested');
  assert.equal(a.primary?.headPose?.yaw, 50);
  assert.equal(a.primary?.similarity, 0.8);
  assert.equal(a.inferenceMs, 500);
});

test('không thấy mặt = faceCount 0 (đã chạy), có mẫu no_face; không có mẫu góc đầu', async () => {
  mode = 'noface';
  const a = await client.analyzeFrame(frame());
  assert.equal(a.faceCount, 0);
  const s = policy.evaluateAnalysis(a, settings, run);
  assert.equal(s.find((x) => x.type === 'no_face')?.active, true);
  assert.equal(s.some((x) => x.type.startsWith('head_')), false);
});

test('góc đầu vượt ngưỡng => mẫu head_turn active', async () => {
  mode = 'ok';
  const a = await client.analyzeFrame(frame());
  const s = policy.evaluateAnalysis(a, settings, run);
  assert.equal(s.some((x) => x.type.startsWith('head_turn') && x.active), true);
});

test('YOLO unavailable: KHÔNG phát mẫu object_*, face rule vẫn chạy, báo degraded', async () => {
  mode = 'objdown';
  const a = await client.analyzeFrame(frame());
  const s = policy.evaluateAnalysis(a, settings, run);
  assert.equal(s.some((x) => x.type.startsWith('object_')), false);
  assert.equal(s.some((x) => x.type === 'multiple_faces'), true);
  assert.deepEqual(policy.degradedModules(a, run), ['objects']);
});

test('face detector lỗi (faceCount=null) => không phát no_face/multiple_faces', () => {
  const a: any = {
    requestId: 'x',
    moduleStatus: {
      face: 'error',
      identity: 'skipped_face_unavailable',
      headPose: 'skipped_face_unavailable',
      gaze: 'not_requested',
      objects: 'ok',
    },
    moduleErrors: {},
    faceCount: null,
    primary: null,
    objects: [],
  };
  const s = policy.evaluateAnalysis(a, settings, run);
  assert.equal(
    s.some((x) => x.type === 'no_face' || x.type === 'multiple_faces' || x.type === 'identity_mismatch'),
    false,
  );
});

test('schema cũ => AI_SCHEMA_MISMATCH (không đọc field deprecated)', async () => {
  mode = 'old';
  const e = await fail(client.analyzeFrame(frame()));
  assert.equal(e.code, 'AI_SCHEMA_MISMATCH');
});

test('429 => AI_BUSY, 503 => AI_MODEL_UNAVAILABLE, JSON hỏng => AI_BAD_RESPONSE', async () => {
  client.resetBreakerForTest();
  mode = 'busy';
  assert.equal((await fail(client.analyzeFrame(frame()))).code, 'AI_BUSY');
  mode = 'unavailable';
  assert.equal((await fail(client.analyzeFrame(frame()))).code, 'AI_MODEL_UNAVAILABLE');
  mode = 'badjson';
  assert.equal((await fail(client.analyzeFrame(frame()))).code, 'AI_BAD_RESPONSE');
});

test('register-face: ảnh không đạt => AiInputError (không mở circuit breaker); ảnh đạt => 512-dim', async () => {
  client.resetBreakerForTest();
  mode = 'register-noface';
  const e = await fail(client.registerFace(Buffer.from([1])));
  assert.equal(e.name, 'AiInputError');
  assert.equal(e.code, 'NO_FACE');
  assert.equal(client.getBreakerState().failures, 0);

  mode = 'register-ok';
  const okRes = await client.registerFace(Buffer.from([0xff, 0xd8, 0xff]));
  assert.equal(okRes.embedding.length, 512);
  assert.equal(okRes.faceScore, 0.92);
});

test('aiReadiness: phân biệt ready / not_ready / unreachable', async () => {
  mode = 'ready-ok';
  assert.equal((await client.aiReadiness()).state, 'ready');
  mode = 'ready-missing';
  assert.equal((await client.aiReadiness()).state, 'not_ready');
  mode = 'ready-down';
  assert.equal((await client.aiReadiness()).state, 'unreachable');
});

test('timeout => AI_TIMEOUT; lỗi hạ tầng liên tiếp mở circuit breaker, không gọi AI nữa', async () => {
  client.resetBreakerForTest();
  mode = 'timeout';
  const beforeHits = hits;
  assert.equal((await fail(client.analyzeFrame(frame()))).code, 'AI_TIMEOUT');
  assert.equal((await fail(client.analyzeFrame(frame()))).code, 'AI_TIMEOUT');
  assert.equal((await fail(client.analyzeFrame(frame()))).code, 'AI_TIMEOUT');
  assert.equal(client.getBreakerState().open, true);
  const hitsOpen = hits;
  assert.equal((await fail(client.analyzeFrame(frame()))).code, 'AI_CIRCUIT_OPEN');
  assert.equal(hits, hitsOpen, 'breaker mở thì không được gọi AI');
  assert.equal(hitsOpen - beforeHits, 3);
});

test('buildRunFlags & resolveProctoringSettings: objectStride tắt YOLO ở frame xen kẽ và clamp biên hợp lệ', () => {
  const strictResolved = policy.resolveProctoringSettings({
    enabled: true,
    headSensitivity: 'strict',
    gazeSensitivity: 'strict',
    trackGaze: true,
    detectPhone: true,
    frameIntervalMs: 100, // thấp hơn min 500 => phải clamp về 500
    objectConfThreshold: 0.99, // cao hơn max 0.95 => phải clamp về 0.95
  });
  assert.equal(strictResolved.headYawThresholdDeg, policy.HEAD_PRESETS.strict.headYawThresholdDeg);
  assert.equal(strictResolved.gazeYawThresholdDeg, policy.GAZE_PRESETS.strict.gazeYawThresholdDeg);
  assert.equal(strictResolved.frameIntervalMs, 500);
  assert.equal(strictResolved.objectConfThreshold, 0.95);

  const flagsObjectSkipped = policy.buildRunFlags(strictResolved, true, false, false);
  assert.equal(flagsObjectSkipped.face, true);
  assert.equal(flagsObjectSkipped.headPose, true);
  assert.equal(flagsObjectSkipped.gaze, true);
  assert.equal(flagsObjectSkipped.objects, false, 'objectDue=false phải bỏ qua YOLO');
  assert.equal(flagsObjectSkipped.identity, false, 'identityCheckDue=false phải bỏ qua so khớp');

  const disabledSettings = policy.resolveProctoringSettings({ enabled: false, detectPhone: true });
  const disabledFlags = policy.buildRunFlags(disabledSettings, true, true, true);
  assert.deepEqual(disabledFlags, {
    face: false, headPose: false, gaze: false, objects: false, identity: false,
  });
});

test('computeStudentResultVisibility: thực thi nghiêm ngặt immediately / after_close / hidden và allow_review', () => {
  const now = new Date('2026-05-01T10:00:00Z');
  const futureClose = '2026-05-01T12:00:00Z';
  const pastClose = '2026-05-01T09:00:00Z';

  // Đang làm bài dở => không bao giờ hiển thị điểm/đáp án
  const inProgress = visibility.computeStudentResultVisibility({
    attemptStatus: 'in_progress',
    resultVisibility: 'immediately',
    allowReview: true,
    examEndTime: pastClose,
    now,
  });
  assert.equal(inProgress.canSeeScore, false);
  assert.equal(inProgress.canReviewAnswers, false);

  // after_close nhưng đề chưa đóng => ẩn điểm + trả lý do rõ ràng
  const beforeClose = visibility.computeStudentResultVisibility({
    attemptStatus: 'submitted',
    resultVisibility: 'after_close',
    allowReview: true,
    examEndTime: futureClose,
    now,
  });
  assert.equal(beforeClose.canSeeScore, false);
  assert.equal(beforeClose.canReviewAnswers, false);
  assert.ok(beforeClose.reason?.includes('kết thúc'));

  // after_close và đề đã đóng => cho xem điểm, allow_review quyết định xem chi tiết
  const afterCloseNoReview = visibility.computeStudentResultVisibility({
    attemptStatus: 'submitted',
    resultVisibility: 'after_close',
    allowReview: false,
    examEndTime: pastClose,
    now,
  });
  assert.equal(afterCloseNoReview.canSeeScore, true);
  assert.equal(afterCloseNoReview.canReviewAnswers, false);

  // hidden => ẩn vĩnh viễn kể cả sau khi đóng đề
  const hidden = visibility.computeStudentResultVisibility({
    attemptStatus: 'submitted',
    resultVisibility: 'hidden',
    allowReview: true,
    examEndTime: pastClose,
    now,
  });
  assert.equal(hidden.canSeeScore, false);
  assert.equal(hidden.canReviewAnswers, false);
  assert.ok(hidden.reason?.includes('ẩn'));
});

test('resolveProctoringSettings: chuẩn hóa low/medium/high & undefined khớp CHECK constraint PostgreSQL', () => {
  const r1 = policy.resolveProctoringSettings({
    enabled: true,
    headSensitivity: 'medium' as any,
    gazeSensitivity: 'medium' as any,
    gazeYawThresholdDeg: undefined,
    violationAction: 'invalid_val' as any,
  });
  assert.equal(r1.headSensitivity, 'normal');
  assert.equal(r1.gazeSensitivity, 'normal');
  assert.equal(r1.violationAction, 'warn_and_log');
  assert.equal(r1.gazeYawThresholdDeg, policy.GAZE_PRESETS.normal.gazeYawThresholdDeg);

  const r2 = policy.resolveProctoringSettings({
    headSensitivity: 'low' as any,
    gazeSensitivity: 'high' as any,
  });
  assert.equal(r2.headSensitivity, 'relaxed');
  assert.equal(r2.gazeSensitivity, 'strict');

  const rCustom = policy.resolveProctoringSettings({
    headSensitivity: 'custom',
    headYawThresholdDeg: 42,
    headPitchThresholdDeg: 19,
  });
  assert.equal(rCustom.headSensitivity, 'custom');
  assert.equal(rCustom.headYawThresholdDeg, 42);
  assert.equal(rCustom.headPitchThresholdDeg, 19);
});

test('evaluateAnalysis (gaze): liếc mắt vượt ngưỡng phát mẫu warning đúng hướng như nghiêng đầu', async () => {
  mode = 'ok';
  const gazeSettings = policy.resolveProctoringSettings({
    enabled: true,
    trackHeadPose: true,
    trackGaze: true,
    gazeSensitivity: 'normal', // 20 deg
  });
  const gazeFlags = policy.buildRunFlags(gazeSettings, false, false, false);
  const parsed = client.parseAnalyzeResponse(okBody({
    modules: {
      face: { status: 'ok', face_count: 1, primary: { bbox: [10, 10, 110, 130], score: 0.95 } },
      identity: { status: 'not_requested' },
      head_pose: { status: 'ok', yaw: 2, pitch: -8, roll: 0 },
      gaze: { status: 'ok', yaw: 24.5, pitch: -11.0 },
      objects: { status: 'not_requested' },
    },
  }), 'g1');
  const samples = policy.evaluateAnalysis(parsed, gazeSettings, gazeFlags);
  const gazeLeft = samples.find((s) => s.type === 'gaze_left');
  const gazeRight = samples.find((s) => s.type === 'gaze_right');
  assert.ok(gazeLeft && gazeLeft.active === true, 'yaw +24.5 > 20 => gaze_left active');
  assert.equal(gazeLeft.severity, 'warning');
  assert.ok(policy.BEHAVIOR_META.gaze_left.messageVi.includes('liếc mắt sang trái'));
  assert.ok(gazeRight && gazeRight.active === false);
});

test('QuestionBank: createBankQuestion & updateBankQuestion COMMIT trước khi đọc lại từ pool (chống lỗi 404 READ COMMITTED)', async () => {
  // Mô phỏng chính xác cơ chế READ COMMITTED của PostgreSQL:
  // kết nối khác trong pool CHỈ nhìn thấy bản ghi sau khi transaction client đã chạy COMMIT.
  const committedQuestions = new Map<number, any>();
  const committedOptions = new Map<number, any[]>();
  let nextId = 41;

  const origConnect = db.pool.connect.bind(db.pool);
  (db.pool as any).connect = async () => {
    let inTx = false;
    const stagedQuestions = new Map<number, any>();
    const stagedOptions = new Map<number, any[]>();

    return {
      release() {},
      async query(sql: string, params: any[] = []) {
        const s = sql.trim().toUpperCase();
        if (s === 'BEGIN') {
          inTx = true;
          return { rows: [], rowCount: 0 };
        }
        if (s === 'COMMIT') {
          for (const [k, v] of stagedQuestions) committedQuestions.set(k, v);
          for (const [k, v] of stagedOptions) committedOptions.set(k, v);
          stagedQuestions.clear();
          stagedOptions.clear();
          inTx = false;
          return { rows: [], rowCount: 0 };
        }
        if (s === 'ROLLBACK') {
          stagedQuestions.clear();
          stagedOptions.clear();
          inTx = false;
          return { rows: [], rowCount: 0 };
        }
        if (s.startsWith('INSERT INTO BANK_QUESTIONS')) {
          const id = nextId++;
          const row = {
            id,
            class_id: params[0],
            created_by: params[1],
            question_type: params[2],
            content: params[3],
            explanation: params[4],
            default_points: params[5],
            difficulty: params[6],
            chapter: params[7],
            tags: params[8],
            creator_name: 'GV Test',
            used_in_exams_count: 0,
          };
          if (inTx) stagedQuestions.set(id, row);
          else committedQuestions.set(id, row);
          return { rows: [{ id }], rowCount: 1 };
        }
        if (s.startsWith('UPDATE BANK_QUESTIONS')) {
          const id = params[0];
          const existing = (inTx ? stagedQuestions.get(id) : undefined) ?? committedQuestions.get(id);
          if (!existing) return { rows: [], rowCount: 0 };
          const updatedRow = {
            ...existing,
            question_type: params[1],
            content: params[2],
            explanation: params[3],
            default_points: params[4],
            difficulty: params[5],
            chapter: params[6],
            tags: params[7],
          };
          if (inTx) stagedQuestions.set(id, updatedRow);
          else committedQuestions.set(id, updatedRow);
          return { rows: [], rowCount: 1 };
        }
        if (s.startsWith('DELETE FROM BANK_QUESTION_OPTIONS')) {
          const qId = params[0];
          if (inTx) stagedOptions.set(qId, []);
          else committedOptions.set(qId, []);
          return { rows: [], rowCount: 0 };
        }
        if (s.startsWith('INSERT INTO BANK_QUESTION_OPTIONS')) {
          const opts: any[] = [];
          for (let i = 0; i < params.length; i += 4) {
            opts.push({
              id: i / 4 + 1,
              question_id: params[i],
              content: params[i + 1],
              is_correct: params[i + 2],
              position: params[i + 3],
            });
          }
          const qId = params[0];
          if (inTx) stagedOptions.set(qId, opts);
          else committedOptions.set(qId, opts);
          return { rows: [], rowCount: opts.length };
        }
        if (s.includes('FROM BANK_QUESTIONS')) {
          const id = params[0];
          // Connection ngoài transaction chỉ thấy dữ liệu đã COMMIT!
          const row = inTx
            ? stagedQuestions.get(id) ?? committedQuestions.get(id)
            : committedQuestions.get(id);
          return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }
        if (s.includes('FROM BANK_QUESTION_OPTIONS')) {
          const id = params[0];
          const rows = inTx
            ? stagedOptions.get(id) ?? committedOptions.get(id) ?? []
            : committedOptions.get(id) ?? [];
          return { rows, rowCount: rows.length };
        }
        return { rows: [], rowCount: 0 };
      },
    };
  };

  try {
    // 1. Tạo câu hỏi tự luận (giống hệt ảnh chụp lỗi của người dùng)
    const essay = await examService.createBankQuestion(1, 2, {
      questionType: 'essay',
      content: '  Trình bày cơ chế bắt tay 3 bước TCP  ',
      explanation: 'SYN -> SYN-ACK -> ACK',
      defaultPoints: 2,
      difficulty: 'medium',
      chapter: 'Chương 1: Tổng quan',
      // dù gửi kèm options rác, essay phải tự làm sạch về []
      options: [{ content: 'rác', isCorrect: true }],
    });
    assert.equal(essay.id, 41);
    assert.equal(essay.content, 'Trình bày cơ chế bắt tay 3 bước TCP');
    assert.deepEqual(essay.options, []);

    // 2. Tạo câu hỏi trắc nghiệm & cập nhật lại
    const mcq = await examService.createBankQuestion(1, 2, {
      questionType: 'single_choice',
      content: 'Giao thức nào hướng kết nối?',
      options: [
        { content: 'TCP', isCorrect: true },
        { content: 'UDP', isCorrect: false },
        { content: '   ', isCorrect: false },
      ],
    });
    assert.equal(mcq.options.length, 2);
    assert.equal(mcq.options[0].content, 'TCP');

    const updated = await examService.updateBankQuestion(mcq.id, {
      questionType: 'multiple_choice',
      content: 'Chọn các giao thức tầng Giao vận:',
      options: [
        { content: 'TCP', is_correct: true },
        { content: 'UDP', is_correct: true },
        { content: 'IP', is_correct: false },
      ],
    });
    assert.equal(updated.question_type, 'multiple_choice');
    assert.equal(updated.options.length, 3);

    // 3. Nhập hàng loạt từ JSON xuất ra (snake_case)
    const imported = await examService.importBankQuestions(1, 2, [
      {
        question_type: 'essay',
        content: 'Câu tự luận nhập từ JSON',
        default_points: 1.5,
        difficulty: 'hard',
      },
      {
        question_type: 'single_choice',
        content: 'HTTP mặc định dùng cổng nào?',
        default_points: 1,
        options: [
          { content: '80', is_correct: true },
          { content: '443', is_correct: false },
        ],
      },
    ]);
    assert.equal(imported.importedCount, 2);

    // 4. Báo lỗi chính xác số thứ tự câu nếu JSON lỗi
    await assert.rejects(
      () =>
        examService.importBankQuestions(1, 2, [
          { question_type: 'essay', content: 'Hợp lệ' },
          { question_type: 'single_choice', content: 'Thiếu đáp án', options: [] },
        ]),
      /Câu #2:/,
    );
  } finally {
    (db.pool as any).connect = origConnect;
  }
});

test('Export & SubmitReason: map đúng 4 mã submit_reason và chống CSV formula injection + kèm UTF-8 BOM', () => {
  assert.equal(exportService.formatSubmitReasonVi('time_up'), 'Tự động nộp khi hết thời gian');
  assert.equal(exportService.formatSubmitReasonVi('proctoring'), 'Tự động nộp do vượt ngưỡng vi phạm AI');
  assert.equal(exportService.formatSubmitReasonVi('lecturer'), 'Giảng viên thu bài trực tiếp');
  assert.equal(exportService.formatSubmitReasonVi('manual'), 'Thí sinh chủ động nộp bài');

  const csvBuf = exportService.toCsvBuffer([
    ['Mã SV', 'Ghi chú'],
    ['SV01', '=HYPERLINK("http://evil")'],
    ['SV02', 'Có dấu phẩy, và "ngoặc kép"'],
  ]);
  const text = csvBuf.toString('utf8');
  assert.equal(text.startsWith('\uFEFF'), true, 'Phải có UTF-8 BOM cho Excel');
  assert.ok(text.includes("'=HYPERLINK"), 'Phải escape ký tự công thức =');
  assert.ok(text.includes('"Có dấu phẩy, và ""ngoặc kép"""'));
});

test('Answer File Storage: lọc đuôi file, làm sạch tên file, lưu/đọc/xóa và chống path traversal', async () => {
  // 1. Chặn định dạng nguy hiểm (.exe, .bat, không có đuôi)
  assert.throws(() => storageService.sanitizeAnswerFileName('malware.exe'), /không được hỗ trợ/);
  assert.throws(() => storageService.sanitizeAnswerFileName('README'), /không được hỗ trợ/);

  // 2. Làm sạch tên file tiếng Việt & ký tự lạ
  const clean = storageService.sanitizeAnswerFileName('../../Bài tập_1 (Final).py');
  assert.equal(clean.ext, '.py');
  assert.equal(clean.safeName, 'Bài_tập_1_Final_.py');

  // 3. Lưu, đọc lại và xóa file bài làm thật trong private-uploads/answer-files
  const payload = Buffer.from('def solve():\n    return 42\n', 'utf8');
  const saved = await storageService.saveAttemptAnswerFile(999999, 12, 'solution.py', payload);
  try {
    assert.ok(saved.relPath.startsWith('answer-files/999999/'));
    assert.equal(storageService.extractOriginalAnswerFileName(saved.relPath), 'solution.py');

    const loaded = await storageService.readAttemptAnswerFile(saved.relPath);
    assert.equal(loaded.fileName, 'solution.py');
    assert.equal(loaded.buffer.toString('utf8'), payload.toString('utf8'));
  } finally {
    await storageService.deleteAttemptAnswerFile(saved.relPath);
  }

  // 4. Sau khi xóa thì đọc lại phải báo lỗi
  await assert.rejects(() => storageService.readAttemptAnswerFile(saved.relPath));
});

test('Face Profile & Attendance: chuẩn hóa L2 trung bình 4 ảnh, kiểm tra đồng nhất khuôn mặt và lưu/xóa ảnh riêng tư', async () => {
  // 1. Tạo 4 vector 512 chiều cùng hướng (cùng 1 người ở 4 góc chụp nhẹ)
  const base = new Array(512).fill(0).map((_, i) => (i % 2 === 0 ? 1 : 0.5));
  const e1 = base.map((v, i) => v + (i === 0 ? 0.05 : 0));
  const e2 = base.map((v, i) => v + (i === 1 ? 0.04 : 0));
  const e3 = base.map((v, i) => v + (i === 2 ? -0.04 : 0));
  const e4 = base.map((v, i) => v + (i === 3 ? 0.03 : 0));

  const consistencyOk = faceProfileService.checkIntraProfileConsistency([e1, e2, e3, e4]);
  assert.equal(consistencyOk.ok, true);
  assert.ok(consistencyOk.minSim > 0.95);

  const meanEmb = faceProfileService.computeNormalizedMeanEmbedding([e1, e2, e3, e4]);
  assert.equal(meanEmb.length, 512);
  // Độ dài L2 của vector trung bình sau chuẩn hóa phải xấp xỉ 1.0
  const normSq = meanEmb.reduce((s, v) => s + v * v, 0);
  assert.ok(Math.abs(Math.sqrt(normSq) - 1) < 1e-3);

  // 2. Nếu có 1 ảnh người khác hoàn toàn (trực giao / ngược hướng) => checkIntraProfileConsistency phát hiện ngay
  const impostor = new Array(512).fill(0).map((_, i) => (i % 2 === 0 ? -1 : -0.5));
  const consistencyBad = faceProfileService.checkIntraProfileConsistency([e1, e2, impostor, e4]);
  assert.equal(consistencyBad.ok, false);
  assert.deepEqual(consistencyBad.badPair, [1, 3]);

  // 3. Lưu và xóa thư mục 4 ảnh hồ sơ khuôn mặt trong private-uploads/face-profiles/<userId>
  const dummyJpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const p1 = await storageService.saveFaceProfilePhoto(888888, 1, dummyJpg);
  assert.ok(p1.startsWith('face-profiles/888888/step-1-'));
  const readBack = await storageService.readEvidenceImage(p1);
  assert.equal(readBack.length, dummyJpg.length);
  await storageService.deleteUserFaceProfileDir(888888);
  await assert.rejects(() => storageService.readEvidenceImage(p1));

  // 4. Quy tắc trạng thái hiệu lực điểm danh (chỉnh tay Có mặt / Có phép / Vắng)
  assert.equal(
    attendanceService.computeEffectiveStatus({ status: 'manual', sub_status: 'manual_present' }),
    'present',
  );
  assert.equal(
    attendanceService.computeEffectiveStatus({ status: 'manual', sub_status: 'excused' }),
    'present',
  );
  assert.equal(
    attendanceService.computeEffectiveStatus({ status: 'manual', sub_status: 'manual_absent' }),
    'absent',
  );
  assert.equal(attendanceService.STRICTNESS_THRESHOLDS.balanced, 0.45);
});

test('AI Text Extract & Chunker: nhận diện tiêu đề chương, chia chunk có overlap và phát hiện PDF scan / định dạng không hỗ trợ', async () => {
  assert.equal(aiChunker.detectHeadingLine('Chương 1: Tổng quan về Cơ sở dữ liệu'), 'Chương 1: Tổng quan về Cơ sở dữ liệu');
  assert.equal(aiChunker.detectHeadingLine('1.2. Mô hình thực thể kết hợp'), '1.2. Mô hình thực thể kết hợp');
  assert.equal(aiChunker.detectHeadingLine('Đây là một câu văn bình thường kết thúc bằng dấu chấm.'), null);

  const samplePages = [
    {
      page: 1,
      text: 'Chương 1: Lập trình Socket\n\nSocket là giao diện lập trình ứng dụng mạng cho phép các tiến trình giao tiếp qua TCP hoặc UDP.\n\n' +
        'Giao thức TCP hướng kết nối, đảm bảo truyền tin cậy và đúng thứ tự gói tin. '.repeat(25),
    },
    {
      page: 2,
      text: 'Chương 2: Giao thức UDP\n\nUDP là giao thức phi kết nối, tốc độ nhanh và độ trễ thấp, phù hợp truyền đa phương tiện.',
    },
  ];

  const chunks = aiChunker.chunkDocumentPages(samplePages, '2/1788439832925-Bài giảng mạng.pdf', {
    targetTokens: 200,
    overlapTokens: 40,
  });
  assert.ok(chunks.length >= 2, 'Phải tách thành nhiều chunk khi vượt targetTokens');
  assert.equal(chunks[0].heading, 'Chương 1: Lập trình Socket');
  assert.ok(chunks[0].embedInput.includes('[Bài giảng mạng.pdf – Mục: Chương 1: Lập trình Socket'));
  assert.ok(chunks.some((c) => c.heading === 'Chương 2: Giao thức UDP'));

  // Kiểm tra định dạng không hỗ trợ
  const unsup = await aiTextExtract.extractDocumentPages(Buffer.from('fake'), 'archive.zip');
  assert.equal(unsup.status, 'unsupported');

  // Kiểm tra phát hiện PDF ảnh scan (không có lớp chữ)
  const emptyPdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF', 'latin1');
  const scanned = await aiTextExtract.extractDocumentPages(emptyPdf, 'scan.pdf');
  assert.equal(scanned.status, 'scanned_pdf');
  assert.equal(scanned.errorCode, 'scanned_pdf');
});

test('AI VectorStore & pgvector: chuẩn hóa L2 vector 768 chiều, kết hợp Hybrid RRF và trích dẫn RAG', () => {
  const rawVec = [3, 4, ...new Array(766).fill(0)];
  const lit = aiSchema.toPgVectorLiteral(rawVec, 768);
  assert.ok(lit.startsWith('[0.6,0.8,0,'));
  const parsed = aiSchema.parsePgVectorLiteral(lit);
  assert.ok(parsed);
  assert.equal(parsed.length, 768);
  assert.ok(Math.abs(aiSchema.cosineSim(parsed, parsed) - 1) < 1e-4);

  const vecHits = [
    {
      chunkId: 10,
      docId: 1,
      fileName: '2/1700000000000-Giao_trinh.pdf',
      chunkIndex: 0,
      heading: 'Chương 1',
      pageFrom: 5,
      pageTo: 6,
      content: 'Khóa chính xác định duy nhất một bản ghi.',
      tokenCount: 50,
      vectorSim: 0.82,
    },
    {
      chunkId: 11,
      docId: 1,
      fileName: '2/1700000000000-Giao_trinh.pdf',
      chunkIndex: 1,
      heading: 'Chương 1',
      pageFrom: 7,
      pageTo: 7,
      content: 'Khóa ngoại tham chiếu tới khóa chính của bảng khác.',
      tokenCount: 50,
      vectorSim: 0.78,
    },
  ];
  const ftsHits = [
    {
      chunkId: 11,
      docId: 1,
      fileName: '2/1700000000000-Giao_trinh.pdf',
      chunkIndex: 1,
      heading: 'Chương 1',
      pageFrom: 7,
      pageTo: 7,
      content: 'Khóa ngoại tham chiếu tới khóa chính của bảng khác.',
      tokenCount: 50,
      ftsScore: 0.9,
    },
    {
      chunkId: 20,
      docId: 2,
      fileName: '2/1700000000000-Slide_CSDL.pptx',
      chunkIndex: 0,
      heading: 'Slide 3',
      pageFrom: 3,
      pageTo: 3,
      content: 'Ví dụ ràng buộc toàn vẹn tham chiếu.',
      tokenCount: 40,
      ftsScore: 0.5,
    },
  ];

  const merged = aiVectorStore.mergeHybridResultsRRF(vecHits, ftsHits, 3);
  assert.equal(merged.length, 3);
  // Chunk #11 xuất hiện ở cả Vector lẫn FTS nên phải đứng đầu bảng xếp hạng RRF
  assert.equal(merged[0].chunkId, 11);
  assert.equal(merged[0].displayFileName, 'Giao_trinh.pdf');

  const citations = aiRagService.buildCitationsFromRetrievedChunks(
    'Khóa ngoại dùng để tham chiếu tới khóa chính [1] và đảm bảo toàn vẹn tham chiếu [3].',
    merged,
  );
  assert.deepEqual(citations.map((c) => c.n), [1, 3]);
});

test('AI Question Generation & Gemini Client: chuẩn hóa ma trận 3x3, kiểm tra căn cứ trích dẫn, parse JSON và stream SSE', async () => {
  // 1. Ma trận 3x3 (Một đáp án + Nhiều đáp án + Tự luận)
  const cfg = aiQuestionGen.normalizeJobConfig({
    matrix: {
      single_choice: { easy: 2, medium: 2, hard: 1 },
      multiple_choice: { easy: 1, medium: 0, hard: 1 },
      essay: { easy: 0, medium: 1, hard: 0 },
    },
    optionCount: 4,
    chapter: 'Chương 2',
    verify: false,
  });
  assert.equal(cfg.totalRequested, 8);
  assert.equal(cfg.verify, false);

  // Vượt 50 câu phải ném lỗi 400
  assert.throws(
    () =>
      aiQuestionGen.normalizeJobConfig({
        matrix: {
          single_choice: { easy: 30, medium: 25, hard: 0 },
          multiple_choice: { easy: 0, medium: 0, hard: 0 },
          essay: { easy: 0, medium: 0, hard: 0 },
        },
      }),
    /tối đa là 50 câu/,
  );

  // 2. Validate bản nháp trắc nghiệm và tự luận + kiểm tra căn cứ trích dẫn (grounding)
  const chunksMap = new Map([
    [
      101,
      {
        chunkId: 101,
        docId: 5,
        fileName: '2/1700000000000-Mang_may_tinh.pdf',
        displayFileName: 'Mang_may_tinh.pdf',
        heading: 'Chương 3: Giao thức tầng giao vận',
        pageFrom: 12,
        pageTo: 13,
        content:
          'Giao thức TCP thực hiện bắt tay ba bước (three-way handshake) gồm SYN, SYN-ACK và ACK trước khi truyền dữ liệu.',
      },
    ],
  ]);
  const fallbackChunks = Array.from(chunksMap.values());

  const mcqDraft = aiQuestionGen.validateAndNormalizeAiDraft(
    {
      questionType: 'single_choice',
      difficulty: 'easy',
      content: 'Giao thức TCP sử dụng cơ chế nào để thiết lập kết nối?',
      options: [
        { content: 'Bắt tay ba bước (SYN, SYN-ACK, ACK)', isCorrect: true },
        { content: 'Truyền quảng bá trực tiếp không kết nối', isCorrect: false },
        { content: 'Định tuyến động theo trạng thái liên kết', isCorrect: false },
        { content: 'Phân giải tên miền đệ quy', isCorrect: false },
      ],
      explanation: 'TCP dùng cơ chế three-way handshake gồm SYN, SYN-ACK và ACK.',
      sourceChunkIds: [101],
      sourceQuote: 'Giao thức TCP thực hiện bắt tay ba bước (three-way handshake) gồm SYN, SYN-ACK và ACK',
    },
    'single_choice',
    chunksMap,
    fallbackChunks,
    cfg,
  );
  assert.equal(mcqDraft.qualityFlags.length, 0, 'Trích dẫn khớp tài liệu thì không bị gắn cờ ungrounded');
  assert.equal(mcqDraft.options.filter((o) => o.isCorrect).length, 1);

  const essayDraft = aiQuestionGen.validateAndNormalizeAiDraft(
    {
      questionType: 'essay',
      difficulty: 'medium',
      content: 'Hãy phân tích quá trình bắt tay ba bước của giao thức TCP.',
      options: [],
      explanation: 'Đáp án mẫu: Nêu đủ 3 bước SYN (0.5đ), SYN-ACK (0.5đ), ACK (0.5đ).',
      sourceChunkIds: [101],
      sourceQuote: 'Trích dẫn hoàn toàn không có trong đoạn văn bản gốc của giáo trình',
    },
    'essay',
    chunksMap,
    fallbackChunks,
    cfg,
  );
  assert.equal(essayDraft.questionType, 'essay');
  assert.ok(essayDraft.qualityFlags.includes('ungrounded'), 'Trích dẫn sai lệch phải bị gắn cờ ungrounded');

  // 3. Kiểm tra safeParseJson chịu được khối markdown ```json ... ```
  const parsedJson = aiGeminiClient.safeParseJson<{ questions: number[] }>(
    '```json\n{"questions": [1, 2, 3]}\n```',
  );
  assert.deepEqual(parsedJson.questions, [1, 2, 3]);

  // 4. Kiểm tra Gemini Client embedBatch (768 chiều chuẩn hóa L2) & streamGenerateText (SSE)
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  aiGeminiClient.setGeminiFetchForTest(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes(':batchEmbedContents')) {
      return jsonResponse(200, {
        embeddings: [
          { values: [3, 4, ...new Array(766).fill(0)] },
        ],
      });
    }
    if (url.includes(':streamGenerateContent')) {
      const ssePayload =
        'data: ' +
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Khóa ngoại ' }] } }],
        }) +
        '\n\n' +
        'data: ' +
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'tham chiếu tới khóa chính [1].' }] } }],
          usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 18 },
        }) +
        '\n\n';
      return new Response(ssePayload, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return jsonResponse(200, {});
  });

  try {
    const embRes = await aiGeminiClient.embedBatch(['Khóa ngoại là gì?']);
    assert.equal(embRes.embeddings.length, 1);
    assert.equal(embRes.embeddings[0].length, 768);
    assert.equal(embRes.embeddings[0][0], 0.6);
    assert.equal(embRes.embeddings[0][1], 0.8);

    const deltas: string[] = [];
    const streamRes = await aiGeminiClient.streamGenerateText({
      contents: [{ role: 'user', parts: [{ text: 'Hỏi' }] }],
      onDelta: (d) => deltas.push(d),
    });
    assert.equal(streamRes.fullText, 'Khóa ngoại tham chiếu tới khóa chính [1].');
    assert.equal(deltas.length, 2);
    assert.equal(streamRes.tokensIn, 120);
    assert.equal(streamRes.tokensOut, 18);
  } finally {
    aiGeminiClient.setGeminiFetchForTest(null);
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  }
});
