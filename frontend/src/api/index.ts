import api from './axios';
import type { AuthPayload, ClassInfo, Exercise, Meeting, Doc, Student, SubmittedFile, ClassAttachFile, DocCategoryRaw } from '../types';

// ── Auth ──────────────────────────────────────────────────────
export const authApi = {
  login: (loginId: string, password: string) =>
    api.post<{ success: boolean; data: { accessToken: string; user: AuthPayload } }>('/auth/login', { loginId, password }),
  signup: (name: string, loginId: string, password: string) =>
    api.post('/auth/signup', { name, loginId, password }),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get<{ success: boolean; data: { user: AuthPayload } }>('/auth/me'),
};

// ── Classes ───────────────────────────────────────────────────
export const classApi = {
  getAll: () => api.get<{ success: boolean; data: ClassInfo[] }>('/classes'),
  getById: (id: number) => api.get<{ success: boolean; data: ClassInfo }>(`/classes/${id}`),
  create: (name: string) => api.post('/classes', { name }),
  updateName: (id: number, name: string) => api.put(`/classes/${id}/name`, { name }),
  toggleInvite: (id: number, isOpen: boolean) => api.put(`/classes/${id}/invite-status`, { isOpen }),
  join: (inviteCode: string) => api.post('/classes/join', { inviteCode }),

  // Students
  getStudents: (id: number) => api.get<{ success: boolean; data: Student[] }>(`/classes/${id}/students`),
  removeStudent: (classId: number, studentId: number) =>
    api.delete(`/classes/${classId}/students/${studentId}`),
  importStudents: (id: number, formData: FormData) =>
    api.post(`/classes/${id}/students/import`, formData, { responseType: 'blob' }),

  // Attach files
  getAttachFiles: (id: number) =>
    api.get<{ success: boolean; data: ClassAttachFile[] }>(`/classes/${id}/attach-files`),
  attachFile: (id: number, docId: number) => api.post(`/classes/${id}/attach-files`, { docId }),
  removeAttachFile: (id: number, docId: number) =>
    api.delete(`/classes/${id}/attach-files`, { data: { docId } }),
};

// ── Exercises ─────────────────────────────────────────────────
export const exerciseApi = {
  getByClass: (classId: number) =>
    api.get<{ success: boolean; data: Exercise[] }>(`/exercises/class/${classId}`),

  create: (data: {
    classId: number;
    name: string;
    description: string;
    startTime: string;
    endTime: string;
    attachFileIds: number[];
  }) =>
    api.post('/exercises', {
      ...data,
      attachFileIds: JSON.stringify(data.attachFileIds),
    }),

  update: (id: number, data: {
    name: string;
    description: string;
    startTime: string;
    endTime: string;
    attachFileIds: number[];
  }) =>
    api.put(`/exercises/${id}`, {
      ...data,
      attachFileIds: JSON.stringify(data.attachFileIds),
    }),

  delete: (id: number) => api.delete(`/exercises/${id}`),
  getForLecturer: (id: number) => api.get<{ success: boolean; data: Exercise }>(`/exercises/${id}`),

  // Submissions (lecturer)
  getSubmissionStatus: (classId: number, exerciseId: number) =>
    api.get<{ success: boolean; data: { login_id: string; student_name: string; submission_status: string }[] }>(`/exercises/class/${classId}/submissions/${exerciseId}`),
  downloadSubmissions: (classId: number, exerciseId: number) =>
    api.get(`/exercises/class/${classId}/submissions/${exerciseId}/download`, { responseType: 'blob' }),

  // Submissions (student)
  submit: (exerciseId: number, files: FileList | File[]) => {
    const formData = new FormData();
    formData.append('exerciseId', String(exerciseId));
    Array.from(files).forEach((f) => formData.append('files', f));
    return api.post(`/exercises/${exerciseId}/submit`, formData);
  },
  unsubmit: (exerciseId: number) => api.delete(`/exercises/${exerciseId}/submit`, { data: { exerciseId } }),
  getSubmittedFiles: (exerciseId: number) =>
    api.get<{ success: boolean; data: SubmittedFile[] }>(`/exercises/${exerciseId}/submit`),
  deleteSubmittedFile: (exerciseId: number, fileId: number, fileName: string) =>
    api.delete(`/exercises/${exerciseId}/submit/file`, { data: { fileId, exerciseId, fileName } }),
};

