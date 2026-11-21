// Shared TypeScript types for frontend
// Mirroring backend types

export interface AuthPayload {
  userId: number;
  name: string;
  isLecturer: boolean;
  loginId?: string;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthPayload;
}

export interface ClassInfo {
  id: number;
  name: string;
  lecturer_id: number;
  lecturer_name?: string;
  invite_code_students: string;
  is_open_students: boolean;
  member_count?: number;
}

export interface DocCategory {
  id: number;
  name: string;
  lecturer_id: number;
}

export interface Doc {
  id: number;
  file_name: string;
  doc_category_id: number;
  category_name?: string;
}

export interface DocCategoryWithDocs extends DocCategory {
  docs: Doc[];
}

export interface Exercise {
  id: number;
  class_id: number;
  start_time: string;
  end_time: string;
  name: string;
  description: string | null;
  submission_count?: number;
  submission_status?: 'not_submitted' | 'in_progress' | 'submitted';
  attachFiles?: { exercise_id: number; doc_id: number; file_name: string }[];
}

export interface Meeting {
  id: number;
  class_id: number;
  start_time: string;
  end_time: string;
  name: string;
  description: string | null;
  meeting_code: string;
  status: 'not-started' | 'started' | 'ended';
}

export interface Student {
  id: number;
  name: string;
  login_id: string;
  submission_status?: string;
}

