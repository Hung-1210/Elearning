import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  FiArrowLeft,
  FiArrowRight,
  FiCheck,
  FiSave,
  FiPlus,
  FiTrash2,
  FiSearch,
  FiVideo,
  FiVideoOff,
  FiCamera,
  FiShield,
  FiClock,
  FiCalendar,
  FiFileText,
  FiLayers,
  FiEdit,
  FiCopy,
  FiEye,
  FiCheckCircle,
  FiSmartphone,
  FiAlertTriangle,
} from 'react-icons/fi';
import { examApi, questionBankApi, classApi } from '../../api';
import type { BankQuestion, ProctoringSettings, ClassInfo } from '../../types';
import Sidebar from '../../components/layout/Sidebar';
import { useLayoutStore } from '../../store/layoutStore';
import './exam.css';

interface WizardQuestion {
  id?: string | number;
  bank_question_id?: number | null;
  chapter?: string;
  explanation?: string;
  content: string;
  type: 'single_choice' | 'multiple_choice' | 'essay' | 'file_upload' | 'code' | string;
  difficulty: 'easy' | 'medium' | 'hard' | string;
  points: number;
  options: {
    id?: string | number;
    content: string;
    is_correct: boolean;
    order_index: number;
  }[];
}

const toLocalDatetimeInput = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
};

const PRESET_CONFIGS: Record<'relaxed' | 'balanced' | 'strict', Partial<ProctoringSettings>> = {
  relaxed: {
    behavior_preset: 'relaxed',
    face_recognition_enabled: true,
    detect_identity_swap: false,
    detect_no_face: true,
    no_face_grace_sec: 10,
    multiple_faces_enabled: true,
    head_pose_enabled: true,
    head_sensitivity: 'relaxed',
    head_yaw_threshold_deg: 45,
    head_pitch_threshold_deg: 30,
    gaze_tracking_enabled: false,
    gaze_sensitivity: 'relaxed',
    gaze_yaw_threshold_deg: 26,
    gaze_pitch_threshold_deg: 30,
    detect_phone: true,
    detect_document: false,
    detect_secondary_screen: false,
    detect_headphone: false,
    detect_extra_person: false,
    tab_switch_enabled: false,
    violation_action: 'log_only',
    auto_submit_after_violations: 5,
    frame_interval_ms: 3000,
  },
  balanced: {
    behavior_preset: 'balanced',
    face_recognition_enabled: true,
    detect_identity_swap: true,
    identity_recheck_interval_sec: 300,
    detect_no_face: true,
    no_face_grace_sec: 8,
    multiple_faces_enabled: true,
    head_pose_enabled: true,
    head_sensitivity: 'normal',
    head_yaw_threshold_deg: 35,
    head_pitch_threshold_deg: 25,
    gaze_tracking_enabled: false,
    gaze_sensitivity: 'normal',
    gaze_yaw_threshold_deg: 20,
    gaze_pitch_threshold_deg: 26,
    detect_phone: true,
    detect_document: true,
    detect_secondary_screen: false,
    detect_headphone: false,
    detect_extra_person: false,
    tab_switch_enabled: true,
    violation_action: 'warn_and_log',
    auto_submit_after_violations: 5,
    frame_interval_ms: 2000,
  },
  strict: {
    behavior_preset: 'strict',
    face_recognition_enabled: true,
    detect_identity_swap: true,
    identity_recheck_interval_sec: 60,
    detect_no_face: true,
    no_face_grace_sec: 5,
    multiple_faces_enabled: true,
    head_pose_enabled: true,
    head_sensitivity: 'strict',
    head_yaw_threshold_deg: 25,
    head_pitch_threshold_deg: 18,
    gaze_tracking_enabled: true,
    gaze_sensitivity: 'strict',
    gaze_yaw_threshold_deg: 16,
    gaze_pitch_threshold_deg: 22,
    detect_phone: true,
    detect_document: true,
    detect_secondary_screen: true,
    detect_headphone: true,
    detect_extra_person: true,
    tab_switch_enabled: true,
    violation_action: 'auto_submit',
    auto_submit_after_violations: 3,
    frame_interval_ms: 1500,
  },
};

const DEFAULT_PROCTORING: ProctoringSettings = {
  enabled: true,
  ...PRESET_CONFIGS.balanced,
} as ProctoringSettings;

interface LiveTestTelemetry {
  faceCount: number | null;
  yaw: number | null;
  pitch: number | null;
  gazeYaw: number | null;
  gazePitch: number | null;
  objects: Array<{ cls: string; conf: number }>;
  inferenceMs: number | null;
  resolution: string | null;
  degraded: string[];
  errorMsg: string | null;
}