// ── Documents ─────────────────────────────────────────────────
export const documentApi = {
  getAll: () => api.get<{ success: boolean; data: DocCategoryRaw[] }>('/documents'),
  createCategory: (name: string) => api.post('/documents/categories', { name }),
  updateCategory: (id: number, name: string) => api.put(`/documents/categories/${id}`, { name }),
  deleteCategory: (id: number) => api.delete(`/documents/categories/${id}`),
  getDocsByCategory: (id: number) => api.get<{ success: boolean; data: Doc[] }>(`/documents/categories/${id}/docs`),
  upload: (docCategoryId: number, files: FileList | File[]) => {
    const formData = new FormData();
    formData.append('docCategoryId', String(docCategoryId));
    Array.from(files).forEach((f) => formData.append('files', f));
    return api.post('/documents/upload', formData);
  },
  deleteDoc: (id: number, fileName: string) =>
    api.delete(`/documents/${id}`, { data: { fileName } }),
};

// ── Meetings ──────────────────────────────────────────────────
export const meetingApi = {
  getByClass: (classId: number) =>
    api.get<{ success: boolean; data: Meeting[] }>(`/meetings/class/${classId}`),
  getById: (id: number) => api.get<{ success: boolean; data: Meeting }>(`/meetings/${id}`),
  getByCode: (code: string) => api.get<{ success: boolean; data: Meeting }>(`/meetings/code/${code}`),
  create: (data: {
    classId: number;
    name: string;
    description: string;
    startTime: string;
    endTime: string;
  }) => api.post('/meetings', data),
  update: (id: number, data: {
    name: string;
    description: string;
    startTime: string;
    endTime: string;
  }) => api.put(`/meetings/${id}`, data),
  delete: (id: number) => api.delete(`/meetings/${id}`),
};

// ── Question Bank ─────────────────────────────────────────────
export const questionBankApi = {
  list: (classId: number, params?: { chapter?: string; difficulty?: string; type?: string }) =>
    api.get<{ success: boolean; data: import('../types').BankQuestion[] }>(`/classes/${classId}/question-bank`, { params }),
  create: (classId: number, data: Partial<import('../types').BankQuestion> & {
    questionType?: import('../types').BankQuestion['question_type'];
    defaultPoints?: number;
  }) =>
    api.post<{ success: boolean; data: import('../types').BankQuestion }>(`/classes/${classId}/question-bank`, data),
  update: (id: number, data: Partial<import('../types').BankQuestion>) =>
    api.put<{ success: boolean; data: import('../types').BankQuestion }>(`/question-bank/${id}`, data),
  delete: (id: number) => api.delete(`/question-bank/${id}`),
};

// ── Exam & Proctoring (Lecturer) ──────────────────────────────
export const BACKEND_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace(/\/api\/?$/, '');

