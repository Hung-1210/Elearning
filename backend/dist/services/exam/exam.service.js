"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBankQuestion = createBankQuestion;
exports.updateBankQuestion = updateBankQuestion;
exports.getBankQuestion = getBankQuestion;
exports.listBankQuestions = listBankQuestions;
exports.deleteBankQuestion = deleteBankQuestion;
exports.createExam = createExam;
exports.updateExam = updateExam;
exports.closeExam = closeExam;
exports.publishExam = publishExam;
exports.deleteExam = deleteExam;
exports.listExamsForClass = listExamsForClass;
exports.getExamForTeacher = getExamForTeacher;
exports.getExamForStudent = getExamForStudent;
exports.addQuestionsFromBank = addQuestionsFromBank;
exports.addManualQuestion = addManualQuestion;
exports.reorderQuestions = reorderQuestions;
exports.removeExamQuestion = removeExamQuestion;
exports.updateProctoringSettings = updateProctoringSettings;
exports.mapSettingsRow = mapSettingsRow;
const database_js_1 = require("../../config/database.js");
const http_error_js_1 = require("../../utils/http-error.js");
const policy_js_1 = require("../proctoring/policy.js");
function validateOptions(type, options) {
    if (type === 'essay' || type === 'file_upload')
        return;
    if (!options || options.length < 2)
        throw new http_error_js_1.HttpError(400, 'Câu hỏi trắc nghiệm cần tối thiểu 2 lựa chọn');
    const correctCount = options.filter((o) => o.isCorrect).length;
    if (correctCount === 0)
        throw new http_error_js_1.HttpError(400, 'Cần ít nhất 1 đáp án đúng');
    if (type === 'single_choice' && correctCount > 1) {
        throw new http_error_js_1.HttpError(400, 'Câu hỏi 1 đáp án đúng (single_choice) không được có nhiều hơn 1 lựa chọn đúng');
    }
}
async function createBankQuestion(classId, lecturerId, input) {
    validateOptions(input.questionType, input.options);
    return (0, database_js_1.withTransaction)(async (client) => {
        const q = await client.query(`INSERT INTO bank_questions
         (class_id, created_by, question_type, content, explanation, default_points, difficulty, chapter, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`, [classId, lecturerId, input.questionType, input.content, input.explanation ?? null,
            input.defaultPoints ?? 1, input.difficulty ?? 'medium', input.chapter ?? null, input.tags ?? []]);
        const questionId = q.rows[0].id;
        await insertOptions(client, 'bank_question_options', 'question_id', questionId, input.options);
        return getBankQuestion(questionId);
    });
}
async function updateBankQuestion(questionId, input) {
    validateOptions(input.questionType, input.options);
    return (0, database_js_1.withTransaction)(async (client) => {
        await client.query(`UPDATE bank_questions SET question_type=$2, content=$3, explanation=$4, default_points=$5,
              difficulty=$6, chapter=$7, tags=$8, updated_at=NOW()
        WHERE id=$1`, [questionId, input.questionType, input.content, input.explanation ?? null,
            input.defaultPoints ?? 1, input.difficulty ?? 'medium', input.chapter ?? null, input.tags ?? []]);
        await client.query('DELETE FROM bank_question_options WHERE question_id = $1', [questionId]);
        await insertOptions(client, 'bank_question_options', 'question_id', questionId, input.options);
        return getBankQuestion(questionId);
    });
}
async function insertOptions(client, table, fkCol, parentId, options) {
    if (!options?.length)
        return;
    const values = [];
    const placeholders = options.map((o, i) => {
        values.push(parentId, o.content, o.isCorrect, i);
        const base = i * 4;
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4})`;
    });
    await client.query(`INSERT INTO ${table} (${fkCol}, content, is_correct, position) VALUES ${placeholders.join(',')}`, values);
}
async function getBankQuestion(id) {
    const question = await (0, database_js_1.queryOne)(`SELECT * FROM bank_questions WHERE id = $1`, [id]);
    if (!question)
        throw new http_error_js_1.HttpError(404, 'Không tìm thấy câu hỏi');
    const options = await (0, database_js_1.query)(`SELECT id, content, is_correct, position FROM bank_question_options
      WHERE question_id = $1 ORDER BY position`, [id]);
    return { ...question, options };
}
async function listBankQuestions(classId, filters) {
    const conditions = ['class_id = $1'];
    const params = [classId];
    if (filters.chapter) {
        params.push(filters.chapter);
        conditions.push(`chapter = $${params.length}`);
    }
    if (filters.difficulty) {
        params.push(filters.difficulty);
        conditions.push(`difficulty = $${params.length}`);
    }
    if (filters.questionType) {
        params.push(filters.questionType);
        conditions.push(`question_type = $${params.length}`);
    }
    const questions = await (0, database_js_1.query)(`SELECT id, question_type, content, explanation, default_points, difficulty, chapter, tags, created_at
       FROM bank_questions WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`, params);
    if (questions.length === 0)
        return [];
    const qIds = questions.map((q) => q.id);
    const options = await (0, database_js_1.query)(`SELECT id, question_id, content, is_correct, position FROM bank_question_options WHERE question_id = ANY($1) ORDER BY position`, [qIds]);
    return questions.map((q) => ({
        ...q,
        options: options.filter((o) => o.question_id === q.id),
    }));
}
async function deleteBankQuestion(id) {
    await (0, database_js_1.query)('DELETE FROM bank_questions WHERE id = $1', [id]);
}
async function createExam(classId, lecturerId, input) {
    if (new Date(input.endTime) <= new Date(input.startTime)) {
        throw new http_error_js_1.HttpError(400, 'Thời gian kết thúc phải sau thời gian bắt đầu');
    }
    const row = await (0, database_js_1.queryOne)(`INSERT INTO exams (class_id, created_by, name, description, start_time, end_time,
                         duration_minutes, max_attempts, shuffle_questions, shuffle_options,
                         result_visibility, allow_review)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [classId, lecturerId, input.name, input.description ?? null, input.startTime, input.endTime,
        input.durationMinutes, input.maxAttempts ?? 1, input.shuffleQuestions ?? false,
        input.shuffleOptions ?? false, input.resultVisibility ?? 'after_close', input.allowReview ?? false]);
    const examId = row.id;
    await (0, database_js_1.query)(`INSERT INTO exam_proctoring_settings (exam_id) VALUES ($1)`, [examId]);
    return getExamForTeacher(examId);
}
async function updateExam(examId, input) {
    const current = await (0, database_js_1.queryOne)('SELECT status FROM exams WHERE id = $1', [examId]);
    if (!current)
        throw new http_error_js_1.HttpError(404, 'Không tìm thấy đề thi');
    const fields = [];
    const values = [examId];
    const set = (col, val) => { values.push(val); fields.push(`${col} = $${values.length}`); };
    if (input.name !== undefined)
        set('name', input.name);
    if (input.description !== undefined)
        set('description', input.description);
    if (input.startTime !== undefined)
        set('start_time', input.startTime);
    if (input.endTime !== undefined)
        set('end_time', input.endTime);
    if (input.durationMinutes !== undefined)
        set('duration_minutes', input.durationMinutes);
    if (input.maxAttempts !== undefined)
        set('max_attempts', input.maxAttempts);
    if (input.shuffleQuestions !== undefined)
        set('shuffle_questions', input.shuffleQuestions);
    if (input.shuffleOptions !== undefined)
        set('shuffle_options', input.shuffleOptions);
    if (input.resultVisibility !== undefined)
        set('result_visibility', input.resultVisibility);
    if (input.allowReview !== undefined)
        set('allow_review', input.allowReview);
    fields.push('updated_at = NOW()');
    if (fields.length > 1) {
        await (0, database_js_1.query)(`UPDATE exams SET ${fields.join(', ')} WHERE id = $1`, values);
    }
    return getExamForTeacher(examId);
}
/** Đóng đề ngay lập tức nhưng giữ nguyên đề và lịch sử làm bài. */
async function closeExam(examId) {
    const exam = await (0, database_js_1.queryOne)('SELECT id, status, end_time FROM exams WHERE id = $1', [examId]);
    if (!exam)
        throw new http_error_js_1.HttpError(404, 'Không tìm thấy đề thi');
    if (exam.status === 'draft')
        throw new http_error_js_1.HttpError(400, 'Không thể đóng đề nháp');
    if (new Date(exam.end_time) <= new Date())
        return getExamForTeacher(examId);
    await (0, database_js_1.query)(`UPDATE exams SET end_time = NOW(), updated_at = NOW() WHERE id = $1`, [examId]);
    return getExamForTeacher(examId);
}
/** Xuất bản đề: yêu cầu tối thiểu 1 câu hỏi. */
async function publishExam(examId) {
    const count = await (0, database_js_1.queryOne)(`SELECT COUNT(*)::text AS c FROM exam_questions WHERE exam_id = $1`, [examId]);
    if (!count || Number(count.c) === 0)
        throw new http_error_js_1.HttpError(400, 'Đề thi cần ít nhất 1 câu hỏi trước khi xuất bản');
    await (0, database_js_1.query)(`UPDATE exams SET status = 'published', updated_at = NOW() WHERE id = $1`, [examId]);
    return getExamForTeacher(examId);
}
async function deleteExam(examId) {
    const hasAttempts = await (0, database_js_1.queryOne)('SELECT 1 FROM exam_attempts WHERE exam_id = $1 LIMIT 1', [examId]);
    if (hasAttempts)
        throw new http_error_js_1.HttpError(400, 'Không thể xóa đề thi đã có học sinh làm bài. Cân nhắc đóng đề thay vì xóa.');
    await (0, database_js_1.query)('DELETE FROM exams WHERE id = $1', [examId]);
}
function computeDisplayStatus(row) {
    if (row.status === 'draft')
        return 'draft';
    const now = new Date();
    if (now < new Date(row.start_time))
        return 'scheduled';
    if (now > new Date(row.end_time))
        return 'closed';
    return 'open';
}
async function listExamsForClass(classId) {
    const rows = await (0, database_js_1.query)(`SELECT e.*, c.name AS class_name,
            (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id = e.id AND a.status='submitted')::int AS submitted_count,
            (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id = e.id AND a.status='in_progress')::int AS in_progress_count,
            (SELECT COUNT(*) FROM classes_n_students s WHERE s.class_id = e.class_id)::int AS total_students,
            (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id)::int AS total_questions,
            (SELECT COALESCE(SUM(eq.points), 0) FROM exam_questions eq WHERE eq.exam_id = e.id)::numeric AS total_points,
            (SELECT COUNT(*) FROM proctoring_events pe JOIN exam_attempts a ON a.id = pe.attempt_id WHERE a.exam_id = e.id AND pe.is_confirmed = TRUE)::int AS violation_count,
            eps.enabled AS proctoring_enabled
       FROM exams e
       JOIN classes c ON c.id = e.class_id
       LEFT JOIN exam_proctoring_settings eps ON eps.exam_id = e.id
      WHERE e.class_id = $1 ORDER BY e.start_time DESC`, [classId]);
    return rows.map((r) => ({ ...r, display_status: computeDisplayStatus(r) }));
}
async function getExamForTeacher(examId) {
    const exam = await (0, database_js_1.queryOne)('SELECT * FROM exams WHERE id = $1', [examId]);
    if (!exam)
        throw new http_error_js_1.HttpError(404, 'Không tìm thấy đề thi');
    const settingsRow = await (0, database_js_1.queryOne)('SELECT * FROM exam_proctoring_settings WHERE exam_id = $1', [examId]);
    const questions = await (0, database_js_1.query)(`SELECT id, source_bank_question_id, position, question_type, content, explanation, points
       FROM exam_questions WHERE exam_id = $1 ORDER BY position`, [examId]);
    const questionIds = questions.map((q) => q.id);
    const options = questionIds.length
        ? await (0, database_js_1.query)(`SELECT id, exam_question_id, content, is_correct, position FROM exam_question_options
          WHERE exam_question_id = ANY($1) ORDER BY position`, [questionIds])
        : [];
    return {
        ...exam, display_status: computeDisplayStatus(exam), proctoringSettings: settingsRow,
        questions: questions.map((q) => ({
            ...q, options: options.filter((o) => o.exam_question_id === q.id),
        })),
    };
}
async function getExamForStudent(examId) {
    const exam = await (0, database_js_1.queryOne)(`SELECT e.*, c.name AS class_name,
            (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id)::int AS total_questions,
            (SELECT COALESCE(SUM(eq.points), 0) FROM exam_questions eq WHERE eq.exam_id = e.id)::numeric AS total_points,
            eps.enabled AS proctoring_enabled
       FROM exams e
       JOIN classes c ON c.id = e.class_id
       LEFT JOIN exam_proctoring_settings eps ON eps.exam_id = e.id
      WHERE e.id = $1 AND e.status = 'published'`, [examId]);
    if (!exam)
        throw new http_error_js_1.HttpError(404, 'Không tìm thấy đề thi');
    return { ...exam, display_status: computeDisplayStatus(exam) };
}
// ===========================================================================
// CÂU HỎI TRONG ĐỀ
// ===========================================================================
async function addQuestionsFromBank(examId, bankQuestionIds) {
    await guardNotPublishedWithAttempts(examId);
    return (0, database_js_1.withTransaction)(async (client) => {
        const { rows: posRow } = await client.query(`SELECT COALESCE(MAX(position), 0) AS max_pos FROM exam_questions WHERE exam_id = $1`, [examId]);
        let position = posRow[0].max_pos;
        const created = [];
        for (const bankId of bankQuestionIds) {
            const { rows: bq } = await client.query('SELECT * FROM bank_questions WHERE id = $1', [bankId]);
            if (!bq[0])
                continue;
            position += 1;
            const { rows: eq } = await client.query(`INSERT INTO exam_questions
           (exam_id, source_bank_question_id, position, question_type, content, explanation, points)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [examId, bankId, position, bq[0].question_type, bq[0].content, bq[0].explanation, bq[0].default_points]);
            const examQuestionId = eq[0].id;
            const { rows: opts } = await client.query('SELECT content, is_correct, position FROM bank_question_options WHERE question_id = $1 ORDER BY position', [bankId]);
            await insertOptions(client, 'exam_question_options', 'exam_question_id', examQuestionId, opts.map((o) => ({
                content: o.content, isCorrect: o.is_correct,
            })));
            created.push(examQuestionId);
        }
        return created;
    });
}
async function addManualQuestion(examId, input) {
    await guardNotPublishedWithAttempts(examId);
    validateOptions(input.questionType, input.options);
    return (0, database_js_1.withTransaction)(async (client) => {
        const { rows: posRow } = await client.query(`SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM exam_questions WHERE exam_id = $1`, [examId]);
        const { rows } = await client.query(`INSERT INTO exam_questions (exam_id, position, question_type, content, explanation, points)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [examId, posRow[0].pos, input.questionType, input.content, input.explanation ?? null, input.points ?? 1]);
        await insertOptions(client, 'exam_question_options', 'exam_question_id', rows[0].id, input.options);
        return rows[0].id;
    });
}
async function reorderQuestions(examId, orderedQuestionIds) {
    await guardNotPublishedWithAttempts(examId);
    await (0, database_js_1.withTransaction)(async (client) => {
        for (let i = 0; i < orderedQuestionIds.length; i++) {
            await client.query('UPDATE exam_questions SET position = $1 WHERE id = $2 AND exam_id = $3', [i + 1, orderedQuestionIds[i], examId]);
        }
    });
}
async function removeExamQuestion(examId, examQuestionId) {
    await guardNotPublishedWithAttempts(examId);
    await (0, database_js_1.query)('DELETE FROM exam_questions WHERE id = $1 AND exam_id = $2', [examQuestionId, examId]);
}
async function guardNotPublishedWithAttempts(examId) {
    const hasAttempts = await (0, database_js_1.queryOne)('SELECT 1 FROM exam_attempts WHERE exam_id = $1 LIMIT 1', [examId]);
    if (hasAttempts)
        throw new http_error_js_1.HttpError(400, 'Không thể sửa câu hỏi khi đã có học sinh bắt đầu làm bài');
}
// ===========================================================================
// CẤU HÌNH GIÁM SÁT AI
// ===========================================================================
async function updateProctoringSettings(examId, input) {
    const resolved = (0, policy_js_1.resolveProctoringSettings)(input);
    await (0, database_js_1.query)(`UPDATE exam_proctoring_settings SET
       enabled=$2, verify_identity=$3, detect_identity_swap=$4, identity_recheck_interval_sec=$5,
       identity_threshold=$6, detect_no_face=$7, no_face_grace_sec=$8, detect_multiple_faces=$9,
       track_head_pose=$10, head_sensitivity=$11, head_yaw_threshold_deg=$12, head_pitch_threshold_deg=$13,
       head_min_duration_ms=$14, track_gaze=$15, gaze_sensitivity=$16, gaze_yaw_threshold_deg=$17,
       gaze_pitch_threshold_deg=$18, gaze_min_duration_ms=$19, detect_phone=$20, detect_document=$21,
       detect_secondary_screen=$22, detect_headphone=$23, detect_extra_person=$24, object_conf_threshold=$25,
       detect_tab_switch=$26, violation_action=$27, auto_submit_after_violations=$28,
       frame_interval_ms=$29, evidence_retention_days=$30, updated_at=NOW()
     WHERE exam_id=$1`, [examId, resolved.enabled, resolved.verifyIdentity, resolved.detectIdentitySwap,
        resolved.identityRecheckIntervalSec, resolved.identityThreshold, resolved.detectNoFace,
        resolved.noFaceGraceSec, resolved.detectMultipleFaces, resolved.trackHeadPose, resolved.headSensitivity,
        resolved.headYawThresholdDeg, resolved.headPitchThresholdDeg, resolved.headMinDurationMs,
        resolved.trackGaze, resolved.gazeSensitivity, resolved.gazeYawThresholdDeg, resolved.gazePitchThresholdDeg,
        resolved.gazeMinDurationMs, resolved.detectPhone, resolved.detectDocument, resolved.detectSecondaryScreen,
        resolved.detectHeadphone, resolved.detectExtraPerson, resolved.objectConfThreshold, resolved.detectTabSwitch,
        resolved.violationAction, resolved.autoSubmitAfterViolations, resolved.frameIntervalMs,
        resolved.evidenceRetentionDays]);
    return resolved;
}
/** Map dòng DB (snake_case) -> ProctoringSettings (camelCase) */
function mapSettingsRow(row) {
    if (!row)
        return policy_js_1.DEFAULT_SETTINGS;
    return {
        enabled: row.enabled, verifyIdentity: row.verify_identity, detectIdentitySwap: row.detect_identity_swap,
        identityRecheckIntervalSec: row.identity_recheck_interval_sec, identityThreshold: Number(row.identity_threshold),
        detectNoFace: row.detect_no_face, noFaceGraceSec: row.no_face_grace_sec, detectMultipleFaces: row.detect_multiple_faces,
        trackHeadPose: row.track_head_pose, headSensitivity: row.head_sensitivity, headYawThresholdDeg: row.head_yaw_threshold_deg,
        headPitchThresholdDeg: row.head_pitch_threshold_deg, headMinDurationMs: row.head_min_duration_ms,
        trackGaze: row.track_gaze, gazeSensitivity: row.gaze_sensitivity, gazeYawThresholdDeg: row.gaze_yaw_threshold_deg,
        gazePitchThresholdDeg: row.gaze_pitch_threshold_deg, gazeMinDurationMs: row.gaze_min_duration_ms,
        detectPhone: row.detect_phone, detectDocument: row.detect_document, detectSecondaryScreen: row.detect_secondary_screen,
        detectHeadphone: row.detect_headphone, detectExtraPerson: row.detect_extra_person,
        objectConfThreshold: Number(row.object_conf_threshold), detectTabSwitch: row.detect_tab_switch,
        violationAction: row.violation_action, autoSubmitAfterViolations: row.auto_submit_after_violations,
        frameIntervalMs: row.frame_interval_ms, evidenceRetentionDays: row.evidence_retention_days,
    };
}
//# sourceMappingURL=exam.service.js.map