export const CreateExamWizard: React.FC = () => {
  const { classId } = useParams<{ classId: string }>();
  const [searchParams] = useSearchParams();
  const editExamId = searchParams.get('examId');
  const duplicateFromId = searchParams.get('duplicateFrom');
  const navigate = useNavigate();
  const { sidebarCollapsed } = useLayoutStore();

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [allClasses, setAllClasses] = useState<ClassInfo[]>([]);
  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null);

  // Step 1: General Info
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState(() =>
    toLocalDatetimeInput(new Date(Date.now() + 5 * 60 * 1000)),
  );
  const [endTime, setEndTime] = useState(() =>
    toLocalDatetimeInput(new Date(Date.now() + 125 * 60 * 1000)),
  );
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [resultVisibility, setResultVisibility] = useState<'immediately' | 'after_close' | 'hidden'>(
    'after_close',
  );
  const [allowReview, setAllowReview] = useState(false);

  // Step 2: Questions
  const [questions, setQuestions] = useState<WizardQuestion[]>([
    {
      id: 1,
      chapter: 'Chương 1: Tổng quan',
      content: '',
      type: 'single_choice',
      difficulty: 'medium',
      points: 1,
      options: [
        { content: '', is_correct: true, order_index: 0 },
        { content: '', is_correct: false, order_index: 1 },
        { content: '', is_correct: false, order_index: 2 },
        { content: '', is_correct: false, order_index: 3 },
      ],
    },
  ]);

  const [isBankModalOpen, setIsBankModalOpen] = useState(false);
  const [bankQuestions, setBankQuestions] = useState<BankQuestion[]>([]);
  const [selectedBankIds, setSelectedBankIds] = useState<(string | number)[]>([]);
  const [bankSearch, setBankSearch] = useState('');

  // Step 3: Proctoring + Real AI Camera Tester
  const [proctoring, setProctoring] = useState<ProctoringSettings>(DEFAULT_PROCTORING);
  const [advancedProctoringOpen, setAdvancedProctoringOpen] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [testTelemetry, setTestTelemetry] = useState<LiveTestTelemetry>({
    faceCount: null,
    yaw: null,
    pitch: null,
    gazeYaw: null,
    gazePitch: null,
    objects: [],
    inferenceMs: null,
    resolution: null,
    degraded: [],
    errorMsg: null,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const testInFlightRef = useRef(false);
  const createdExamIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!classId) return;
    classApi
      .getById(Number(classId))
      .then((res) => setClassInfo(res.data.data))
      .catch(() => {});
    classApi
      .getAll()
      .then((res) => setAllClasses(res.data.data || []))
      .catch(() => {});
  }, [classId]);

  // Nạp dữ liệu đề thi khi ở chế độ Chỉnh sửa (?examId=) hoặc Nhân bản (?duplicateFrom=)
  useEffect(() => {
    const sourceId = editExamId || duplicateFromId;
    if (!sourceId) return;
    examApi
      .getById(sourceId)
      .then((res) => {
        const raw: any = (res.data as any)?.data?.exam ?? (res.data as any)?.data ?? res.data;
        if (!raw) return;
        setTitle(duplicateFromId ? `${raw.name} (Bản sao)` : raw.name || '');
        setDescription(raw.description || '');
        if (!duplicateFromId && raw.start_time) {
          setStartTime(toLocalDatetimeInput(new Date(raw.start_time)));
        }
        if (!duplicateFromId && raw.end_time) {
          setEndTime(toLocalDatetimeInput(new Date(raw.end_time)));
        }
        setDurationMinutes(Number(raw.duration_minutes ?? 60));
        setMaxAttempts(Number(raw.max_attempts ?? 1));
        setShuffleQuestions(Boolean(raw.shuffle_questions));
        setShuffleOptions(Boolean(raw.shuffle_options));
        if (raw.result_visibility) setResultVisibility(raw.result_visibility);
        setAllowReview(Boolean(raw.allow_review));

        if (Array.isArray(raw.questions) && raw.questions.length > 0) {
          setQuestions(
            raw.questions.map((q: any) => ({
              id: duplicateFromId ? undefined : q.id,
              bank_question_id: q.source_bank_question_id ?? null,
              chapter: q.chapter || '',
              explanation: q.explanation || '',
              content: q.content || '',
              type: q.question_type || 'single_choice',
              difficulty: q.difficulty || 'medium',
              points: Number(q.points ?? 1),
              options: Array.isArray(q.options)
                ? q.options.map((o: any, idx: number) => ({
                    id: o.id,
                    content: o.content || '',
                    is_correct: Boolean(o.is_correct),
                    order_index: idx,
                  }))
                : [],
            })),
          );
        }

        const ps = raw.proctoringSettings || raw.proctoring_settings;
        if (ps) {
          setProctoring((prev) => ({
            ...prev,
            enabled: Boolean(ps.enabled),
            face_recognition_enabled: Boolean(ps.verify_identity ?? ps.verifyIdentity ?? true),
            detect_identity_swap: Boolean(ps.detect_identity_swap ?? ps.detectIdentitySwap ?? true),
            identity_recheck_interval_sec: Number(
              ps.identity_recheck_interval_sec ?? ps.identityRecheckIntervalSec ?? 300,
            ),
            detect_no_face: Boolean(ps.detect_no_face ?? ps.detectNoFace ?? true),
            no_face_grace_sec: Number(ps.no_face_grace_sec ?? ps.noFaceGraceSec ?? 8),
            multiple_faces_enabled: Boolean(
              ps.detect_multiple_faces ?? ps.detectMultipleFaces ?? true,
            ),
            head_pose_enabled: Boolean(ps.track_head_pose ?? ps.trackHeadPose ?? true),
            head_sensitivity: ps.head_sensitivity ?? ps.headSensitivity ?? 'normal',
            head_yaw_threshold_deg: Number(
              ps.head_yaw_threshold_deg ?? ps.headYawThresholdDeg ?? 35,
            ),
            head_pitch_threshold_deg: Number(
              ps.head_pitch_threshold_deg ?? ps.headPitchThresholdDeg ?? 25,
            ),
            gaze_tracking_enabled: Boolean(ps.track_gaze ?? ps.trackGaze ?? false),
            gaze_sensitivity: ps.gaze_sensitivity ?? ps.gazeSensitivity ?? 'normal',
            gaze_yaw_threshold_deg: Number(
              ps.gaze_yaw_threshold_deg ?? ps.gazeYawThresholdDeg ?? 20,
            ),
            gaze_pitch_threshold_deg: Number(
              ps.gaze_pitch_threshold_deg ?? ps.gazePitchThresholdDeg ?? 26,
            ),
            detect_phone: Boolean(ps.detect_phone ?? ps.detectPhone ?? true),
            detect_document: Boolean(ps.detect_document ?? ps.detectDocument ?? true),
            detect_secondary_screen: Boolean(
              ps.detect_secondary_screen ?? ps.detectSecondaryScreen ?? false,
            ),
            detect_headphone: Boolean(ps.detect_headphone ?? ps.detectHeadphone ?? false),
            detect_extra_person: Boolean(ps.detect_extra_person ?? ps.detectExtraPerson ?? false),
            tab_switch_enabled: Boolean(ps.detect_tab_switch ?? ps.detectTabSwitch ?? true),
            violation_action: ps.violation_action ?? ps.violationAction ?? 'warn_and_log',
            auto_submit_after_violations: Number(
              ps.auto_submit_after_violations ?? ps.autoSubmitAfterViolations ?? 5,
            ),
            frame_interval_ms: Number(ps.frame_interval_ms ?? ps.frameIntervalMs ?? 2000),
          }));
        }
      })
      .catch((err) => {
        setSaveError(err.response?.data?.error || 'Không thể tải thông tin đề thi.');
      });
  }, [editExamId, duplicateFromId]);

  const loadBankQuestions = async () => {
    if (!classId) return;
    try {
      const res = await questionBankApi.list(Number(classId));
      setBankQuestions(res.data.data || []);
    } catch {
      setBankQuestions([]);
    }
  };

  useEffect(() => {
    if (isBankModalOpen) {
      void loadBankQuestions();
    }
  }, [isBankModalOpen]);

  const stopCamera = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    setCameraActive(false);
  };

  const toggleCamera = async () => {
    if (cameraActive) {
      stopCamera();
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        mediaStreamRef.current = stream;
        setCameraActive(true);
        window.setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        }, 50);
      } catch {
        alert('Không thể truy cập camera. Vui lòng cấp quyền trình duyệt.');
      }
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Gửi khung hình thật lên POST /api/proctoring/test-frame khi bật Camera thử nghiệm ở Bước 3
  useEffect(() => {
    if (!cameraActive || currentStep !== 3) return;
    let cancelled = false;

    const runTestFrame = async () => {
      if (testInFlightRef.current || !videoRef.current) return;
      const vid = videoRef.current;
      if (vid.videoWidth === 0 || vid.videoHeight === 0) return;

      const canvas = document.createElement('canvas');
      canvas.width = vid.videoWidth;
      canvas.height = vid.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);

      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8),
      );
      if (!blob || cancelled) return;

      testInFlightRef.current = true;
      try {
        const res = await examApi.testProctoringFrame(
          blob,
          Boolean(proctoring.gaze_tracking_enabled),
        );
        if (cancelled) return;
        const d = res.data?.data;
        setTestTelemetry({
          faceCount: typeof d?.faceCount === 'number' ? d.faceCount : null,
          yaw: typeof d?.primary?.headPose?.yaw === 'number' ? d.primary.headPose.yaw : null,
          pitch: typeof d?.primary?.headPose?.pitch === 'number' ? d.primary.headPose.pitch : null,
          gazeYaw: typeof d?.primary?.gaze?.yaw === 'number' ? d.primary.gaze.yaw : null,
          gazePitch: typeof d?.primary?.gaze?.pitch === 'number' ? d.primary.gaze.pitch : null,
          objects: Array.isArray(d?.objects) ? d.objects : [],
          inferenceMs: typeof d?.inferenceMs === 'number' ? Math.round(d.inferenceMs) : null,
          resolution: `${vid.videoWidth}×${vid.videoHeight}`,
          degraded: Array.isArray(d?.degraded) ? d.degraded : [],
          errorMsg: null,
        });
      } catch (err: any) {
        if (cancelled) return;
        setTestTelemetry((prev) => ({
          ...prev,
          resolution: `${vid.videoWidth}×${vid.videoHeight}`,
          errorMsg:
            err.response?.data?.error || 'Dịch vụ Python AI đang bận hoặc chưa khởi động.',
        }));
      } finally {
        testInFlightRef.current = false;
      }
    };

    const timer = window.setInterval(() => {
      void runTestFrame();
    }, 2400);
    window.setTimeout(() => void runTestFrame(), 400);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [cameraActive, currentStep, proctoring.gaze_tracking_enabled]);

  const applyPreset = (presetKey: 'relaxed' | 'balanced' | 'strict') => {
    setProctoring((prev) => ({
      ...prev,
      ...PRESET_CONFIGS[presetKey],
      enabled: prev.enabled,
    }));
  };

  const applySensitivity = (
    target: 'head' | 'gaze',
    level: 'relaxed' | 'normal' | 'strict',
  ) => {
    if (target === 'head') {
      const yawMap = { relaxed: 45, normal: 35, strict: 25 };
      const pitchMap = { relaxed: 30, normal: 25, strict: 18 };
      setProctoring((prev) => ({
        ...prev,
        head_sensitivity: level,
        head_yaw_threshold_deg: yawMap[level],
        head_pitch_threshold_deg: pitchMap[level],
      }));
    } else {
      const gazeYawMap = { relaxed: 26, normal: 20, strict: 16 };
      const gazePitchMap = { relaxed: 30, normal: 26, strict: 22 };
      setProctoring((prev) => ({
        ...prev,
        gaze_sensitivity: level,
        gaze_yaw_threshold_deg: gazeYawMap[level],
        gaze_pitch_threshold_deg: gazePitchMap[level],
      }));
    }
  };

  const handleImportFromBank = () => {
    const toImport = bankQuestions.filter((bq) =>
      selectedBankIds.some((id) => String(id) === String(bq.id)),
    );
    const imported: WizardQuestion[] = toImport.map((bq) => ({
      bank_question_id: bq.id,
      chapter: bq.chapter || '',
      explanation: bq.explanation || '',
      content: bq.content,
      type: bq.question_type || 'single_choice',
      difficulty: bq.difficulty,
      points: Number(bq.default_points) || 1,
      options: (bq.options || []).map((o, idx) => ({
        content: o.content,
        is_correct: o.is_correct,
        order_index: idx,
      })),
    }));
    // Nếu câu mặc định đầu tiên đang trống thì thay thế luôn thay vì giữ câu rỗng
    setQuestions((prev) => {
      const nonEmpty = prev.filter((q) => q.content.trim() !== '');
      return [...nonEmpty, ...imported];
    });
    setSelectedBankIds([]);
    setIsBankModalOpen(false);
  };

  const updateQuestion = (index: number, patch: Partial<WizardQuestion>) => {
    setQuestions((current) =>
      current.map((question, questionIndex) =>
        questionIndex === index ? { ...question, ...patch } : question,
      ),
    );
  };

  const duplicateQuestion = (index: number) => {
    setQuestions((current) => {
      const src = current[index];
      if (!src) return current;
      const copy: WizardQuestion = {
        ...src,
        id: Date.now(),
        content: `${src.content} (Bản sao)`,
        options: src.options.map((o) => ({ ...o })),
      };
      const next = [...current];
      next.splice(index + 1, 0, copy);
      return next;
    });
  };

  const updateQuestionOption = (questionIndex: number, optionIndex: number, content: string) => {
    setQuestions((current) =>
      current.map((question, index) => {
        if (index !== questionIndex) return question;
        return {
          ...question,
          options: question.options.map((option, currentOptionIndex) =>
            currentOptionIndex === optionIndex ? { ...option, content } : option,
          ),
        };
      }),
    );
  };

  const selectCorrectOption = (questionIndex: number, optionIndex: number) => {
    setQuestions((current) =>
      current.map((question, index) => {
        if (index !== questionIndex) return question;
        const isMultiple = question.type === 'multiple_choice';
        return {
          ...question,
          options: question.options.map((option, currentOptionIndex) => ({
            ...option,
            is_correct: isMultiple
              ? currentOptionIndex === optionIndex
                ? !option.is_correct
                : option.is_correct
              : currentOptionIndex === optionIndex,
          })),
        };
      }),
    );
  };

  const handlePublish = async (isDraft = false) => {
    setSaveError(null);
    if (!title.trim()) {
      setSaveError('Vui lòng nhập tên kỳ thi / đề kiểm tra ở Bước 1.');
      setCurrentStep(1);
      return;
    }
    const startIso = startTime ? new Date(startTime).toISOString() : new Date().toISOString();
    const endIso = endTime
      ? new Date(endTime).toISOString()
      : new Date(Date.now() + 86400000).toISOString();
    if (new Date(endIso) <= new Date(startIso)) {
      setSaveError('Thời gian đóng đề phải sau thời gian bắt đầu mở đề (Bước 1).');
      setCurrentStep(1);
      return;
    }
    if (questions.length === 0) {
      setSaveError('Đề thi cần ít nhất 1 câu hỏi.');
      setCurrentStep(2);
      return;
    }
    // Kiểm tra hợp lệ toàn bộ câu hỏi TRƯỚC khi gọi API tạo đề để không tạo đề nháp rỗng
    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i];
      if (!q.content.trim()) {
        setSaveError(`Câu hỏi số ${i + 1} đang để trống nội dung.`);
        setCurrentStep(2);
        return;
      }
      const qType = q.type === 'code' ? 'file_upload' : q.type;
      if (qType === 'single_choice' || qType === 'multiple_choice') {
        const nonEmptyOpts = q.options.filter((o) => o.content.trim() !== '');
        if (nonEmptyOpts.length < 2) {
          setSaveError(`Câu hỏi số ${i + 1} cần ít nhất 2 phương án trả lời.`);
          setCurrentStep(2);
          return;
        }
        if (!nonEmptyOpts.some((o) => o.is_correct)) {
          setSaveError(`Câu hỏi số ${i + 1} chưa chọn đáp án đúng.`);
          setCurrentStep(2);
          return;
        }
      }
    }

    setLoading(true);
    try {
      const payload = {
        name: title.trim(),
        description: description.trim(),
        startTime: startIso,
        endTime: endIso,
        durationMinutes: Math.min(600, Math.max(1, Number(durationMinutes) || 60)),
        maxAttempts: Math.min(10, Math.max(1, Number(maxAttempts) || 1)),
        shuffleQuestions,
        shuffleOptions,
        resultVisibility,
        allowReview,
      };

      let targetExamId: number;
      const existingId = editExamId || createdExamIdRef.current;
      if (existingId) {
        const updateRes = await examApi.update(existingId, payload as any);
        const existingDetail = await examApi.getById(existingId);
        const existingRaw: any =
          (existingDetail.data as any)?.data?.exam ?? (existingDetail.data as any)?.data;
        targetExamId = Number(updateRes.data?.data?.id ?? existingId);
        // Xóa danh sách câu hỏi cũ (chỉ hợp lệ khi chưa có học sinh làm bài) và ghi lại theo thứ tự mới
        if (Array.isArray(existingRaw?.questions)) {
          for (const oldQ of existingRaw.questions) {
            await examApi.removeQuestion(targetExamId, oldQ.id);
          }
        }
      } else {
        const createResponse = await examApi.create(Number(classId), payload);
        targetExamId = Number(createResponse.data.data.id);
        createdExamIdRef.current = targetExamId;
      }

      for (let i = 0; i < questions.length; i += 1) {
        const question = questions[i];
        const normalizedType =
          question.type === 'code' ? 'file_upload' : question.type;
        await examApi.addManualQuestion(targetExamId, {
          sourceBankQuestionId: question.bank_question_id
            ? Number(question.bank_question_id)
            : null,
          questionType: normalizedType,
          content: question.content.trim(),
          explanation: question.explanation?.trim() || undefined,
          points: Number(question.points) || 1,
          options:
            normalizedType === 'essay' || normalizedType === 'file_upload'
              ? []
              : question.options
                  .filter((o) => o.content.trim() !== '')
                  .map((option) => ({
                    content: option.content.trim(),
                    isCorrect: option.is_correct,
                  })),
        });
      }

      await examApi.updateProctoringSettings(targetExamId, proctoring);
      if (!isDraft) {
        await examApi.publish(targetExamId);
      }
      stopCamera();
      navigate(`/class/${classId}?tab=exams`);
    } catch (error: any) {
      setSaveError(
        error.response?.data?.error ||
          error.response?.data?.message ||
          error.message ||
          'Không thể lưu đề thi.',
      );
    } finally {
      setLoading(false);
    }
  };

  const totalPoints = questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);

  // Thống kê phân bổ theo Chương thật cho Bước 4 (image5.png)
  const chapterBreakdown = useMemo(() => {
    if (questions.length === 0) return [];
    const counts = new Map<string, number>();
    for (const q of questions) {
      const chap = q.chapter?.trim() || 'Chưa phân chương';
      counts.set(chap, (counts.get(chap) ?? 0) + 1);
    }
    const colors = ['#4F46E5', '#3B82F6', '#10B981', '#F59E0B', '#EC4899'];
    return Array.from(counts.entries()).map(([chapter, cnt], idx) => ({
      chapter,
      count: cnt,
      pct: Math.round((cnt / questions.length) * 100),
      color: colors[idx % colors.length],
    }));
  }, [questions]);

  const filteredBankQuestions = useMemo(() => {
    if (!bankSearch.trim()) return bankQuestions;
    const q = bankSearch.toLowerCase();
    return bankQuestions.filter(
      (bq) =>
        bq.content.toLowerCase().includes(q) ||
        (bq.chapter || '').toLowerCase().includes(q),
    );
  }, [bankQuestions, bankSearch]);

  // Đánh giá trực tiếp khung hình thử nghiệm ở Bước 3
  const liveTestSummary = useMemo(() => {
    if (!cameraActive) {
      return {
        tone: 'neutral',
        title: 'Camera thử nghiệm đang tắt',
        detail: 'Nhấn "Bật Camera Thử Nghiệm" để gửi khung hình thật qua Python AI Service.',
      };
    }
    if (testTelemetry.errorMsg) {
      return {
        tone: 'warn',
        title: 'Chưa kết nối được dịch vụ AI',
        detail: testTelemetry.errorMsg,
      };
    }
    if (testTelemetry.faceCount === null) {
      return {
        tone: 'neutral',
        title: 'Đang phân tích khung hình đầu tiên...',
        detail: 'Đang gọi mô hình InsightFace + HopeNet + YOLOv8.',
      };
    }
    const issues: string[] = [];
    if (testTelemetry.faceCount === 0) issues.push('Không phát hiện khuôn mặt');
    if (testTelemetry.faceCount > 1) issues.push(`Phát hiện ${testTelemetry.faceCount} khuôn mặt`);
    const yawLimit = Number(proctoring.head_yaw_threshold_deg ?? 35);
    const pitchLimit = Number(proctoring.head_pitch_threshold_deg ?? 25);
    const gazeYawLimit = Number(proctoring.gaze_yaw_threshold_deg ?? 20);
    const gazePitchLimit = Number(proctoring.gaze_pitch_threshold_deg ?? 26);
    if (testTelemetry.yaw !== null && Math.abs(testTelemetry.yaw) >= yawLimit) {
      issues.push(`Góc quay đầu Yaw ${testTelemetry.yaw.toFixed(1)}° vượt ngưỡng ${yawLimit}°`);
    }
    if (testTelemetry.pitch !== null && Math.abs(testTelemetry.pitch) >= pitchLimit) {
      issues.push(`Góc cúi/ngẩng Pitch ${testTelemetry.pitch.toFixed(1)}° vượt ngưỡng ${pitchLimit}°`);
    }
    if (proctoring.gaze_tracking_enabled) {
      if (testTelemetry.gazeYaw !== null && Math.abs(testTelemetry.gazeYaw) >= gazeYawLimit) {
        issues.push(
          `Góc liếc mắt ngang ${testTelemetry.gazeYaw >= 0 ? '+' : ''}${testTelemetry.gazeYaw.toFixed(1)}° vượt ngưỡng ${gazeYawLimit}°`,
        );
      }
      if (testTelemetry.gazePitch !== null && Math.abs(testTelemetry.gazePitch) >= gazePitchLimit) {
        issues.push(
          `Góc nhìn dọc ${testTelemetry.gazePitch >= 0 ? '+' : ''}${testTelemetry.gazePitch.toFixed(1)}° vượt ngưỡng ${gazePitchLimit}°`,
        );
      }
    }
    if (testTelemetry.objects.length > 0) {
      issues.push(
        `Vật thể phát hiện: ${testTelemetry.objects
          .map((o) => `${o.cls} (${Math.round(o.conf * 100)}%)`)
          .join(', ')}`,
      );
    }
    if (issues.length > 0) {
      return {
        tone: 'warn',
        title: 'Phát hiện ngưỡng cảnh báo theo cấu hình hiện tại',
        detail: issues.join(' • '),
      };
    }
    return {
      tone: 'ok',
      title: 'Tất cả điều kiện bình thường',
      detail: '1 khuôn mặt rõ nét trong ngưỡng góc nhìn cho phép, không phát hiện vật thể cấm.',
    };
  }, [
    cameraActive,
    testTelemetry,
    proctoring.head_yaw_threshold_deg,
    proctoring.head_pitch_threshold_deg,
    proctoring.gaze_tracking_enabled,
    proctoring.gaze_yaw_threshold_deg,
    proctoring.gaze_pitch_threshold_deg,
  ]);

  const enabledObjectsSummary = [
    proctoring.detect_phone !== false && 'Điện thoại',
    proctoring.detect_document !== false && 'Tài liệu / Sách',
    proctoring.detect_secondary_screen && 'Màn hình phụ / Laptop',
    proctoring.detect_headphone && 'Tai nghe',
    proctoring.detect_extra_person && 'Người thứ 2',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="exam-layout-wrapper">
      <Sidebar classes={allClasses} currentClassId={Number(classId)} />

      <div className={`exam-main-panel ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        {/* Top Breadcrumb Header Bar */}
        <header className="page-header" style={{ padding: '16px 32px' }}>
          <div className="page-header-left">
            <button
              className="btn btn-ghost btn-icon btn-sm"
              onClick={() => navigate(`/class/${classId}?tab=exams`)}
            >
              <FiArrowLeft size={16} />
            </button>
            <div className="page-header-breadcrumb">
              <span className="breadcrumb-link" onClick={() => navigate('/')}>
                Tổng quan
              </span>
              <span style={{ color: '#94A3B8' }}>/</span>
              <span
                className="breadcrumb-link"
                onClick={() => navigate(`/class/${classId}?tab=exams`)}
              >
                {classInfo?.name || 'Lớp học'}
              </span>
              <span style={{ color: '#94A3B8' }}>/</span>
              <span>{editExamId ? 'Chỉnh sửa đề thi' : 'Tạo đề thi mới'}</span>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <span className="badge badge-neutral">
              ● {classInfo?.member_count ?? 0} học viên
            </span>
            {classInfo?.invite_code_students && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  navigator.clipboard?.writeText(
                    `${window.location.origin}/join/${classInfo.invite_code_students}`,
                  );
                  alert('Đã sao chép đường dẫn mời tham gia lớp học!');
                }}
              >
                🔗 Copy link mời
              </button>
            )}
          </div>
        </header>

        {/* Wizard Main Content Container */}
        <div className="exam-page-content">
          <div className="exam-header-row" style={{ marginBottom: 20 }}>
            <div className="exam-header-titles">
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#64748B',
                  letterSpacing: 0.5,
                }}
              >
                QUY TRÌNH SOẠN THẢO 4 BƯỚC
              </span>
              <h2>
                {editExamId ? 'Chỉnh sửa đề thi' : 'Tạo đề thi mới'} – Lớp:{' '}
                {classInfo?.name || 'Học phần'}
              </h2>
            </div>
          </div>

          {saveError && (
            <div className="exam-error-banner">
              <FiAlertTriangle size={18} /> <span>{saveError}</span>
            </div>
          )}

          {/* ── 4-Step Stepper Navigation (Matching image2.png) ── */}
          <div className="wizard-stepper-card">
            <div
              className={`step-node ${
                currentStep === 1 ? 'active' : currentStep > 1 ? 'completed' : 'pending'
              }`}
              onClick={() => setCurrentStep(1)}
            >
              <div className="step-node-circle">{currentStep > 1 ? <FiCheck /> : '1'}</div>
              <div className="step-node-text">
                <span className="step-node-label">BƯỚC 1</span>
                <span className="step-node-title">Thông tin chung</span>
              </div>
            </div>

            <div className={`step-connector-line ${currentStep > 1 ? 'active' : ''}`} />

            <div
              className={`step-node ${
                currentStep === 2 ? 'active' : currentStep > 2 ? 'completed' : 'pending'
              }`}
              onClick={() => setCurrentStep(2)}
            >
              <div className="step-node-circle">{currentStep > 2 ? <FiCheck /> : '2'}</div>
              <div className="step-node-text">
                <span className="step-node-label">BƯỚC 2</span>
                <span className="step-node-title">Quản lý câu hỏi</span>
              </div>
            </div>

            <div className={`step-connector-line ${currentStep > 2 ? 'active' : ''}`} />

            <div
              className={`step-node ${
                currentStep === 3 ? 'active' : currentStep > 3 ? 'completed' : 'pending'
              }`}
              onClick={() => setCurrentStep(3)}
            >
              <div className="step-node-circle">{currentStep > 3 ? <FiCheck /> : '3'}</div>
              <div className="step-node-text">
                <span className="step-node-label">BƯỚC 3</span>
                <span className="step-node-title">Giám sát AI</span>
              </div>
            </div>

            <div className={`step-connector-line ${currentStep > 3 ? 'active' : ''}`} />

            <div
              className={`step-node ${currentStep === 4 ? 'active' : 'pending'}`}
              onClick={() => setCurrentStep(4)}
            >
              <div className="step-node-circle">4</div>
              <div className="step-node-text">
                <span className="step-node-label">BƯỚC 4</span>
                <span className="step-node-title">Xem lại & Xuất bản</span>
              </div>
            </div>
          </div>

          {/* ── STEP 1: THÔNG TIN CHUNG ── */}
          {currentStep === 1 && (
            <div className="wizard-form-grid-2col">
              <div className="wizard-card">
                <div className="wizard-card-header">
                  <FiFileText size={18} />
                  <span>Thông tin cơ bản kỳ thi</span>
                </div>

                <div className="form-group-custom">
                  <label>
                    Tên kỳ thi / Đề kiểm tra <span className="required">*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input-custom"
                    placeholder="VD: Kiểm tra Giữa kỳ - Kiến trúc mạng TCP/IP & Socket"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>

                <div className="form-group-custom">
                  <label>Mô tả / Hướng dẫn thí sinh</label>
                  <textarea
                    rows={4}
                    className="form-textarea-custom"
                    placeholder="Nêu rõ phạm vi kiến thức, quy định làm bài, yêu cầu chuẩn bị camera..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div className="form-grid-2fields">
                  <div className="form-group-custom">
                    <label>
                      Thời lượng làm bài (phút) <span className="required">*</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={360}
                      className="form-input-custom"
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    />
                  </div>
                  <div className="form-group-custom">
                    <label>Số lượt thi tối đa / sinh viên</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      className="form-input-custom"
                      value={maxAttempts}
                      onChange={(e) => setMaxAttempts(Number(e.target.value))}
                    />
                  </div>
                </div>
              </div>

              <div className="wizard-card">
                <div className="wizard-card-header">
                  <FiCalendar size={18} />
                  <span>Thời gian, Đảo đề & Chính sách Công bố Điểm</span>
                </div>

                <div className="form-grid-2fields">
                  <div className="form-group-custom">
                    <label>Thời gian mở đề (Bắt đầu)</label>
                    <input
                      type="datetime-local"
                      className="form-input-custom"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                    />
                  </div>
                  <div className="form-group-custom">
                    <label>Thời gian đóng đề (Kết thúc)</label>
                    <input
                      type="datetime-local"
                      className="form-input-custom"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group-custom">
                  <label>Chính sách hiển thị điểm cho sinh viên</label>
                  <select
                    className="form-select-custom"
                    value={resultVisibility}
                    onChange={(e) => setResultVisibility(e.target.value as any)}
                  >
                    <option value="after_close">Công bố điểm sau khi ca thi kết thúc (Khuyên dùng)</option>
                    <option value="immediately">Hiển thị điểm ngay sau khi nộp bài</option>
                    <option value="hidden">Ẩn điểm (Chỉ giảng viên xem)</option>
                  </select>
                </div>

                <div style={{ marginTop: 8 }}>
                  <div className="toggle-item-row">
                    <div>
                      <div className="toggle-info-title">Xáo trộn thứ tự câu hỏi</div>
                      <div className="toggle-info-desc">
                        Mỗi lượt làm bài nhận một hoán vị câu hỏi độc lập
                      </div>
                    </div>
                    <label className="switch-control">
                      <input
                        type="checkbox"
                        checked={shuffleQuestions}
                        onChange={(e) => setShuffleQuestions(e.target.checked)}
                      />
                      <span className="switch-slider" />
                    </label>
                  </div>

                  <div className="toggle-item-row">
                    <div>
                      <div className="toggle-info-title">Xáo trộn đáp án A, B, C, D</div>
                      <div className="toggle-info-desc">
                        Hoán vị ngẫu nhiên các phương án lựa chọn trắc nghiệm
                      </div>
                    </div>
                    <label className="switch-control">
                      <input
                        type="checkbox"
                        checked={shuffleOptions}
                        onChange={(e) => setShuffleOptions(e.target.checked)}
                      />
                      <span className="switch-slider" />
                    </label>
                  </div>

                  <div className="toggle-item-row">
                    <div>
                      <div className="toggle-info-title">Cho phép sinh viên xem lại chi tiết bài làm</div>
                      <div className="toggle-info-desc">
                        Áp dụng khi điểm số đã được mở theo chính sách công bố ở trên
                      </div>
                    </div>
                    <label className="switch-control">
                      <input
                        type="checkbox"
                        checked={allowReview}
                        onChange={(e) => setAllowReview(e.target.checked)}
                      />
                      <span className="switch-slider" />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2: NỘI DUNG CÂU HỎI (Matching image2.png) ── */}
          {currentStep === 2 && (
            <div>
              <div className="questions-meta-summary-bar">
                <div className="meta-stats-inline">
                  <div className="meta-stat-unit">
                    <div className="meta-stat-unit-icon">
                      <FiFileText size={18} />
                    </div>
                    <div className="meta-stat-unit-text">
                      <span>Tổng số câu</span>
                      <strong>{questions.length} câu</strong>
                    </div>
                  </div>

                  <div className="meta-stat-unit">
                    <div
                      className="meta-stat-unit-icon"
                      style={{ color: '#059669', background: '#ECFDF5' }}
                    >
                      <FiCheckCircle size={18} />
                    </div>
                    <div className="meta-stat-unit-text">
                      <span>Tổng điểm</span>
                      <strong>{totalPoints.toFixed(2)} điểm</strong>
                    </div>
                  </div>

                  <div className="meta-stat-unit">
                    <div
                      className="meta-stat-unit-icon"
                      style={{ color: '#2563EB', background: '#EFF6FF' }}
                    >
                      <FiClock size={18} />
                    </div>
                    <div className="meta-stat-unit-text">
                      <span>Thời lượng</span>
                      <strong>{durationMinutes} phút</strong>
                    </div>
                  </div>
                </div>

                <div className="header-action-group">
                  <button
                    type="button"
                    className="btn-secondary-exam"
                    onClick={() => setIsBankModalOpen(true)}
                  >
                    <FiLayers size={16} /> + Chọn từ Ngân hàng câu hỏi
                  </button>
                  <button
                    type="button"
                    className="btn-primary-exam"
                    onClick={() => {
                      const newQ: WizardQuestion = {
                        id: Date.now(),
                        chapter: 'Chương 1: Tổng quan',
                        content: '',
                        type: 'single_choice',
                        difficulty: 'medium',
                        points: 1,
                        options: [
                          { content: '', is_correct: true, order_index: 0 },
                          { content: '', is_correct: false, order_index: 1 },
                          { content: '', is_correct: false, order_index: 2 },
                          { content: '', is_correct: false, order_index: 3 },
                        ],
                      };
                      setQuestions([...questions, newQ]);
                    }}
                  >
                    <FiPlus size={16} /> + Thêm câu hỏi mới
                  </button>
                </div>
              </div>

              {questions.map((q, idx) => (
                <div key={q.id || idx} className="question-item-card-row">
                  <div className="q-row-top">
                    <div className="q-top-left-badges">
                      <span className="q-drag-handle">⋮⋮</span>
                      <span className="q-number-pill">Câu {idx + 1}</span>
                      <span className="q-type-pill">
                        {q.type === 'single_choice'
                          ? 'Trắc nghiệm đơn'
                          : q.type === 'multiple_choice'
                            ? 'Trắc nghiệm nhiều lựa chọn'
                            : 'Tự luận / Nộp bài - Giảng viên chấm'}
                      </span>
                      {q.bank_question_id && (
                        <span className="q-type-pill" style={{ color: '#4F46E5' }}>
                          Ngân hàng #{q.bank_question_id}
                        </span>
                      )}
                    </div>

                    <div className="q-top-right-tools">
                      <span className="points-pill-badge">
                        Điểm: <strong>{q.points}</strong> đ
                      </span>
                      <button
                        type="button"
                        className="btn-icon-square"
                        title="Chỉnh sửa câu hỏi"
                        onClick={() =>
                          document.getElementById(`question-content-${q.id || idx}`)?.focus()
                        }
                      >
                        <FiEdit size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon-square"
                        title="Nhân bản câu hỏi"
                        onClick={() => duplicateQuestion(idx)}
                      >
                        <FiCopy size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon-square"
                        title="Xóa câu hỏi"
                        onClick={() => setQuestions(questions.filter((_, i) => i !== idx))}
                      >
                        <FiTrash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="question-editor-fields">
                    <textarea
                      id={`question-content-${q.id || idx}`}
                      className="form-textarea-custom question-content-editor"
                      value={q.content}
                      placeholder="Nhập nội dung câu hỏi..."
                      onChange={(event) => updateQuestion(idx, { content: event.target.value })}
                      rows={3}
                    />
                    <div
                      className="question-editor-meta"
                      style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) 130px 100px' }}
                    >
                      <select
                        className="form-input-custom"
                        value={q.type}
                        onChange={(event) => {
                          const type = event.target.value as WizardQuestion['type'];
                          updateQuestion(idx, {
                            type,
                            options:
                              type === 'essay' || type === 'file_upload' || type === 'code'
                                ? []
                                : q.options.length
                                  ? q.options
                                  : [
                                      { content: '', is_correct: true, order_index: 0 },
                                      { content: '', is_correct: false, order_index: 1 },
                                      { content: '', is_correct: false, order_index: 2 },
                                      { content: '', is_correct: false, order_index: 3 },
                                    ],
                          });
                        }}
                      >
                        <option value="single_choice">Trắc nghiệm đơn</option>
                        <option value="multiple_choice">Trắc nghiệm nhiều lựa chọn</option>
                        <option value="essay">Tự luận</option>
                        <option value="file_upload">Nộp tập tin / Lập trình</option>
                      </select>
                      <input
                        type="text"
                        className="form-input-custom"
                        placeholder="Chương / Chủ đề (VD: Chương 1: TCP/IP)"
                        value={q.chapter || ''}
                        onChange={(event) => updateQuestion(idx, { chapter: event.target.value })}
                      />
                      <select
                        className="form-input-custom"
                        value={q.difficulty}
                        onChange={(event) =>
                          updateQuestion(idx, { difficulty: event.target.value })
                        }
                      >
                        <option value="easy">Dễ</option>
                        <option value="medium">Trung bình</option>
                        <option value="hard">Khó</option>
                      </select>
                      <input
                        className="form-input-custom question-points-input"
                        type="number"
                        min="0.25"
                        step="0.25"
                        value={q.points}
                        onChange={(event) =>
                          updateQuestion(idx, { points: Number(event.target.value) })
                        }
                        aria-label={`Điểm câu ${idx + 1}`}
                      />
                    </div>
                  </div>

                  {q.options && q.options.length > 0 ? (
                    <div className="q-options-2x2-grid">
                      {q.options.map((opt, oIdx) => (
                        <div
                          key={oIdx}
                          className={`option-cell option-cell-editable ${
                            opt.is_correct ? 'correct' : ''
                          }`}
                          onClick={() => selectCorrectOption(idx, oIdx)}
                        >
                          <div className="opt-letter-circle">
                            {String.fromCharCode(65 + oIdx)}
                          </div>
                          <input
                            type="text"
                            value={opt.content}
                            placeholder={`Đáp án ${String.fromCharCode(65 + oIdx)}`}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              updateQuestionOption(idx, oIdx, event.target.value)
                            }
                            aria-label={`Đáp án ${String.fromCharCode(65 + oIdx)} của câu ${
                              idx + 1
                            }`}
                          />
                          {opt.is_correct && (
                            <FiCheck style={{ marginLeft: 'auto', color: '#059669' }} />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      style={{
                        background: '#F8FAFC',
                        border: '1px dashed #CBD5E1',
                        borderRadius: 8,
                        padding: 14,
                        color: '#64748B',
                        fontSize: 13,
                      }}
                    >
                      📝 Thí sinh trình bày câu trả lời tự luận / mã nguồn trực tiếp trên trình soạn thảo bài thi, giảng viên chấm tay có lưu vết.
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── STEP 3: CÀI ĐẶT GIÁM SÁT AI (Matching image4.png) ── */}
          {currentStep === 3 && (
            <div className="wizard-form-grid-2col">
              <div>
                <div className="proctoring-big-switch-card">
                  <div className="switch-left-title">
                    <div className="cam-icon-box">
                      <FiVideo size={22} />
                    </div>
                    <div className="cam-title-wrap">
                      <h4>
                        BẬT GIÁM SÁT BẰNG CAMERA & AI
                        <span
                          className={
                            proctoring.enabled ? 'status-badge-green' : 'status-badge-gray'
                          }
                          style={{ fontSize: 11 }}
                        >
                          {proctoring.enabled ? '● Đang bật' : '○ Đang tắt'}
                        </span>
                      </h4>
                      <p>
                        Xác thực danh tính ArcFace, phân tích góc đầu HopeNet, hướng nhìn L2CS và phát hiện vật thể cấm YOLOv8.
                      </p>
                    </div>
                  </div>

                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={proctoring.enabled}
                      onChange={(e) =>
                        setProctoring({ ...proctoring, enabled: e.target.checked })
                      }
                    />
                    <span className="switch-slider" />
                  </label>
                </div>

                {/* Presets 3 Cards */}
                <div style={{ marginBottom: 16 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: '#64748B',
                      textTransform: 'uppercase',
                      display: 'block',
                      marginBottom: 8,
                    }}
                  >
                    CẤU HÌNH MẪU NHANH (PRESETS)
                  </span>
                  <div className="presets-3-cards-row">
                    <div
                      className={`preset-choice-card ${
                        proctoring.behavior_preset === 'relaxed' ? 'selected' : ''
                      }`}
                      onClick={() => applyPreset('relaxed')}
                    >
                      <span className="preset-title-text">Nhẹ nhàng</span>
                    </div>
                    <div
                      className={`preset-choice-card ${
                        proctoring.behavior_preset === 'balanced' ? 'selected' : ''
                      }`}
                      onClick={() => applyPreset('balanced')}
                    >
                      <span className="preset-title-text">Cân bằng (Khuyên dùng)</span>
                    </div>
                    <div
                      className={`preset-choice-card ${
                        proctoring.behavior_preset === 'strict' ? 'selected' : ''
                      }`}
                      onClick={() => applyPreset('strict')}
                    >
                      <span className="preset-title-text">Nghiêm ngặt</span>
                    </div>
                  </div>
                </div>

                {/* NHÓM A – XÁC THỰC DANH TÍNH */}
                <div className="proctor-module-group-card">
                  <div className="module-group-title">
                    <FiShield size={16} /> NHÓM A – XÁC THỰC DANH TÍNH (ARCFACE 512-D)
                  </div>
                  <div className="toggle-item-row">
                    <div>
                      <div className="toggle-info-title">
                        Chụp ảnh chuẩn Pre-check trước khi vào thi
                      </div>
                      <div className="toggle-info-desc">
                        Trích xuất vector khuôn mặt tham chiếu tại phòng chờ trước khi mở đề.
                      </div>
                    </div>
                    <label className="switch-control">
                      <input
                        type="checkbox"
                        checked={proctoring.face_recognition_enabled ?? true}
                        onChange={(e) =>
                          setProctoring({
                            ...proctoring,
                            face_recognition_enabled: e.target.checked,
                          })
                        }
                      />
                      <span className="switch-slider" />
                    </label>
                  </div>

                  <div className="toggle-item-row">
                    <div>
                      <div className="toggle-info-title">Phát hiện đổi người thi hộ</div>
                      <div className="toggle-info-desc">
                        Đối chiếu Cosine Similarity định kỳ trong suốt thời gian làm bài.
                      </div>
                    </div>
                    <div className="inline-control">
                      <select
                        className="compact-select"
                        value={proctoring.identity_recheck_interval_sec ?? 300}
                        onChange={(e) =>
                          setProctoring({
                            ...proctoring,
                            identity_recheck_interval_sec: Number(e.target.value),
                          })
                        }
                      >
                        <option value={30}>30 giây</option>
                        <option value={60}>1 phút</option>
                        <option value={300}>5 phút</option>
                        <option value={600}>10 phút</option>
                      </select>
                      <label className="switch-control">
                        <input
                          type="checkbox"
                          checked={proctoring.detect_identity_swap ?? true}
                          onChange={(e) =>
                            setProctoring({
                              ...proctoring,
                              detect_identity_swap: e.target.checked,
                            })
                          }
                        />
                        <span className="switch-slider" />
                      </label>
                    </div>
                  </div>
                </div>

                {/* NHÓM B – GIÁM SÁT KHUÔN MẶT & TRÌNH DUYỆT */}
                <div className="proctor-module-group-card">
                  <div className="module-group-title">
                    <FiEye size={16} /> NHÓM B – KHUÔN MẶT & TRÌNH DUYỆT LÀM BÀI
                  </div>
                  <div className="toggle-item-row">
                    <div>
                      <div className="toggle-info-title">Cảnh báo khi rời khỏi khung hình</div>
                      <div className="toggle-info-desc">
                        Chỉ ghi nhận khi vắng mặt liên tục vượt quá thời gian ân hạn.
                      </div>
                    </div>
                    <div className="inline-control">
                      <span className="threshold-control">
                        Ân hạn{' '}
                        <input
                          type="number"
                          min="2"
                          max="60"
                          value={proctoring.no_face_grace_sec ?? 8}
                          onChange={(e) =>
                            setProctoring({
                              ...proctoring,
                              no_face_grace_sec: Number(e.target.value),
                            })
                          }
                        />{' '}
                        giây
                      </span>
                      <label className="switch-control">
                        <input
                          type="checkbox"
                          checked={proctoring.detect_no_face ?? true}
                          onChange={(e) =>
                            setProctoring({ ...proctoring, detect_no_face: e.target.checked })
                          }
                        />
                        <span className="switch-slider" />
                      </label>
                    </div>
                  </div>

                  <div className="toggle-item-row">
                    <div>
                      <div className="toggle-info-title">Cảnh báo phát hiện nhiều khuôn mặt</div>
                      <div className="toggle-info-desc">
                        Báo động nếu xuất hiện từ 2 khuôn mặt trở lên trong vùng quét.
                      </div>
                    </div>
                    <label className="switch-control">
                      <input
                        type="checkbox"
                        checked={proctoring.multiple_faces_enabled ?? true}
                        onChange={(e) =>
                          setProctoring({
                            ...proctoring,
                            multiple_faces_enabled: e.target.checked,
                          })
                        }
                      />
                      <span className="switch-slider" />
                    </label>
                  </div>

                  <div className="toggle-item-row">
                    <div>
                      <div className="toggle-info-title">
                        Giám sát rời tab / mất tiêu điểm / thoát toàn màn hình
                      </div>
                      <div className="toggle-info-desc">
                        Ghi nhận sự kiện trình duyệt theo thời gian thực về bảng giám sát.
                      </div>
                    </div>
                    <label className="switch-control">
                      <input
                        type="checkbox"
                        checked={proctoring.tab_switch_enabled ?? true}
                        onChange={(e) =>
                          setProctoring({
                            ...proctoring,
                            tab_switch_enabled: e.target.checked,
                          })
                        }
                      />
                      <span className="switch-slider" />
                    </label>
                  </div>
                </div>

                {/* NHÓM C – THEO DÕI HƯỚNG NHÌN */}
                <div className="proctor-module-group-card">
                  <div className="module-group-title">
                    <FiEye size={16} /> NHÓM C – THEO DÕI TƯ THẾ ĐẦU & ÁNH MẮT
                  </div>

                  <div className="toggle-item-row">
                    <div>
                      <div className="toggle-info-title">Theo dõi hướng đầu (HopeNet Head Pose)</div>
                      <div className="toggle-info-desc">
                        Cảnh báo khi góc quay đầu vượt ngưỡng {proctoring.head_yaw_threshold_deg ?? 28}°.
                      </div>
                    </div>
                    <div className="inline-control">
                      <div className="segmented-control">
                        {(['relaxed', 'normal', 'strict'] as const).map((lvl) => {
                          const label = lvl === 'relaxed' ? 'Nhẹ' : lvl === 'normal' ? 'Vừa' : 'Nghiêm';
                          const active = (proctoring.head_sensitivity ?? 'normal') === lvl;
                          return active ? (
                            <b
                              key={lvl}
                              style={{ cursor: 'pointer' }}
                              onClick={() => applySensitivity('head', lvl)}
                            >
                              {label}
                            </b>
                          ) : (
                            <span
                              key={lvl}
                              style={{ cursor: 'pointer' }}
                              onClick={() => applySensitivity('head', lvl)}
                            >
                              {label}
                            </span>
                          );
                        })}
                      </div>
                      <label className="switch-control">
                        <input
                          type="checkbox"
                          checked={Boolean(proctoring.head_pose_enabled)}
                          onChange={(e) =>
                            setProctoring({ ...proctoring, head_pose_enabled: e.target.checked })
                          }
                        />
                        <span className="switch-slider" />
                      </label>
                    </div>
                  </div>

                  <div className="toggle-item-row">
                    <div>
                      <div className="toggle-info-title">Theo dõi hướng mắt (L2CS-Net Gaze)</div>
                      <div className="toggle-info-desc">
                        Cảnh báo khi góc liếc mắt ngang vượt ngưỡng {proctoring.gaze_yaw_threshold_deg ?? 20}° (dọc {proctoring.gaze_pitch_threshold_deg ?? 26}°).
                      </div>
                    </div>
                    <div className="inline-control">
                      <div className="segmented-control">
                        {(['relaxed', 'normal', 'strict'] as const).map((lvl) => {
                          const label = lvl === 'relaxed' ? 'Nhẹ' : lvl === 'normal' ? 'Vừa' : 'Nghiêm';
                          const active = (proctoring.gaze_sensitivity ?? 'normal') === lvl;
                          return active ? (
                            <b
                              key={lvl}
                              style={{ cursor: 'pointer' }}
                              onClick={() => applySensitivity('gaze', lvl)}
                            >
                              {label}
                            </b>
                          ) : (
                            <span
                              key={lvl}
                              style={{ cursor: 'pointer' }}
                              onClick={() => applySensitivity('gaze', lvl)}
                            >
                              {label}
                            </span>
                          );
                        })}
                      </div>
                      <label className="switch-control">
                        <input
                          type="checkbox"
                          checked={Boolean(proctoring.gaze_tracking_enabled)}
                          onChange={(e) =>
                            setProctoring({
                              ...proctoring,
                              gaze_tracking_enabled: e.target.checked,
                            })
                          }
                        />
                        <span className="switch-slider" />
                      </label>
                    </div>
                  </div>
                </div>

                {/* NHÓM D – PHÁT HIỆN VẬT THỂ & MÔI TRƯỜNG */}
                <div className="proctor-module-group-card">
                  <div className="module-group-title">
                    <FiSmartphone size={16} /> NHÓM D – PHÁT HIỆN VẬT THỂ CẤM (YOLOV8)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className="check-option">
                      <input
                        type="checkbox"
                        checked={proctoring.detect_phone ?? true}
                        onChange={(e) =>
                          setProctoring({ ...proctoring, detect_phone: e.target.checked })
                        }
                      />{' '}
                      Phát hiện điện thoại di động
                    </label>
                    <label className="check-option">
                      <input
                        type="checkbox"
                        checked={proctoring.detect_document ?? true}
                        onChange={(e) =>
                          setProctoring({ ...proctoring, detect_document: e.target.checked })
                        }
                      />{' '}
                      Phát hiện tài liệu / sách vở
                    </label>
                    <label className="check-option">
                      <input
                        type="checkbox"
                        checked={proctoring.detect_secondary_screen ?? false}
                        onChange={(e) =>
                          setProctoring({
                            ...proctoring,
                            detect_secondary_screen: e.target.checked,
                          })
                        }
                      />{' '}
                      Phát hiện màn hình phụ / laptop
                    </label>
                    <label className="check-option">
                      <input
                        type="checkbox"
                        checked={proctoring.detect_headphone ?? false}
                        onChange={(e) =>
                          setProctoring({ ...proctoring, detect_headphone: e.target.checked })
                        }
                      />{' '}
                      Phát hiện tai nghe
                    </label>
                    <label className="check-option check-option-wide">
                      <input
                        type="checkbox"
                        checked={proctoring.detect_extra_person ?? false}
                        onChange={(e) =>
                          setProctoring({
                            ...proctoring,
                            detect_extra_person: e.target.checked,
                          })
                        }
                      />{' '}
                      Phát hiện người lạ xuất hiện trong khung hình
                    </label>
                  </div>
                </div>

                {/* NHÓM E – XỬ LÝ VI PHẠM */}
                <div className="proctor-module-group-card">
                  <div className="module-group-title module-group-title-danger">
                    ⌁ NHÓM E – XỬ LÝ KHI XÁC NHẬN VI PHẠM
                  </div>
                  <label className="policy-option">
                    <input
                      type="radio"
                      name="violation-action"
                      checked={proctoring.violation_action !== 'auto_submit'}
                      onChange={() =>
                        setProctoring({ ...proctoring, violation_action: 'warn_and_log' })
                      }
                    />
                    <span>
                      <b>Hiện cảnh báo cho thí sinh + lưu bằng chứng ảnh cho giảng viên</b>
                      <small>
                        Không tự động thu bài — đảm bảo an toàn khi đường truyền hoặc ánh sáng không ổn định.
                      </small>
                    </span>
                  </label>
                  <label className="policy-option">
                    <input
                      type="radio"
                      name="violation-action"
                      checked={proctoring.violation_action === 'auto_submit'}
                      onChange={() =>
                        setProctoring({ ...proctoring, violation_action: 'auto_submit' })
                      }
                    />
                    <span>
                      <b>
                        Tự động thu bài sau{' '}
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={proctoring.auto_submit_after_violations ?? 3}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            setProctoring({
                              ...proctoring,
                              violation_action: 'auto_submit',
                              auto_submit_after_violations: Math.max(1, Number(e.target.value)),
                            })
                          }
                          style={{
                            width: 44,
                            padding: '2px 4px',
                            border: '1px solid #CBD5E1',
                            borderRadius: 4,
                            textAlign: 'center',
                            color: '#DC2626',
                            fontWeight: 700,
                          }}
                        />{' '}
                        lần vi phạm xác nhận
                      </b>
                      <small>
                        Tự động chốt nộp bài làm tại thời điểm đạt ngưỡng vi phạm đã xác nhận.
                      </small>
                    </span>
                  </label>
                </div>
              </div>

              {/* Right Column: REAL Live Cam Tester (Matching image4.png right side) */}
              <div className="live-camera-tester-card" style={{ alignSelf: 'start', position: 'sticky', top: 84 }}>
                <div className="tester-title-bar">
                  <h4>
                    <span className="green-dot-online" /> Khung camera kiểm thử AI thật
                  </h4>
                  <span className="ai-engine-tag">PROCTORING V2</span>
                </div>
                <p style={{ fontSize: 12, color: '#64748B', margin: '0 0 14px 0' }}>
                  Gửi khung hình webcam trực tiếp tới Python AI Service để kiểm tra góc quay đầu, ánh mắt và phát hiện vật thể theo cấu hình hiện tại.
                </p>

                <div className="tester-video-viewport">
                  {cameraActive ? (
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="tester-video-stream"
                    />
                  ) : (
                    <div style={{ textAlign: 'center', color: '#94A3B8' }}>
                      <FiCamera size={44} style={{ marginBottom: 8 }} />
                      <div>Camera đang tắt</div>
                    </div>
                  )}

                  <div className="tester-overlay-hud">
                    <span className="hud-telemetry-pill">
                      {!cameraActive
                        ? 'Camera: Tắt'
                        : testTelemetry.pitch !== null && testTelemetry.yaw !== null
                          ? `Đầu: ${testTelemetry.yaw >= 0 ? '+' : ''}${testTelemetry.yaw.toFixed(1)}°/${testTelemetry.pitch >= 0 ? '+' : ''}${testTelemetry.pitch.toFixed(1)}°${
                              proctoring.gaze_tracking_enabled && testTelemetry.gazeYaw !== null
                                ? ` | Mắt: ${testTelemetry.gazeYaw >= 0 ? '+' : ''}${testTelemetry.gazeYaw.toFixed(1)}°`
                                : ''
                            }`
                          : testTelemetry.faceCount === 0
                            ? 'Không thấy mặt'
                            : 'Đang đo góc đầu...'}
                    </span>
                    <span className="hud-fps-pill">
                      {cameraActive
                        ? testTelemetry.faceCount !== null
                          ? `● ${testTelemetry.faceCount} khuôn mặt`
                          : '● Đang quét...'
                        : '○ Chờ bật'}
                    </span>
                  </div>

                  {cameraActive && testTelemetry.faceCount === 1 && (
                    <div className="tester-face-box" />
                  )}
                </div>

                <div style={{ marginTop: 12, textAlign: 'center' }}>
                  <button
                    type="button"
                    className="btn-secondary-exam"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={() => void toggleCamera()}
                  >
                    {cameraActive ? (
                      <>
                        <FiVideoOff /> Tắt Camera Thử Nghiệm
                      </>
                    ) : (
                      <>
                        <FiVideo /> Bật Camera Thử Nghiệm
                      </>
                    )}
                  </button>
                </div>

                <div className="tester-metrics-3row">
                  <div className="metric-unit">
                    <span>Độ trễ AI</span>
                    <strong>
                      {cameraActive && testTelemetry.inferenceMs !== null
                        ? `${testTelemetry.inferenceMs} ms`
                        : '--'}
                    </strong>
                  </div>
                  <div className="metric-unit">
                    <span>Độ phân giải</span>
                    <strong>{cameraActive ? testTelemetry.resolution || '--' : '--'}</strong>
                  </div>
                  <div className="metric-unit">
                    <span>Vật thể YOLOv8</span>
                    <strong
                      style={{
                        color:
                          !cameraActive || testTelemetry.errorMsg || testTelemetry.inferenceMs === null
                            ? '#64748B'
                            : testTelemetry.objects.length > 0
                              ? '#DC2626'
                              : '#059669',
                      }}
                    >
                      {!cameraActive || testTelemetry.errorMsg || testTelemetry.inferenceMs === null
                        ? '--'
                        : testTelemetry.objects.length > 0
                          ? `${testTelemetry.objects.length} vật thể`
                          : 'An toàn'}
                    </strong>
                  </div>
                </div>

                <div
                  className="tester-status-card"
                  style={
                    liveTestSummary.tone === 'warn'
                      ? { background: '#FEF2F2', color: '#DC2626' }
                      : liveTestSummary.tone === 'neutral'
                        ? { background: '#F8FAFC', color: '#475569' }
                        : undefined
                  }
                >
                  <FiShield size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>
                    <b>{liveTestSummary.title}</b>
                    <small>{liveTestSummary.detail}</small>
                  </span>
                </div>

                <button
                  type="button"
                  className="advanced-settings-trigger"
                  onClick={() => setAdvancedProctoringOpen((open) => !open)}
                >
                  <span>⚙ Cài đặt AI nâng cao (Góc Yaw/Pitch, chu kỳ quét...)</span>
                  <span>{advancedProctoringOpen ? '⌃' : '⌄'}</span>
                </button>
                {advancedProctoringOpen && (
                  <div className="advanced-settings-panel">
                    <label>
                      Ngưỡng quay đầu ngang (Yaw)
                      <span>
                        <input
                          type="number"
                          min={10}
                          max={80}
                          value={proctoring.head_yaw_threshold_deg ?? 35}
                          onChange={(e) =>
                            setProctoring({
                              ...proctoring,
                              head_sensitivity: 'custom',
                              head_yaw_threshold_deg: Number(e.target.value),
                            })
                          }
                        />{' '}
                        °
                      </span>
                    </label>
                    <label>
                      Ngưỡng cúi / ngẩng đầu (Pitch)
                      <span>
                        <input
                          type="number"
                          min={10}
                          max={60}
                          value={proctoring.head_pitch_threshold_deg ?? 25}
                          onChange={(e) =>
                            setProctoring({
                              ...proctoring,
                              head_sensitivity: 'custom',
                              head_pitch_threshold_deg: Number(e.target.value),
                            })
                          }
                        />{' '}
                        °
                      </span>
                    </label>
                    <label>
                      Ngưỡng liếc mắt ngang (Gaze Yaw)
                      <span>
                        <input
                          type="number"
                          min={10}
                          max={60}
                          value={proctoring.gaze_yaw_threshold_deg ?? 20}
                          onChange={(e) =>
                            setProctoring({
                              ...proctoring,
                              gaze_sensitivity: 'custom',
                              gaze_yaw_threshold_deg: Number(e.target.value),
                            })
                          }
                        />{' '}
                        °
                      </span>
                    </label>
                    <label>
                      Chu kỳ gửi frame giám sát
                      <span>
                        <input
                          type="number"
                          min={1000}
                          max={10000}
                          step={500}
                          value={proctoring.frame_interval_ms ?? 2000}
                          onChange={(e) =>
                            setProctoring({
                              ...proctoring,
                              frame_interval_ms: Number(e.target.value),
                            })
                          }
                        />{' '}
                        ms
                      </span>
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 4: XEM LẠI & XUẤT BẢN (Matching image5.png) ── */}
          {currentStep === 4 && (
            <div>
              <div className="review-hero-banner">
                <div className="review-hero-left">
                  <div className="hero-shield-icon">
                    <FiShield size={24} />
                  </div>
                  <div>
                    <h3>Kiểm tra cấu hình tổng thể trước khi xuất bản</h3>
                    <p>
                      Đề thi gồm {questions.length} câu hỏi ({totalPoints.toFixed(2)} điểm) •{' '}
                      {proctoring.enabled
                        ? 'Đã kích hoạt Giám sát AI Proctoring'
                        : 'Chế độ thi tiêu chuẩn (không thu camera)'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="wizard-form-grid-2col">
                {/* Left Card: General & Real Chapter Structure */}
                <div className="wizard-card">
                  <div className="wizard-card-header">
                    <FiFileText size={18} />
                    <span>Thông tin chung & Khung giờ thi thực tế</span>
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>
                      TÊN ĐỀ THI
                    </div>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: '#0F172A',
                        marginTop: 2,
                      }}
                    >
                      {title || '(Chưa đặt tên đề thi)'}
                    </div>
                  </div>

                  <div className="form-grid-2fields" style={{ marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>
                        KHUNG GIỜ MỞ — ĐÓNG ĐỀ
                      </div>
                      <div
                        style={{
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: '#0F172A',
                          marginTop: 2,
                        }}
                      >
                        {startTime ? new Date(startTime).toLocaleString('vi-VN') : '--'} →{' '}
                        {endTime ? new Date(endTime).toLocaleString('vi-VN') : '--'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>
                        THỜI LƯỢNG & LƯỢT THI
                      </div>
                      <div
                        style={{
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: '#0F172A',
                          marginTop: 2,
                        }}
                      >
                        {durationMinutes} phút • Tối đa {maxAttempts} lượt/SV
                      </div>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: 16 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#0F172A',
                        marginBottom: 10,
                      }}
                    >
                      Phân bổ câu hỏi theo chương ({questions.length} câu)
                    </div>
                    <div className="chapter-segmented-bar">
                      {chapterBreakdown.map((cb, idx) => (
                        <div
                          key={idx}
                          style={{ width: `${cb.pct}%`, background: cb.color }}
                        />
                      ))}
                    </div>
                    <div className="chapter-legend-row" style={{ flexWrap: 'wrap' }}>
                      {chapterBreakdown.map((cb, idx) => (
                        <div key={idx} className="legend-chip">
                          <span
                            className="chip-dot"
                            style={{ background: cb.color }}
                          />{' '}
                          {cb.chapter}: {cb.count} câu ({cb.pct}%)
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right Card: Real Proctoring & Result Policy Summary */}
                <div className="wizard-card">
                  <div className="wizard-card-header">
                    <FiShield size={18} />
                    <span>Tóm tắt Giám sát AI & Công bố Điểm</span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      background: '#F8FAFC',
                      borderRadius: 10,
                      marginBottom: 16,
                    }}
                  >
                    <div>
                      <span
                        className={
                          proctoring.enabled ? 'status-badge-green' : 'status-badge-gray'
                        }
                        style={{ fontSize: 11 }}
                      >
                        {proctoring.enabled ? '● AI ĐANG BẬT' : '○ AI ĐANG TẮT'}
                      </span>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: '#0F172A',
                          marginTop: 4,
                        }}
                      >
                        {proctoring.behavior_preset === 'strict'
                          ? 'Cấu hình Nghiêm ngặt'
                          : proctoring.behavior_preset === 'relaxed'
                            ? 'Cấu hình Nhẹ nhàng'
                            : 'Cấu hình Cân bằng'}
                      </div>
                    </div>
                    <span className="status-badge-blue">
                      Chu kỳ {((proctoring.frame_interval_ms ?? 2000) / 1000).toFixed(1)}s
                    </span>
                  </div>

                  <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.85 }}>
                    {proctoring.enabled ? (
                      <>
                        <div>
                          ✓ <strong>Xác thực khuôn mặt:</strong>{' '}
                          {proctoring.face_recognition_enabled ? 'Bật Pre-check' : 'Tắt'}{' '}
                          {proctoring.detect_identity_swap
                            ? `(Đối chiếu lại mỗi ${proctoring.identity_recheck_interval_sec ?? 300}s)`
                            : ''}
                        </div>
                        <div>
                          ✓ <strong>Hướng đầu & Ánh mắt:</strong>{' '}
                          {proctoring.head_pose_enabled
                            ? `Yaw ≥ ${proctoring.head_yaw_threshold_deg ?? 28}°, Pitch ≥ ${proctoring.head_pitch_threshold_deg ?? 22}°`
                            : 'Tắt hướng đầu'}
                          {proctoring.gaze_tracking_enabled
                            ? ' • Bật L2CS Gaze'
                            : ' • Tắt Gaze'}
                        </div>
                        <div>
                          ✓ <strong>Vật thể cấm YOLOv8:</strong>{' '}
                          {enabledObjectsSummary || 'Không bật'}
                        </div>
                        <div>
                          ✓ <strong>Chính sách xử lý:</strong>{' '}
                          {proctoring.violation_action === 'auto_submit'
                            ? `Tự động thu bài sau ${proctoring.auto_submit_after_violations ?? 3} vi phạm`
                            : 'Cảnh báo trực tiếp + Lưu bằng chứng hậu kiểm'}
                        </div>
                      </>
                    ) : (
                      <div>
                        • Đề thi chạy ở chế độ tiêu chuẩn, không yêu cầu thí sinh mở webcam.
                      </div>
                    )}
                    <div>
                      ✓ <strong>Công bố điểm:</strong>{' '}
                      {resultVisibility === 'immediately'
                        ? 'Hiển thị ngay sau khi nộp'
                        : resultVisibility === 'after_close'
                          ? 'Mở sau khi đóng đề'
                          : 'Ẩn điểm với sinh viên'}{' '}
                      ({allowReview ? 'Cho xem lại đáp án' : 'Không mở đáp án chi tiết'})
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Sticky Bottom Footer Action Bar ── */}
          <div className="wizard-footer-action-bar">
            {currentStep > 1 ? (
              <button
                type="button"
                className="btn-secondary-exam"
                onClick={() => setCurrentStep((prev) => prev - 1)}
              >
                <FiArrowLeft size={16} /> Quay lại (Bước {currentStep - 1})
              </button>
            ) : (
              <div />
            )}

            <div className="footer-btn-group">
              <button
                type="button"
                className="btn-secondary-exam"
                onClick={() => void handlePublish(true)}
                disabled={loading}
              >
                <FiSave size={16} /> {loading ? 'Đang lưu...' : 'Lưu nháp'}
              </button>

              {currentStep < 4 ? (
                <button
                  type="button"
                  className="btn-primary-exam"
                  onClick={() => setCurrentStep((prev) => prev + 1)}
                >
                  Tiếp tục:{' '}
                  {currentStep === 1
                    ? 'Quản lý câu hỏi'
                    : currentStep === 2
                      ? 'Cài đặt Giám sát AI'
                      : 'Xem lại & Xuất bản'}{' '}
                  (Bước {currentStep + 1}) <FiArrowRight size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary-exam"
                  style={{ background: '#4338CA' }}
                  onClick={() => void handlePublish(false)}
                  disabled={loading}
                >
                  🚀 {loading ? 'Đang xuất bản...' : 'Xuất bản Đề thi ngay'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── MODAL: Chọn câu hỏi từ Ngân hàng câu hỏi (Matching image3.png) ── */}
      {isBankModalOpen && (
        <div className="exam-modal-backdrop">
          <div className="exam-modal-dialog">
            <div className="modal-dialog-header">
              <div className="modal-header-title">
                <FiLayers size={22} style={{ color: '#4F46E5' }} />
                <div>
                  <h3>Chọn câu hỏi từ Ngân hàng câu hỏi</h3>
                  <span style={{ fontSize: 12, color: '#64748B' }}>
                    Lớp: {classInfo?.name || 'Học phần'}
                  </span>
                </div>
              </div>
              <button
                className="modal-close-cross"
                onClick={() => setIsBankModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-dialog-body">
              <div
                className="exam-search-input-wrap"
                style={{ maxWidth: '100%', marginBottom: 16 }}
              >
                <FiSearch size={16} />
                <input
                  type="text"
                  placeholder="Tìm kiếm câu hỏi theo từ khóa hoặc chương..."
                  value={bankSearch}
                  onChange={(e) => setBankSearch(e.target.value)}
                />
              </div>

              {filteredBankQuestions.length === 0 ? (
                <div className="exam-empty-state" style={{ minHeight: 180 }}>
                  <FiLayers size={24} />
                  <span>Không tìm thấy câu hỏi nào trong ngân hàng của lớp.</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {filteredBankQuestions.map((bq) => {
                    const isChecked = selectedBankIds.some(
                      (id) => String(id) === String(bq.id),
                    );
                    return (
                      <div
                        key={bq.id}
                        style={{
                          padding: '12px 16px',
                          background: isChecked ? '#EEF2FF' : '#F8FAFC',
                          border: isChecked ? '1px solid #818CF8' : '1px solid #E2E8F0',
                          borderRadius: 10,
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 12,
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          if (isChecked) {
                            setSelectedBankIds(
                              selectedBankIds.filter((id) => String(id) !== String(bq.id)),
                            );
                          } else {
                            setSelectedBankIds([...selectedBankIds, bq.id]);
                          }
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          style={{ width: 18, height: 18, marginTop: 2, cursor: 'pointer' }}
                        />
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              marginBottom: 4,
                              flexWrap: 'wrap',
                            }}
                          >
                            <span
                              style={{ fontSize: 12, fontWeight: 700, color: '#2563EB' }}
                            >
                              #Q-{bq.id}
                            </span>
                            {bq.chapter && (
                              <span className="q-type-pill">{bq.chapter}</span>
                            )}
                            <span className="status-badge-green" style={{ fontSize: 11 }}>
                              {bq.difficulty === 'easy'
                                ? 'Dễ'
                                : bq.difficulty === 'medium'
                                  ? 'Trung bình'
                                  : 'Khó'}
                            </span>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: '#0F172A',
                                marginLeft: 'auto',
                              }}
                            >
                              {bq.default_points || 1} đ
                            </span>
                          </div>
                          <div
                            style={{ fontSize: 14, fontWeight: 600, color: '#1E293B' }}
                          >
                            {bq.content}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="modal-dialog-footer">
              <span style={{ fontSize: 13, color: '#64748B' }}>
                Đã chọn:{' '}
                <strong style={{ color: '#4F46E5' }}>{selectedBankIds.length}</strong> câu hỏi
              </span>

              <div className="header-action-group">
                <button
                  type="button"
                  className="btn-secondary-exam"
                  onClick={() => setIsBankModalOpen(false)}
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  className="btn-primary-exam"
                  disabled={selectedBankIds.length === 0}
                  onClick={handleImportFromBank}
                >
                  Thêm {selectedBankIds.length} câu hỏi vào đề thi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