export const examApi = {
  listForClass: (classId: number | string) =>
    api.get<{ success: boolean; data: { exams: import('../types').Exam[] } | import('../types').Exam[]; exams?: import('../types').Exam[] }>(`/classes/${classId}/exams`),
  getByClass: (classId: number | string) =>
    api.get<{ success: boolean; data: { exams: import('../types').Exam[] }; exams: import('../types').Exam[] }>(`/classes/${classId}/exams`),
  getById: (examId: number | string) =>
    api.get<{ success: boolean; data: { exam: import('../types').Exam } | import('../types').Exam; exam?: import('../types').Exam }>(`/exams/${examId}`),
  create: (dataOrClassId: any, maybeData?: any) => {
    if (typeof dataOrClassId === 'number' || (typeof dataOrClassId === 'string' && maybeData)) {
      return api.post<{ success: boolean; data: import('../types').Exam }>(`/classes/${dataOrClassId}/exams`, maybeData);
    }
    const classId = dataOrClassId.class_id;
    return api.post<{ success: boolean; data: import('../types').Exam }>(`/classes/${classId}/exams`, dataOrClassId);
  },
  update: (examId: number | string, data: Partial<import('../types').Exam>) =>
    api.put<{ success: boolean; data: import('../types').Exam }>(`/exams/${examId}`, data),
  publish: (examId: number | string) =>
    api.post<{ success: boolean; data: import('../types').Exam }>(`/exams/${examId}/publish`),
  close: (examId: number | string) =>
    api.post<{ success: boolean; data: import('../types').Exam }>(`/exams/${examId}/close`),
  delete: (examId: number | string) => api.delete(`/exams/${examId}`),
  updateProctoringSettings: (examId: number | string, settings: Partial<import('../types').ProctoringSettings>) =>
    api.put<{ success: boolean; data: import('../types').ProctoringSettings }>(
      `/exams/${examId}/proctoring-settings`,
      {
        enabled: settings.enabled,
        verifyIdentity: settings.verify_identity ?? settings.face_recognition_enabled ?? settings.verifyIdentity,
        detectIdentitySwap: settings.detect_identity_swap ?? settings.detectIdentitySwap,
        identityRecheckIntervalSec: settings.identity_recheck_interval_sec ?? settings.identityRecheckIntervalSec,
        identityThreshold: settings.identity_threshold ?? settings.identityThreshold,
        detectNoFace: settings.detect_no_face ?? settings.detectNoFace,
        noFaceGraceSec: settings.no_face_grace_sec ?? settings.noFaceGraceSec,
        detectMultipleFaces: settings.multiple_faces_enabled ?? settings.detectMultipleFaces,
        trackHeadPose: settings.head_pose_enabled ?? settings.trackHeadPose,
        headSensitivity: settings.head_sensitivity ?? settings.headSensitivity,
        headYawThresholdDeg: settings.head_yaw_threshold_deg ?? settings.headYawThresholdDeg,
        headPitchThresholdDeg: settings.head_pitch_threshold_deg ?? settings.headPitchThresholdDeg,
        headMinDurationMs: settings.head_min_duration_ms ?? settings.headMinDurationMs,
        trackGaze: settings.gaze_tracking_enabled ?? settings.trackGaze,
        gazeSensitivity: settings.gaze_sensitivity ?? settings.gazeSensitivity,
        gazeYawThresholdDeg: settings.gaze_yaw_threshold_deg ?? settings.gazeYawThresholdDeg,
        gazePitchThresholdDeg: settings.gaze_pitch_threshold_deg ?? settings.gazePitchThresholdDeg,
        gazeMinDurationMs: settings.gaze_min_duration_ms ?? settings.gazeMinDurationMs,
        detectPhone: settings.detect_phone ?? settings.detectPhone,
        detectDocument: settings.detect_document ?? settings.detectDocument,
        detectSecondaryScreen: settings.detect_secondary_screen ?? settings.detectSecondaryScreen,
        detectHeadphone: settings.detect_headphone ?? settings.detectHeadphone,
        detectExtraPerson: settings.detect_extra_person ?? settings.detectExtraPerson,
        objectConfThreshold: settings.object_conf_threshold ?? settings.objectConfThreshold,
        detectTabSwitch: settings.tab_switch_enabled ?? settings.detectTabSwitch,
        violationAction: settings.violation_action ?? settings.violationAction,
        autoSubmitAfterViolations: settings.auto_submit_after_violations ?? settings.autoSubmitAfterViolations,
        frameIntervalMs: settings.frame_interval_ms ?? settings.frameIntervalMs,
        evidenceRetentionDays: settings.evidence_retention_days ?? settings.evidenceRetentionDays,
      },
    ),
  getPresets: () => api.get<{ success: boolean; data: Record<string, any> }>('/proctoring-presets'),
  getAiStatus: () => api.get<{ success: boolean; data: { readiness: any; ingestion: any } }>('/proctoring/ai-status'),
  testProctoringFrame: (frameBlob: Blob, trackGaze = false) => {
    const formData = new FormData();
    formData.append('frame', frameBlob, 'test.jpg');
    formData.append('trackGaze', String(trackGaze));
    return api.post<{ success: boolean; data: any }>('/proctoring/test-frame', formData);
  },

  // Exam Questions
  addFromBank: (examId: number | string, bankQuestionIds: (number | string)[]) =>
    api.post(`/exams/${examId}/questions/from-bank`, { bankQuestionIds }),
  addManualQuestion: (examId: number | string, data: any) =>
    api.post(`/exams/${examId}/questions`, data),
  reorderQuestions: (examId: number | string, orderedQuestionIds: (number | string)[]) =>
    api.put(`/exams/${examId}/questions/reorder`, { orderedQuestionIds }),
  removeQuestion: (examId: number | string, questionId: number | string) =>
    api.delete(`/exams/${examId}/questions/${questionId}`),

  // Live Monitor & Violations
  getLiveGrid: (examId: number | string) =>
    api.get<{ success: boolean; data: any }>(`/exams/${examId}/monitor/live`),
  getLiveMonitor: (examId: number | string) =>
    api.get<{ success: boolean; data: any }>(`/exams/${examId}/monitor/live`),
  broadcastMonitorNotice: (examId: number | string, message: string) =>
    api.post<{ success: boolean; data: any }>(`/exams/${examId}/monitor/broadcast`, { message }),
  warnCandidate: (attemptId: number | string, message: string) =>
    api.post<{ success: boolean; data: any }>(`/attempts/${attemptId}/monitor/warn`, { message }),
  forceSubmitAttempt: (attemptId: number | string, reason?: string) =>
    api.post<{ success: boolean; data: any }>(`/attempts/${attemptId}/force-submit`, { reason }),
  fetchLiveSnapshotBlob: (attemptId: number | string) =>
    api.get<Blob>(`/attempts/${attemptId}/live-snapshot`, { responseType: 'blob' }),
  fetchEvidenceBlob: (attemptId: number | string, evidenceId: number | string) =>
    api.get<Blob>(`/attempts/${attemptId}/evidence/${evidenceId}`, { responseType: 'blob' }),
  getViolations: (examId: number | string, onlyFlagged = false) =>
    api.get<{ success: boolean; data: { exam: any; violations: any[]; analytics: any } }>(`/exams/${examId}/violations`, { params: { onlyFlagged } }),
  getBehaviorStats: (attemptId: number | string) =>
    api.get<{ success: boolean; data: import('../types').BehaviorStat[] }>(`/attempts/${attemptId}/behavior-stats`),
  getTimeline: (attemptId: number | string) =>
    api.get<{ success: boolean; data: any[] }>(`/attempts/${attemptId}/timeline`),
  reviewEvent: (eventId: number | string, status: string, note?: string) =>
    api.put(`/proctoring-events/${eventId}/review`, { status, note }),
  reviewAttempt: (attemptId: number | string, verdict: string, note?: string) =>
    api.put(`/attempts/${attemptId}/review`, { verdict, note }),

  // Grading
  listGrading: (examId: number | string) =>
    api.get<{ success: boolean; data: { exam: any; submissions: any[] } }>(`/exams/${examId}/grading`),
  getSubmissions: (examId: number | string) =>
    api.get<{ success: boolean; data: { exam: any; submissions: any[] } }>(`/exams/${examId}/grading`),
  getGradingAttempt: (attemptId: number | string) =>
    api.get<{ success: boolean; data: { answers: any[]; audit_logs?: any[]; [k: string]: any } }>(`/attempts/${attemptId}/grading`),
  getAttemptReview: (attemptId: number | string) =>
    api.get<{ success: boolean; data: { answers: any[]; audit_logs?: any[]; [k: string]: any } }>(`/attempts/${attemptId}/grading`),
  gradeEssay: (attemptId: number | string, questionId: number | string, score: number, comment?: string) =>
    api.put(`/attempts/${attemptId}/grading/${questionId}`, { score, comment }),
  gradeAttempt: (attemptId: number | string, payload: any) =>
    api.put(`/attempts/${attemptId}/grading`, payload),
};

