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
  } finally {
    (db.pool as any).connect = origConnect;
  }
});