export interface SubmittedFile {
  id: number;
  submitted_exercises_id: number;
  file_name: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

export interface ClassAttachFile {
  class_id: number;
  doc_id: number;
  file_name: string;
  category_name: string;
}

export interface DocCategoryRaw {
  doc_category_id: number;
  category_name: string;
  doc_id: number | null;
  file_name: string | null;
}

export type UserRole = 'lecturer' | 'student';

// ── Exam & Proctoring Module Types ───────────────────────────
export interface BankQuestionOption {
  id?: number;
  question_id?: number;
  content: string;
  is_correct: boolean;
  position?: number;
}

export interface BankQuestion {
  id: number;
  class_id?: number;
  created_by?: number;
  creator_name?: string;
  used_in_exams_count?: number;
  question_type: 'single_choice' | 'multiple_choice' | 'essay' | 'file_upload';
  content: string;
  explanation?: string;
  default_points: number | string;
  difficulty: 'easy' | 'medium' | 'hard';
  chapter?: string;
  tags?: string[];
  source?: 'manual' | 'import' | 'ai';
  ai_draft_id?: number | null;
  source_doc_ids?: number[];
  created_at: string;
  updated_at?: string;
  options?: BankQuestionOption[];
}

export interface ExamQuestionOption {
  id: number;
  exam_question_id: number;
  content: string;
  is_correct?: boolean;
  position: number;
}

export interface ExamQuestion {
  id: number;
  exam_id: number;
  source_bank_question_id?: number;
  position: number;
  question_type: 'single_choice' | 'multiple_choice' | 'essay' | 'file_upload';
  content: string;
  explanation?: string;
  points: number | string;
  options: ExamQuestionOption[];
  answer?: AttemptAnswer | null;
  indexNumber?: number;
}

export interface ProctoringSettings {
  exam_id?: number;
  enabled: boolean;
  verify_identity?: boolean;
  face_recognition_enabled?: boolean;
  head_pose_enabled?: boolean;
  gaze_tracking_enabled?: boolean;
  object_detection_enabled?: boolean;
  multiple_faces_enabled?: boolean;
  tab_switch_enabled?: boolean;
  fullscreen_required?: boolean;
  behavior_preset?: 'relaxed' | 'balanced' | 'strict' | 'custom' | string;
  strictness_level?: 'low' | 'medium' | 'high' | string;
  max_violations_before_lock?: number;
  auto_submit_on_lock?: boolean;
  sign_calibration_required?: boolean;
  custom_thresholds?: any;
  detect_identity_swap?: boolean;
  identity_recheck_interval_sec?: number;
  identity_threshold?: number;
  detect_no_face?: boolean;
  no_face_grace_sec?: number;
  track_head_pose?: boolean;
  head_sensitivity?: 'relaxed' | 'normal' | 'strict' | 'custom' | string;
  head_yaw_threshold_deg?: number;
  head_pitch_threshold_deg?: number;
  head_min_duration_ms?: number;
  track_gaze?: boolean;
  gaze_sensitivity?: 'relaxed' | 'normal' | 'strict' | 'custom' | string;
  gaze_yaw_threshold_deg?: number;
  gaze_pitch_threshold_deg?: number;
  gaze_min_duration_ms?: number;
  detect_phone?: boolean;
  detect_document?: boolean;
  detect_secondary_screen?: boolean;
  detect_headphone?: boolean;
  detect_extra_person?: boolean;
  object_conf_threshold?: number;
  detect_tab_switch?: boolean;
  violation_action?: 'log_only' | 'warn_and_log' | 'auto_submit' | string;
  auto_submit_after_violations?: number;
  frame_interval_ms?: number;
  evidence_retention_days?: number;
  [key: string]: any;
}

export interface Exam {
  id: number | string;
  class_id?: number | string;
  class_name?: string;
  created_by?: number;
  name?: string;
  title?: string;
  description?: string;
  status: 'draft' | 'published';
  display_status?: 'draft' | 'scheduled' | 'open' | 'closed';
  start_time: string;
  end_time: string;
  duration_minutes: number;
  max_attempts?: number;
  passing_percentage?: number;
  shuffle_questions?: boolean;
  shuffle_options?: boolean;
  result_visibility?: 'immediately' | 'after_close' | 'hidden';
  allow_review?: boolean;
  created_at?: string;
  updated_at?: string;
  questions?: ExamQuestion[];
  proctoringSettings?: ProctoringSettings;
  proctoring_settings?: ProctoringSettings;
  submitted_count?: number;
  submissions_count?: number;
  in_progress_count?: number;
  total_students?: number;
  total_questions?: number;
  total_points?: number;
  violation_count?: number;
  proctoring_enabled?: boolean;
  myAttempts?: ExamAttempt[];
  my_attempt?: ExamAttempt;
  student_name?: string;
  login_id?: string;
}

export interface ExamAttempt {
  id: number;
  exam_id: number;
  student_id: number;
  student_name?: string;
  login_id?: string;
  attempt_no: number;
  status: 'in_progress' | 'submitted' | 'graded' | 'auto_submitted' | 'locked' | string;
  submit_reason?: 'manual' | 'time_up' | 'proctoring' | 'lecturer';
  started_at: string;
  deadline_at: string;
  submitted_at?: string;
  updated_at?: string;
  duration_seconds?: number;
  question_order?: number[];
  option_order?: Record<string, number[]>;
  total_score?: number | string | null;
  final_score?: number | string | null;
  max_score?: number | string | null;
  grading_status?: 'pending' | 'needs_manual' | 'graded' | string;
  graded_at?: string;
  review_verdict?: 'unreviewed' | 'clean' | 'suspected' | 'confirmed_cheating' | string;
  review_note?: string;
  remainingSeconds?: number;
  questions?: ExamQuestion[];
  exam?: Partial<Exam>;
  proctoringSettings?: ProctoringSettings;
  proctoring_flags?: any;
  violation_count?: number | null;
  resultVisible?: boolean;
  resultVisibilityReason?: string | null;
  correct_count?: number | null;
  competencies?: Array<{ chapter: string; percentage: number; label: string }>;
}

export interface AttemptAnswer {
  id?: number;
  attempt_id: number;
  exam_question_id: number;
  selected_option_ids: number[];
  text_answer?: string | null;
  file_path?: string | null;
  is_flagged: boolean;
  answered_at?: string;
  is_correct?: boolean | null;
  score?: number | string | null;
  grader_comment?: string | null;
}

export interface ProctoringEvent {
  id: number;
  attempt_id: number;
  student_id?: number;
  student_name?: string;
  event_type: string;
  severity: 'info' | 'warning' | 'critical';
  started_at: string;
  last_seen_at?: string;
  ended_at?: string | null;
  sample_count?: number;
  peak_value?: number;
  is_confirmed: boolean;
  review_status: 'pending' | 'confirmed_cheating' | 'dismissed';
  review_note?: string;
  duration_ms?: number;
  evidence_id?: number;
}

export interface BehaviorStat {
  type: string;
  messageVi: string;
  count: number;
  totalDurationSec: number;
}

// ── Face Profile & Meeting Attendance Types ──────────────────
export type FaceReviewStatus = 'unregistered' | 'pending' | 'approved' | 'rejected';

export interface FaceProfileMe {
  enrolled: boolean;
  reviewStatus: FaceReviewStatus;
  hasUsableApprovedProfile: boolean;
  usingPreviousApproved: boolean;
  needsReEnroll: boolean;
  sidebarDotColor: 'green' | 'yellow' | 'red';
  sampleCount: number;
  modelVersion: string | null;
  consentedAt: string | null;
  reviewedAt: string | null;
  reviewerName: string | null;
  rejectReason: string | null;
  enrollmentCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  photos: Array<{
    stepNo: number;
    faceScore: number | null;
    createdAt: string;
  }>;
  aiState: 'ready' | 'not_ready' | 'unreachable';
}

export interface ClassFaceProfileItem {
  studentId: number;
  studentName: string;
  loginId: string;
  status: FaceReviewStatus;
  sampleCount: number;
  modelVersion: string | null;
  consentedAt: string | null;
  reviewedBy: number | null;
  reviewerName: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  enrollmentCount: number;
  hasPreviousApproved: boolean;
  photoSteps: number[];
  updatedAt: string | null;
}

export interface ClassFaceProfileSummary {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  unregistered: number;
}

export type AttendanceStatus =
  | 'pending'
  | 'present'
  | 'mismatch'
  | 'absent'
  | 'no_profile'
  | 'manual';

export interface AttendanceRecord {
  id: number;
  sessionId: number;
  roundNo: number;
  studentId: number;
  studentName: string;
  loginId: string;
  status: AttendanceStatus;
  effectiveStatus: 'present' | 'pending' | 'mismatch' | 'absent' | 'no_profile';
  subStatus: string | null;
  similarity: number | null;
  faceCount: number | null;
  attempts: number;
  hasEvidence: boolean;
  checkedAt: string | null;
  overrideBy: number | null;
  overrideByName: string | null;
  overrideAt: string | null;
  overrideReason: string | null;
  roundsPassed: number;
  totalRounds: number;
  periodicOverall: 'present' | 'partial' | 'mismatch' | 'absent' | 'no_profile' | 'pending';
  roundHistory: Array<{
    roundNo: number;
    status: string;
    effectiveStatus: string;
    similarity: number | null;
    checkedAt: string | null;
  }>;
}

export interface AttendanceSession {
  id: number;
  meetingCode: string;
  classId: number;
  className: string;
  startedBy: number;
  startedByName: string | null;
  mode: 'once' | 'periodic';
  strictness: 'relaxed' | 'balanced' | 'strict';
  windowSec: number;
  threshold: number;
  intervalMin: number | null;
  maxRounds: number | null;
  currentRound: number;
  roundOpen: boolean;
  roundEndsAt: string;
  nextRoundAt: string | null;
  passRatio: number;
  duplicateWarnings: Array<{
    studentAId: number;
    studentAName: string;
    studentBId: number;
    studentBName: string;
    similarity: number;
  }>;
  startedAt: string;
  endedAt: string | null;
  aiState: 'ready' | 'not_ready' | 'unreachable';
  summary: {
    total: number;
    present: number;
    pending: number;
    mismatch: number;
    absent: number;
    noProfile: number;
    pendingReviewProfile: number;
    manual: number;
    partialPeriodic: number;
  };
  records: AttendanceRecord[];
}

// ── RAG Chat & AI Question Generation Types ──────────────────
export interface DocIngestionStatus {
  docId: number;
  fileName: string;
  displayFileName: string;
  categoryName: string;
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'unsupported';
  errorCode: string | null;
  errorMessage: string | null;
  pageCount: number | null;
  charCount: number | null;
  chunkCount: number;
  updatedAt: string | null;
  headings: string[];
}

export interface RagCitation {
  n: number;
  chunkId: number;
  docId: number;
  fileName: string;
  displayFileName: string;
  pageFrom: number | null;
  pageTo: number | null;
  heading: string | null;
  snippet: string;
}

export interface RagConversation {
  id: number;
  classId: number;
  userId?: number;
  title: string;
  docScope: number[] | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface RagMessage {
  id: number;
  conversationId: number;
  role: 'user' | 'assistant';
  content: string;
  citations: RagCitation[];
  grounded: boolean;
  latencyMs?: number | null;
  feedback?: -1 | 1 | null;
  createdAt: string;
  streaming?: boolean;
}

export type AiQuestionType = 'single_choice' | 'multiple_choice' | 'essay';
export type AiDifficulty = 'easy' | 'medium' | 'hard';

export interface AiDraftOption {
  content: string;
  isCorrect: boolean;
}

export interface AiQuestionDraft {
  id: number;
  jobId: number;
  classId: number;
  questionType: AiQuestionType;
  difficulty: AiDifficulty;
  content: string;
  options: AiDraftOption[];
  explanation: string | null;
  chapter: string | null;
  tags: string[];
  defaultPoints: number;
  sourceChunkIds: number[];
  sourceDocId: number | null;
  sourceFileName: string | null;
  sourcePageFrom: number | null;
  sourcePageTo: number | null;
  sourceQuote: string | null;
  qualityFlags: string[];
  duplicateOf: number | null;
  duplicateContent: string | null;
  verifyNote: string | null;
  status: 'draft' | 'accepted' | 'discarded';
  bankQuestionId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiGenerationJob {
  id: number;
  classId: number;
  lecturerId?: number;
  docIds?: number[];
  config: any;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress: number;
  errorMessage: string | null;
  tokensIn?: number;
  tokensOut?: number;
  createdAt: string;
  finishedAt: string | null;
  drafts?: AiQuestionDraft[];
  totalDrafts?: number;
  pendingDrafts?: number;
  acceptedDrafts?: number;
}