// ── Student Exam Taking & Proctoring ──────────────────────────
export const studentExamApi = {
  getExam: (examId: number | string) =>
    api.get<{
      success: boolean;
      data: {
        exam: import('../types').Exam & { verify_identity?: boolean; detect_identity_swap?: boolean };
        student: { name: string; login_id: string };
      };
    }>(`/exams/${examId}/student`),
  listExams: (classId: number | string) =>
    api.get<{ success: boolean; data: { exams: import('../types').Exam[] } | import('../types').Exam[]; exams?: import('../types').Exam[] }>(`/classes/${classId}/exams/student`),
  getAvailable: (classId: number | string) =>
    api.get<{ success: boolean; data: { exams: import('../types').Exam[] } | import('../types').Exam[]; exams?: import('../types').Exam[] }>(`/classes/${classId}/exams/student`),
  precheck: (examId: number | string, imageBlob: Blob) => {
    const formData = new FormData();
    formData.append('image', imageBlob, 'precheck.jpg');
    return api.post<{ success: boolean; data: { precheckId: string; expiresAt: string } }>(`/exams/${examId}/precheck`, formData);
  },
  startAttempt: (examId: number | string, precheckId?: string) =>
    api.post<{ success: boolean; data: import('../types').ExamAttempt & { attempt?: import('../types').ExamAttempt } }>(`/exams/${examId}/attempts`, { precheckId }),
  getAttempt: (attemptId: number | string) =>
    api.get<{ success: boolean; data: import('../types').ExamAttempt & { [k: string]: any } }>(`/attempts/${attemptId}`),
  saveAnswer: (attemptId: number | string, questionIdOrData: any, maybeData?: any) => {
    if (typeof questionIdOrData === 'object') {
      const payload = questionIdOrData;
      const answerPayload: {
        selectedOptionIds?: number[];
        textAnswer?: string;
        isFlagged?: boolean;
      } = {};
      if (payload.selected_option_ids !== undefined) {
        answerPayload.selectedOptionIds = payload.selected_option_ids;
      }
      if (payload.answer_text !== undefined) {
        answerPayload.textAnswer = payload.answer_text;
      }
      if (payload.is_flagged !== undefined) {
        answerPayload.isFlagged = payload.is_flagged;
      }
      return api.put(`/attempts/${attemptId}/answers/${payload.question_id}`, answerPayload);
    }
    return api.put(`/attempts/${attemptId}/answers/${questionIdOrData}`, maybeData);
  },
  submitAttempt: (attemptId: number | string) =>
    api.post<{ success: boolean; data: import('../types').ExamAttempt }>(`/attempts/${attemptId}/submit`),
  reportBrowserEvent: (
    attemptId: number | string,
    eventType: 'tab_hidden' | 'window_blur' | 'fullscreen_exit' | 'camera_lost',
    active = true,
  ) => api.post<{ success: boolean; data: any }>(`/attempts/${attemptId}/events`, { eventType, active }),
  sendFrame: (attemptId: number | string, frameBlob: Blob) => {
    const formData = new FormData();
    formData.append('frame', frameBlob, 'frame.jpg');
    return api.post<{ success: boolean; data: { warnings: any[]; shouldAutoSubmit: boolean } }>(`/attempts/${attemptId}/frames`, formData);
  },
  sendTelemetryFrame: (attemptId: number | string, formData: FormData) =>
    api.post<{ success: boolean; data: any }>(`/attempts/${attemptId}/frames`, formData),
};
