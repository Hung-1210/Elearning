import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import {
  FiClock,
  FiShield,
  FiCheck,
  FiCheckCircle,
  FiAlertTriangle,
  FiFlag,
  FiArrowLeft,
  FiArrowRight,
  FiSend,
  FiCode,
  FiFileText,
  FiVolume2,
  FiVideo,
  FiWifi,
  FiLock,
  FiInfo,
  FiSave,
  FiCloud,
  FiUser,
  FiX,
  FiList,
  FiCamera,
} from 'react-icons/fi';
import { studentExamApi, BACKEND_ORIGIN } from '../../api';
import { useAuthStore } from '../../store/authStore';
import type { ExamAttempt, ExamQuestion } from '../../types';
import './exam.css';

interface ExamQuestionItem {
  id: string;
  order_index: number;
  content: string;
  chapter?: string;
  type: 'single_choice' | 'multiple_choice' | 'essay' | 'code';
  difficulty: 'easy' | 'medium' | 'hard';
  points: number;
  options: {
    id: string;
    content: string;
    order_index: number;
  }[];
}

type AnswerDraft = {
  selected_option_ids?: string[];
  answer_text?: string;
  is_flagged?: boolean;
};

type AiRuntimeStatus = 'connecting' | 'ok' | 'degraded' | 'disabled' | 'offline';

interface SupervisorNotice {
  id: string;
  scope: 'broadcast' | 'direct';
  message: string;
  sentAt: string;
}

interface FrameResult {
  warnings?: Array<{ type?: string; messageVi?: string; severity?: string }>;
  shouldAutoSubmit?: boolean;
  aiStatus?: 'ok' | 'degraded' | 'dropped' | 'disabled';
  aiError?: { code: string; message: string; modules?: string[] };
  requestId?: string;
  inferenceMs?: number;
  violationSummary?: {
    criticalConfirmed: number;
    autoSubmitThreshold: number | null;
    totalConfirmed: number;
  };
  supervisorNotice?: SupervisorNotice;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type SaveState = { status: SaveStatus; message?: string };

const toQuestionItem = (question: ExamQuestion, idx: number): ExamQuestionItem => ({
  id: String(question.id),
  order_index: question.position ?? idx + 1,
  content: question.content,
  chapter: (question as any).chapter || undefined,
  type: question.question_type === 'file_upload' ? 'code' : question.question_type,
  difficulty: ((question as any).difficulty as 'easy' | 'medium' | 'hard') || 'medium',
  points: Number(question.points),
  options: (question.options || []).map((option, optIdx) => ({
    id: String(option.id),
    content: option.content,
    order_index: option.position ?? optIdx,
  })),
});

export const ExamTakingPage: React.FC = () => {
  const { examId, attemptId } = useParams<{ examId: string; attemptId: string }>();
  const navigate = useNavigate();

  const [questions, setQuestions] = useState<ExamQuestionItem[]>([]);
  const [attempt, setAttempt] = useState<ExamAttempt | null>(null);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [answersMap, setAnswersMap] = useState<Record<string, AnswerDraft>>({});
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [flaggedQuestions, setFlaggedQuestions] = useState<Record<string, boolean>>({});
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  // Timer
  const [remainingSeconds, setRemainingSeconds] = useState<number>(3600);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [proctoringError, setProctoringError] = useState<string | null>(null);
  const [supervisorBanner, setSupervisorBanner] = useState<SupervisorNotice | null>(null);
  const [tabSwitchCount, setTabSwitchCount] = useState<number>(0);

  const attemptRef = useRef<ExamAttempt | null>(null);
  const remainingSecondsRef = useRef(0);
  const isSubmittingRef = useRef(false);
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingAnswersRef = useRef<Record<string, AnswerDraft>>({});
  const inFlightSaveRef = useRef<Record<string, Promise<boolean>>>({});
  const seenNoticeIdsRef = useRef<Set<string>>(new Set());
  const sessionSocketRef = useRef<Socket | null>(null);

  // Floating AI warning toast (image12.png top-center) & Critical Violation Modal (image13.png)
  const [floatingWarning, setFloatingWarning] = useState<{
    open: boolean;
    reason: string;
    count: number | null;
    max: number | null;
  }>({
    open: false,
    reason: '',
    count: null,
    max: null,
  });

  const [isConfirmSubmitOpen, setIsConfirmSubmitOpen] = useState(false);
  const [violationAckChecked, setViolationAckChecked] = useState(false);
  const [violationModal, setViolationModal] = useState<{
    open: boolean;
    title: string;
    eventType: string;
    severity: string;
    reason: string;
    occurredAt: string;
    elapsedMin: number | null;
    snapshotUrl: string | null;
    count: number | null;
    max: number | null;
  }>({
    open: false,
    title: 'CẢNH BÁO VI PHẠM NỘI QUY PHÒNG THI',
    eventType: '',
    severity: 'critical',
    reason: '',
    occurredAt: '',
    elapsedMin: null,
    snapshotUrl: null,
    count: null,
    max: null,
  });

  const [aiStatus, setAiStatus] = useState<AiRuntimeStatus>('connecting');
  const [lastInferenceMs, setLastInferenceMs] = useState<number | null>(null);
  const frameInFlightRef = useRef(false);

  // Proctoring Camera Feed
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameIntervalMsRef = useRef(2000);

  useEffect(() => {
    void loadAttemptData();
    initStudentSocket();
    const removeTabListeners = setupFullscreenAndTabListeners();

    return () => {
      stopWebcam();
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      if (sessionSocketRef.current) {
        sessionSocketRef.current.disconnect();
        sessionSocketRef.current = null;
      }
      Object.values(saveTimersRef.current).forEach(clearTimeout);
      removeTabListeners();
    };
  }, [examId, attemptId]);

  // Hỗ trợ phím mũi tên Trái/Phải chuyển câu nhanh (khi không gõ trong ô văn bản)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (violationModal.open || isConfirmSubmitOpen) return;
      if (e.key === 'ArrowRight') {
        setCurrentQIndex((prev) => Math.min(Math.max(0, questions.length - 1), prev + 1));
      } else if (e.key === 'ArrowLeft') {
        setCurrentQIndex((prev) => Math.max(0, prev - 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [questions.length, violationModal.open, isConfirmSubmitOpen]);

  // Countdown timer
  useEffect(() => {
    remainingSecondsRef.current = remainingSeconds;
    if (remainingSeconds <= 0 && attemptRef.current?.status === 'in_progress') {
      void handleFinalSubmit(true);
      return;
    }
    const timer = setInterval(() => {
      setRemainingSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [remainingSeconds]);

  const applyIncomingSupervisorNotice = (notice?: SupervisorNotice) => {
    if (!notice || !notice.id) return;
    if (seenNoticeIdsRef.current.has(notice.id)) return;
    seenNoticeIdsRef.current.add(notice.id);
    setSupervisorBanner(notice);
  };

  const initStudentSocket = () => {
    const token = useAuthStore.getState().accessToken;
    if (!token || !attemptId) return;
    const socket = io(`${BACKEND_ORIGIN}/exam-session`, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    socket.on('connect', () => {
      socket.emit('join-attempt', Number(attemptId));
    });
    socket.on('supervisor-notice', (notice: SupervisorNotice) => {
      applyIncomingSupervisorNotice(notice);
    });
    socket.on('force-submitted', (payload: { message?: string }) => {
      stopWebcam();
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      alert(payload?.message || 'Giám thị đã thu bài thi của bạn.');
      navigate(`/exam/${examId}/result/${attemptId}`);
    });
    sessionSocketRef.current = socket;
  };

  const canEditAttempt = () =>
    attemptRef.current?.status === 'in_progress' &&
    remainingSecondsRef.current > 0 &&
    !isSubmittingRef.current;

  const setQuestionSaveState = (questionId: string, state: SaveState) => {
    setSaveStates((prev) => ({ ...prev, [questionId]: state }));
  };

  const persistAnswer = async (questionId: string, allowDuringSubmit = false): Promise<boolean> => {
    // Nếu đang có request lưu câu này bay trên mạng, chờ nó xong rồi kiểm tra xem còn bản nháp mới hơn không
    const existingPromise = inFlightSaveRef.current[questionId];
    if (existingPromise) {
      const prevOk = await existingPromise;
      if (!pendingAnswersRef.current[questionId]) return prevOk;
    }

    const canPersist =
      canEditAttempt() ||
      (allowDuringSubmit &&
        attemptRef.current?.status === 'in_progress' &&
        remainingSecondsRef.current > 0);
    if (!canPersist) return false;

    const draft = pendingAnswersRef.current[questionId];
    if (!draft) return true;

    const runSave = async (): Promise<boolean> => {
      setQuestionSaveState(questionId, { status: 'saving' });
      const payload: {
        question_id: string;
        selected_option_ids?: number[];
        answer_text?: string;
        is_flagged?: boolean;
      } = {
        question_id: questionId,
      };
      if (draft.selected_option_ids !== undefined) {
        payload.selected_option_ids = draft.selected_option_ids.map(Number);
      }
      if (draft.answer_text !== undefined) {
        payload.answer_text = draft.answer_text;
      }
      if (draft.is_flagged !== undefined) {
        payload.is_flagged = draft.is_flagged;
      }

      let lastError: unknown;
      for (let attemptNumber = 0; attemptNumber < 3; attemptNumber += 1) {
        const canRetry =
          canEditAttempt() ||
          (allowDuringSubmit &&
            attemptRef.current?.status === 'in_progress' &&
            remainingSecondsRef.current > 0);
        if (!canRetry) return false;
        try {
          await studentExamApi.saveAnswer(attemptId!, payload);
          lastError = undefined;
          break;
        } catch (err) {
          lastError = err;
          if (attemptNumber < 2) {
            await new Promise((resolve) => setTimeout(resolve, 400 * (attemptNumber + 1)));
          }
        }
      }

      if (lastError) {
        setQuestionSaveState(questionId, { status: 'error', message: 'Lưu lỗi' });
        return false;
      }

      const currentPending = pendingAnswersRef.current[questionId];
      if (currentPending && JSON.stringify(currentPending) !== JSON.stringify(draft)) {
        setQuestionSaveState(questionId, { status: 'saving' });
      } else {
        delete pendingAnswersRef.current[questionId];
        setQuestionSaveState(questionId, { status: 'saved' });
        setLastSavedAt(new Date().toLocaleTimeString('vi-VN'));
      }
      return true;
    };

    const promise = runSave().finally(() => {
      delete inFlightSaveRef.current[questionId];
      if (
        pendingAnswersRef.current[questionId] &&
        JSON.stringify(pendingAnswersRef.current[questionId]) !== JSON.stringify(draft)
      ) {
        scheduleAnswerSave(questionId, 80);
      }
    });

    inFlightSaveRef.current[questionId] = promise;
    return promise;
  };

  const scheduleAnswerSave = (questionId: string, delay = 400) => {
    if (!canEditAttempt()) return;
    const existingTimer = saveTimersRef.current[questionId];
    if (existingTimer) clearTimeout(existingTimer);
    saveTimersRef.current[questionId] = setTimeout(() => {
      delete saveTimersRef.current[questionId];
      void persistAnswer(questionId);
    }, delay);
  };

  const queueDraftSave = (questionId: string, patch: AnswerDraft, delay: number) => {
    if (!canEditAttempt()) return;
    pendingAnswersRef.current[questionId] = {
      ...(pendingAnswersRef.current[questionId] || {}),
      ...patch,
    };
    setQuestionSaveState(questionId, { status: 'saving' });
    scheduleAnswerSave(questionId, delay);
  };

  const loadAttemptData = async () => {
    try {
      if (!attemptId) throw new Error('Thiếu mã lần làm bài');
      const response = await studentExamApi.getAttempt(attemptId);
      const loadedAttempt = response.data.data;

      if (loadedAttempt.status === 'submitted') {
        navigate(`/exam/${examId}/result/${attemptId}`, { replace: true });
        return;
      }

      setAttempt(loadedAttempt);
      attemptRef.current = loadedAttempt;
      frameIntervalMsRef.current = Number(
        loadedAttempt.proctoringSettings?.frame_interval_ms ??
          loadedAttempt.proctoringSettings?.frameIntervalMs ??
          2000,
      );

      setQuestions((loadedAttempt.questions ?? []).map(toQuestionItem));
      setRemainingSeconds(loadedAttempt.remainingSeconds ?? 0);
      remainingSecondsRef.current = loadedAttempt.remainingSeconds ?? 0;

      const initialAnswers: Record<string, AnswerDraft> = {};
      const initialFlags: Record<string, boolean> = {};
      loadedAttempt.questions?.forEach((question) => {
        if (question.answer) {
          initialAnswers[String(question.id)] = {
            selected_option_ids: question.answer.selected_option_ids?.map(String),
            answer_text: question.answer.text_answer ?? undefined,
          };
          if (question.answer.is_flagged) {
            initialFlags[String(question.id)] = true;
          }
        }
      });
      setAnswersMap(initialAnswers);
      setFlaggedQuestions(initialFlags);

      if (loadedAttempt.proctoringSettings?.enabled === false) {
        setAiStatus('disabled');
        stopWebcam();
      } else {
        await initWebcam();
      }
    } catch (err) {
      console.error(err);
      setQuestions([]);
    }
  };

  const reportBrowserTelemetry = async (
    eventType: 'tab_hidden' | 'window_blur' | 'fullscreen_exit' | 'camera_lost',
    active: boolean,
  ) => {
    if (!attemptId || attemptRef.current?.status !== 'in_progress') return;
    if (attemptRef.current?.proctoringSettings?.enabled === false) return;
    try {
      const res = await studentExamApi.reportBrowserEvent(attemptId, eventType, active);
      handleFrameResult(res.data.data as FrameResult);
    } catch (err) {
      console.warn('Không gửi được sự kiện trình duyệt:', err);
    }
  };

  const initWebcam = async () => {
    try {
      stopWebcam();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 360 },
        audio: false,
      });
      mediaStreamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.addEventListener('ended', () => {
          setAiStatus('offline');
          setProctoringError('Tín hiệu camera đã bị ngắt! Vui lòng kiểm tra kết nối camera.');
          void reportBrowserTelemetry('camera_lost', true);
        });
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      startPeriodicFrameCapture();
    } catch (err) {
      console.warn('Không thể mở webcam trong lúc thi:', err);
      setAiStatus('offline');
      setProctoringError(
        'Không mở được webcam giám sát. Vui lòng cấp quyền camera cho trình duyệt.',
      );
      void reportBrowserTelemetry('camera_lost', true);
    }
  };

  const stopWebcam = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  };

  const captureSnapshotDataUrl = (): string | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 480;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, 480, 360);
      return canvas.toDataURL('image/jpeg', 0.78);
    } catch {
      return null;
    }
  };

  const startPeriodicFrameCapture = () => {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    frameIntervalRef.current = setInterval(async () => {
      const video = videoRef.current;
      if (!video || !attemptId || frameInFlightRef.current) return;
      if (video.videoWidth === 0 || attemptRef.current?.status !== 'in_progress') return;
      frameInFlightRef.current = true;
      try {
        const canvas = document.createElement('canvas');
        const targetW = Math.min(640, video.videoWidth || 640);
        const targetH = Math.round(targetW * ((video.videoHeight || 480) / (video.videoWidth || 640)));
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, targetW, targetH);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', 0.82),
        );
        if (!blob) return;
        const formData = new FormData();
        formData.append('frame', blob, 'frame.jpg');
        try {
          const res = await studentExamApi.sendTelemetryFrame(attemptId, formData);
          handleFrameResult(res.data.data as FrameResult);
        } catch (e) {
          console.error('Không thể gửi frame giám sát:', e);
          setAiStatus('offline');
          setProctoringError('Mất kết nối tới máy chủ giám sát. Hệ thống sẽ tự động thử lại.');
        }
      } finally {
        frameInFlightRef.current = false;
      }
    }, frameIntervalMsRef.current);
  };

  const handleFrameResult = (result: FrameResult) => {
    if (!result) return;
    if (result.supervisorNotice) {
      applyIncomingSupervisorNotice(result.supervisorNotice);
    }
    if (result.shouldAutoSubmit) {
      stopWebcam();
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      navigate(`/exam/${examId}/result/${attemptId}`);
      return;
    }
    if (result.aiStatus === 'dropped') return;

    setAiStatus(result.aiStatus ?? 'ok');
    if (result.inferenceMs !== undefined) {
      setLastInferenceMs(result.inferenceMs ?? null);
    }

    if (result.aiStatus === 'degraded') {
      setProctoringError(
        result.aiError?.message ??
          'Hệ thống giám sát AI tạm thời gián đoạn. Bài làm của bạn không bị ảnh hưởng.',
      );
    } else {
      setProctoringError(null);
    }

    const warning = result.warnings?.[0];
    if (warning) {
      const summary = result.violationSummary;
      const isCrit = warning.severity === 'critical';
      if (isCrit) {
        setFloatingWarning((prev) => ({ ...prev, open: false }));
        setViolationAckChecked(false);
        const startedMs = attemptRef.current?.started_at
          ? new Date(attemptRef.current.started_at).getTime()
          : null;
        const elapsedMin = startedMs ? Math.max(1, Math.round((Date.now() - startedMs) / 60000)) : null;
        setViolationModal({
          open: true,
          title: 'CẢNH BÁO VI PHẠM NỘI QUY PHÒNG THI',
          eventType: warning.type || '',
          severity: 'critical',
          reason: warning.messageVi || 'Phát hiện hành vi bất thường nghiêm trọng.',
          occurredAt: new Date().toLocaleTimeString('vi-VN'),
          elapsedMin,
          snapshotUrl: captureSnapshotDataUrl(),
          count: summary?.criticalConfirmed ?? null,
          max: summary?.autoSubmitThreshold ?? null,
        });
      } else {
        // Cảnh báo nhẹ / nhắc nhở: hiển thị thẻ nổi phía trên giống image12.png
        setFloatingWarning({
          open: true,
          reason:
            warning.messageVi ||
            'Vui lòng nhìn thẳng vào màn hình và giữ khuôn mặt ổn định trong khu vực làm bài.',
          count: summary?.totalConfirmed ?? null,
          max: summary?.autoSubmitThreshold ?? null,
        });
      }
    }
  };

  const setupFullscreenAndTabListeners = () => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setTabSwitchCount((c) => c + 1);
        void reportBrowserTelemetry('tab_hidden', true);
      } else {
        void reportBrowserTelemetry('tab_hidden', false);
      }
    };
    const handleWindowBlur = () => {
      if (!document.hidden) {
        void reportBrowserTelemetry('window_blur', true);
      }
    };
    const handleWindowFocus = () => {
      void reportBrowserTelemetry('window_blur', false);
    };
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        void reportBrowserTelemetry('fullscreen_exit', true);
      } else {
        void reportBrowserTelemetry('fullscreen_exit', false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  };

  const handleSelectOption = (questionId: string, optionId: string, isMultiple: boolean) => {
    if (!canEditAttempt()) return;
    const current = answersMap[questionId]?.selected_option_ids || [];
    const updated = isMultiple
      ? current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId]
      : [optionId];

    setAnswersMap((prev) => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        selected_option_ids: updated,
      },
    }));

    // Chọn đáp án trắc nghiệm lưu nhanh (120ms) để phản hồi tức thì
    queueDraftSave(questionId, { selected_option_ids: updated }, 120);
  };

  const handleTextAnswerChange = (questionId: string, text: string) => {
    if (!canEditAttempt()) return;
    setAnswersMap((prev) => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        answer_text: text,
      },
    }));
    queueDraftSave(questionId, { answer_text: text }, 450);
  };

  const handleBlurSaveText = (questionId: string) => {
    if (canEditAttempt() && pendingAnswersRef.current[questionId]) {
      scheduleAnswerSave(questionId, 0);
    }
  };

  const toggleFlag = (questionId: string) => {
    if (!canEditAttempt()) return;
    const nextVal = !flaggedQuestions[questionId];
    setFlaggedQuestions((prev) => ({
      ...prev,
      [questionId]: nextVal,
    }));
    queueDraftSave(questionId, { is_flagged: nextVal }, 100);
  };

  const handleFinalSubmit = async (skipSaveErrorCheck = false) => {
    if (!attemptId) return;
    if (isSubmittingRef.current) return;
    setIsSubmitting(true);
    isSubmittingRef.current = true;
    try {
      Object.values(saveTimersRef.current).forEach(clearTimeout);
      saveTimersRef.current = {};

      // Đợi các request đang bay hoàn tất trước rồi flush toàn bộ bản nháp còn lại
      const activeFlights = Object.values(inFlightSaveRef.current);
      if (activeFlights.length > 0) {
        await Promise.all(activeFlights);
      }

      const pendingIds = Object.keys(pendingAnswersRef.current);
      const saveResults = await Promise.all(
        pendingIds.map((questionId) => persistAnswer(questionId, true)),
      );
      if (
        !skipSaveErrorCheck &&
        (saveResults.some((result) => !result) || Object.keys(pendingAnswersRef.current).length > 0)
      ) {
        throw new Error('Một hoặc nhiều câu trả lời chưa được lưu. Vui lòng thử lại.');
      }

      await studentExamApi.submitAttempt(attemptId);
      const submittedAttempt = attemptRef.current
        ? { ...attemptRef.current, status: 'submitted' as const }
        : null;
      if (submittedAttempt) {
        attemptRef.current = submittedAttempt;
        setAttempt(submittedAttempt);
      }
      stopWebcam();
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      navigate(`/exam/${examId}/result/${attemptId}`);
    } catch (err: any) {
      setProctoringError(
        err.response?.data?.error ||
          err.message ||
          'Không thể nộp bài khi câu trả lời chưa được lưu.',
      );
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const retryAnswerSave = (questionId: string) => {
    if (!canEditAttempt()) return;
    const draft = answersMap[questionId];
    const isFlagged = flaggedQuestions[questionId];
    pendingAnswersRef.current[questionId] = {
      ...(draft || {}),
      ...(isFlagged !== undefined ? { is_flagged: isFlagged } : {}),
    };
    scheduleAnswerSave(questionId, 0);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const isQuestionAnswered = (qId: string) => {
    const a = answersMap[qId];
    return Boolean(
      (a?.selected_option_ids && a.selected_option_ids.length > 0) ||
        (a?.answer_text && a.answer_text.trim().length > 0),
    );
  };

  const currentQ = questions[currentQIndex] || questions[0];
  const answeredCount = questions.filter((q) => isQuestionAnswered(q.id)).length;
  const unansweredItems = questions
    .map((q, idx) => ({ q, idx }))
    .filter(({ q }) => !isQuestionAnswered(q.id));
  const flaggedItems = questions
    .map((q, idx) => ({ q, idx }))
    .filter(({ q }) => Boolean(flaggedQuestions[q.id]));

  const progressPct =
    questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0;
  const questionStepPct =
    questions.length > 0 ? Math.round(((currentQIndex + 1) / questions.length) * 100) : 0;

  const studentName =
    attempt?.student_name || attempt?.exam?.student_name || 'Thí sinh dự thi';
  const studentLoginId = attempt?.login_id || attempt?.exam?.login_id || '';
  const examTitle = attempt?.exam?.name || attempt?.exam?.title || 'Kỳ thi trực tuyến';
  const examDurationMin = attempt?.exam?.duration_minutes ?? 60;
  const intervalSecLabel = (frameIntervalMsRef.current / 1000).toFixed(1);

  return (
    <div className="exam-taking-fullscreen-layout">
      {/* Banner thông báo trực tiếp từ giám thị coi thi */}
      {supervisorBanner && (
        <div
          className={`et-supervisor-banner ${
            supervisorBanner.scope === 'direct' ? 'is-direct' : 'is-broadcast'
          }`}
        >
          <div className="et-supervisor-banner-left">
            <FiVolume2 size={18} />
            <span>
              <strong>
                {supervisorBanner.scope === 'direct'
                  ? '[NHẮC NHỞ RIÊNG TỪ GIÁM THỊ]: '
                  : '[THÔNG BÁO PHÒNG THI]: '}
              </strong>
              {supervisorBanner.message}
            </span>
          </div>
          <button
            type="button"
            className="et-supervisor-ack-btn"
            onClick={() => setSupervisorBanner(null)}
          >
            Đã hiểu
          </button>
        </div>
      )}

      {/* Top Fixed Header Bar (Khớp UI/image12.png) */}
      <header className="et-topbar">
        <div className="et-topbar-left">
          <div className="et-brand">
            <div className="et-brand-logo">
              <FiShield size={19} />
            </div>
            <div className="et-brand-text">
              <span>Elearning</span>
              <span>Exam</span>
            </div>
          </div>

          <div className="et-topbar-divider" />

          <div className="et-exam-meta">
            <h1 className="et-exam-title">{examTitle}</h1>
            <div className="et-student-sub">
              <span className="et-online-dot" />
              <span>
                Thí sinh: <strong>{studentName}</strong>
                {studentLoginId ? ` (${studentLoginId})` : ''}
              </span>
            </div>
          </div>
        </div>

        <div className="et-topbar-right">
          {/* AI Camera & Network Status Pill */}
          <div className="et-ai-capsule">
            <span className="et-ai-capsule-item">
              <FiVideo size={14} />
              <span>Camera AI</span>
            </span>
            <span className="et-capsule-dot">•</span>
            <span className="et-ai-capsule-item">
              <FiWifi size={14} />
              <span>{aiStatus === 'offline' ? 'Gián đoạn' : 'Ổn định'}</span>
            </span>
            <span
              className={`et-ai-state-pill ${
                aiStatus === 'ok'
                  ? 'state-ok'
                  : aiStatus === 'disabled'
                    ? 'state-off'
                    : 'state-warn'
              }`}
            >
              {aiStatus === 'ok'
                ? 'Đang giám sát'
                : aiStatus === 'disabled'
                  ? 'Tắt AI'
                  : aiStatus === 'connecting'
                    ? 'Đang kết nối'
                    : 'Tạm gián đoạn'}
            </span>
          </div>

          {/* Answered Progress Pill */}
          <div className="et-progress-pill">
            <FiList size={14} />
            <span>
              {answeredCount}/{questions.length} câu
            </span>
          </div>

          {/* Countdown Timer Pill */}
          <div className={`et-timer-pill ${remainingSeconds <= 300 ? 'is-urgent' : ''}`}>
            <FiClock size={16} />
            <span>{formatTime(remainingSeconds)}</span>
          </div>

          {/* Submit Exam Button */}
          <button
            type="button"
            className="et-top-submit-btn"
            onClick={() => setIsConfirmSubmitOpen(true)}
            disabled={attempt?.status !== 'in_progress' || remainingSeconds <= 0 || isSubmitting}
          >
            <FiSend size={15} />
            <span>Nộp bài</span>
          </button>

          {/* Student Avatar Icon */}
          <div className="et-user-avatar" title={studentName}>
            <FiUser size={16} />
          </div>
        </div>
      </header>

      {/* Floating Non-Blocking AI Warning Toast (Khớp UI/image12.png góc trên giữa) */}
      {floatingWarning.open && (
        <div className="et-floating-ai-toast" role="alert">
          <div className="et-toast-icon-box">
            <FiAlertTriangle size={20} />
          </div>
          <div className="et-toast-body">
            <div className="et-toast-title-row">
              <strong>Cảnh báo Giám sát AI</strong>
              {floatingWarning.count !== null && (
                <span className="et-toast-count-pill">
                  Vi phạm {floatingWarning.count}
                  {floatingWarning.max !== null ? `/${floatingWarning.max}` : ''}
                </span>
              )}
            </div>
            <p className="et-toast-desc">{floatingWarning.reason}</p>
            <div className="et-toast-actions">
              <button
                type="button"
                className="et-toast-ack-btn"
                onClick={() => setFloatingWarning((prev) => ({ ...prev, open: false }))}
              >
                <FiCheckCircle size={14} /> Tôi đã hiểu & tiếp tục
              </button>
              {floatingWarning.max !== null && (
                <span className="et-toast-rule-note">
                  <FiLock size={12} /> Tự động thu bài sau {floatingWarning.max} lần nghiêm trọng
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="et-toast-close"
            onClick={() => setFloatingWarning((prev) => ({ ...prev, open: false }))}
            aria-label="Đóng cảnh báo"
          >
            <FiX size={16} />
          </button>
        </div>
      )}

      {/* Main Split Workspace */}
      <main className="et-workspace-grid">
        {/* Left Column: Question Card + Cloud Sync Footer */}
        <section className="et-question-column">
          {!questions.length ? (
            <div className="exam-empty-state">
              <FiAlertTriangle size={28} />
              <h3>Chưa tải được nội dung bài thi</h3>
              <p>Đề thi chưa có câu hỏi hoặc phiên làm bài không còn hợp lệ.</p>
              <button
                type="button"
                className="exam-btn exam-btn-secondary"
                onClick={() => navigate(-1)}
              >
                Quay lại danh sách đề
              </button>
            </div>
          ) : (
            currentQ && (
              <>
                <div className="et-question-card">
                  {/* Thanh tiến độ tím sát mép trên thẻ câu hỏi giống image12.png */}
                  <div className="et-card-top-progress">
                    <div
                      className="et-card-top-progress-fill"
                      style={{ width: `${questionStepPct}%` }}
                    />
                  </div>

                  <div className="et-question-card-inner">
                    {/* Top Meta Badges & Flag Button */}
                    <div className="et-q-header-row">
                      <div className="et-q-badges">
                        <span className="et-q-index-pill">
                          Câu {currentQIndex + 1} / {questions.length}
                        </span>
                        <span className={`et-q-diff-pill diff-${currentQ.difficulty}`}>
                          {currentQ.difficulty === 'easy'
                            ? 'Dễ'
                            : currentQ.difficulty === 'medium'
                              ? 'Trung bình'
                              : 'Khó'}{' '}
                          ({currentQ.points} điểm)
                        </span>
                        <span className="et-q-topic-pill">
                          {currentQ.chapter ||
                            (currentQ.type === 'multiple_choice'
                              ? 'Chọn nhiều đáp án'
                              : currentQ.type === 'single_choice'
                                ? 'Trắc nghiệm 1 đáp án'
                                : currentQ.type === 'code'
                                  ? 'Tự luận / Mã nguồn'
                                  : 'Tự luận')}
                        </span>
                      </div>

                      <button
                        type="button"
                        className={`et-flag-btn ${
                          flaggedQuestions[currentQ.id] ? 'is-flagged' : ''
                        }`}
                        onClick={() => toggleFlag(currentQ.id)}
                        disabled={!canEditAttempt()}
                      >
                        <FiFlag size={14} />
                        <span>
                          {flaggedQuestions[currentQ.id]
                            ? 'Đã đánh dấu xem lại'
                            : 'Đánh dấu xem lại'}
                        </span>
                      </button>
                    </div>

                    {/* Question Content */}
                    <div className="et-q-prompt-block">
                      <h2 className="et-q-title">{currentQ.content}</h2>
                      <p className="et-q-instruction">
                        {currentQ.type === 'single_choice' &&
                          'Chọn phương án chính xác nhất bên dưới. Đáp án được lưu tự động ngay khi chọn.'}
                        {currentQ.type === 'multiple_choice' &&
                          'Câu hỏi nhiều lựa chọn — bạn có thể tích chọn nhiều hơn một phương án đúng.'}
                        {(currentQ.type === 'essay' || currentQ.type === 'code') &&
                          'Nhập câu trả lời chi tiết vào khung bên dưới. Hệ thống tự động đồng bộ bài làm theo thời gian thực.'}
                      </p>
                    </div>

                    {/* Answer Options or Editor */}
                    {currentQ.type === 'single_choice' || currentQ.type === 'multiple_choice' ? (
                      <div className="et-options-stack">
                        {currentQ.options.map((opt, oIdx) => {
                          const isSelected = Boolean(
                            answersMap[currentQ.id]?.selected_option_ids?.includes(opt.id),
                          );
                          const letter = String.fromCharCode(65 + oIdx);
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              className={`et-option-item ${isSelected ? 'is-selected' : ''}`}
                              onClick={() =>
                                handleSelectOption(
                                  currentQ.id,
                                  opt.id,
                                  currentQ.type === 'multiple_choice',
                                )
                              }
                              disabled={!canEditAttempt()}
                            >
                              <span className="et-option-letter">{letter}</span>
                              <span className="et-option-text">{opt.content}</span>
                              <span
                                className={`et-option-check ${
                                  currentQ.type === 'multiple_choice' ? 'is-square' : 'is-circle'
                                }`}
                              >
                                {isSelected && <FiCheck size={13} strokeWidth={3} />}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : currentQ.type === 'code' ? (
                      <div className="et-editor-box is-code">
                        <div className="et-editor-header">
                          <FiCode size={15} />
                          <span>Trình soạn thảo mã nguồn / Lời giải kỹ thuật</span>
                        </div>
                        <textarea
                          rows={12}
                          className="et-code-textarea"
                          placeholder="// Nhập mã nguồn hoặc lời giải kỹ thuật của bạn tại đây..."
                          value={answersMap[currentQ.id]?.answer_text || ''}
                          onChange={(e) => handleTextAnswerChange(currentQ.id, e.target.value)}
                          onBlur={() => handleBlurSaveText(currentQ.id)}
                          readOnly={!canEditAttempt()}
                        />
                      </div>
                    ) : (
                      <div className="et-editor-box">
                        <div className="et-editor-header">
                          <FiFileText size={15} />
                          <span>Bài làm tự luận</span>
                        </div>
                        <textarea
                          rows={10}
                          className="et-essay-textarea"
                          placeholder="Nhập câu trả lời tự luận chi tiết của bạn tại đây..."
                          value={answersMap[currentQ.id]?.answer_text || ''}
                          onChange={(e) => handleTextAnswerChange(currentQ.id, e.target.value)}
                          onBlur={() => handleBlurSaveText(currentQ.id)}
                          readOnly={!canEditAttempt()}
                        />
                      </div>
                    )}

                    {/* Bottom Prev / Save / Next Controls (Khớp UI/image12.png) */}
                    <div className="et-q-footer-nav">
                      <button
                        type="button"
                        className="et-btn-prev"
                        disabled={currentQIndex === 0}
                        onClick={() => setCurrentQIndex((prev) => Math.max(0, prev - 1))}
                      >
                        <FiArrowLeft size={16} />
                        <span>Câu trước</span>
                      </button>

                      <div className="et-q-footer-right">
                        {saveStates[currentQ.id]?.status === 'saving' && (
                          <span className="et-save-chip is-saving">Đang lưu...</span>
                        )}
                        {saveStates[currentQ.id]?.status === 'saved' && (
                          <span className="et-save-chip is-saved">✓ Đã lưu</span>
                        )}
                        {saveStates[currentQ.id]?.status === 'error' && (
                          <button
                            type="button"
                            className="et-save-retry-btn"
                            onClick={() => retryAnswerSave(currentQ.id)}
                          >
                            Lưu lỗi — Bấm thử lại
                          </button>
                        )}

                        <button
                          type="button"
                          className="et-btn-temp-save"
                          onClick={() => {
                            if (pendingAnswersRef.current[currentQ.id]) {
                              void persistAnswer(currentQ.id);
                            } else if (isQuestionAnswered(currentQ.id)) {
                              retryAnswerSave(currentQ.id);
                            }
                          }}
                          disabled={!canEditAttempt()}
                        >
                          <FiSave size={15} />
                          <span>Lưu tạm thời</span>
                        </button>

                        {currentQIndex < questions.length - 1 ? (
                          <button
                            type="button"
                            className="et-btn-next"
                            onClick={() =>
                              setCurrentQIndex((prev) => Math.min(questions.length - 1, prev + 1))
                            }
                          >
                            <span>Câu tiếp theo</span>
                            <FiArrowRight size={16} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="et-btn-next"
                            onClick={() => setIsConfirmSubmitOpen(true)}
                          >
                            <span>Kiểm tra & Nộp bài</span>
                            <FiArrowRight size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom Cloud Sync Bar (Khớp UI/image12.png) */}
                <div className="et-cloud-sync-bar">
                  <div className="et-sync-left">
                    <FiCloud size={16} className="et-sync-cloud-icon" />
                    <span>
                      {lastSavedAt ? (
                        <>
                          Tất cả thay đổi được tự động đồng bộ lên máy chủ lúc{' '}
                          <strong>{lastSavedAt}</strong>
                        </>
                      ) : (
                        'Chế độ tự động lưu đáp án theo thời gian thực đang hoạt động'
                      )}
                    </span>
                  </div>
                  <div className="et-sync-right">
                    {lastInferenceMs !== null && (
                      <span className="et-sync-metric">
                        <i className="et-green-dot" /> Độ trễ AI: {Math.round(lastInferenceMs)}ms
                      </span>
                    )}
                    <span className="et-sync-shield">
                      <FiShield size={13} /> Phiên làm bài được bảo vệ
                    </span>
                  </div>
                </div>
              </>
            )
          )}
        </section>

        {/* Right Sidebar: AI Proctor Vision + Question Matrix + Exam Rules (Khớp UI/image12.png) */}
        <aside className="et-sidebar-column">
          {/* Card 1: AI Proctor Vision HUD */}
          <div className="et-proctor-card">
            <div className="et-proctor-card-head">
              <span className="et-proctor-head-title">
                <i className={`et-live-dot ${aiStatus === 'ok' ? 'is-ok' : ''}`} />
                AI PROCTOR VISION
              </span>
              <span className="et-proctor-head-lock">
                <FiLock size={12} /> {aiStatus === 'disabled' ? 'Tắt' : 'Bắt buộc'}
              </span>
            </div>

            <div className="et-proctor-video-wrap">
              {aiStatus !== 'disabled' ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="et-proctor-video"
                />
              ) : (
                <div className="et-proctor-disabled-box">
                  <FiShield size={28} />
                  <span>Đề thi không yêu cầu mở Camera AI</span>
                </div>
              )}

              {aiStatus !== 'disabled' && (
                <>
                  <div className="et-video-hud-top">
                    <span className={`et-hud-tracking-badge status-${aiStatus}`}>
                      {aiStatus === 'ok' && 'Tracking: ACTIVE'}
                      {aiStatus === 'connecting' && 'Tracking: CONNECTING'}
                      {aiStatus === 'degraded' && 'Tracking: DEGRADED'}
                      {aiStatus === 'offline' && 'Tracking: OFFLINE'}
                    </span>
                    <span className="et-hud-cycle-badge">Chu kỳ: {intervalSecLabel}s</span>
                  </div>

                  {/* 4 góc khung nhận diện khuôn mặt giống image12.png */}
                  <div className="et-face-guide-box">
                    <span className="corner tl" />
                    <span className="corner tr" />
                    <span className="corner bl" />
                    <span className="corner br" />
                    {aiStatus === 'ok' && (
                      <div className="et-face-name-tag">{studentName}</div>
                    )}
                  </div>

                  <div className="et-video-hud-bottom">
                    <span className="hud-ok">
                      Face: {aiStatus === 'ok' ? 'Detected' : 'Checking...'}
                    </span>
                    <span>
                      AI: {lastInferenceMs !== null ? `${Math.round(lastInferenceMs)}ms` : '--'}
                    </span>
                    <span>Tab: {tabSwitchCount}</span>
                  </div>
                </>
              )}
            </div>

            <div className="et-proctor-card-foot">
              <span>
                <FiInfo size={13} />{' '}
                {aiStatus === 'disabled'
                  ? 'Chế độ thi tiêu chuẩn'
                  : 'Không thể tắt webcam theo điều lệ khảo thí'}
              </span>
              <strong className="et-secure-label">Bảo mật</strong>
            </div>
          </div>

          {/* Card 2: Question Navigator Grid */}
          <div className="et-nav-card">
            <div className="et-nav-card-head">
              <div className="et-nav-title-group">
                <h3>Danh sách câu hỏi</h3>
                <span className="et-nav-count-badge">{questions.length} câu</span>
              </div>
              <span className="et-nav-mini-time">Thời gian còn {formatTime(remainingSeconds)}</span>
            </div>

            <div className="et-nav-legend-box">
              <div className="et-legend-cell">
                <span className="et-swatch is-answered" />
                <span>Đã làm ({answeredCount})</span>
              </div>
              <div className="et-legend-cell">
                <span className="et-swatch is-unanswered" />
                <span>Chưa làm ({unansweredItems.length})</span>
              </div>
              <div className="et-legend-cell">
                <span className="et-swatch is-flagged">⚑</span>
                <span>Xem lại ({flaggedItems.length})</span>
              </div>
              <div className="et-legend-cell">
                <span className="et-swatch is-current">
                  {String(currentQIndex + 1).padStart(2, '0')}
                </span>
                <span>Đang mở</span>
              </div>
            </div>

            <div
              className={`et-matrix-grid ${
                questions.length > 24 ? 'cols-8' : 'cols-6'
              }`}
            >
              {questions.map((q, idx) => {
                const isCurrent = idx === currentQIndex;
                const isAnswered = isQuestionAnswered(q.id);
                const isFlagged = Boolean(flaggedQuestions[q.id]);

                const cls = [
                  'et-matrix-cell',
                  isAnswered ? 'is-answered' : 'is-unanswered',
                  isFlagged ? 'is-flagged' : '',
                  isCurrent ? 'is-current' : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <button
                    key={q.id}
                    type="button"
                    className={cls}
                    onClick={() => setCurrentQIndex(idx)}
                  >
                    {String(idx + 1).padStart(2, '0')}
                    {isFlagged && <i className="et-cell-flag-dot" />}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className="et-sidebar-submit-btn"
              onClick={() => setIsConfirmSubmitOpen(true)}
              disabled={attempt?.status !== 'in_progress' || remainingSeconds <= 0 || isSubmitting}
            >
              <FiCheckCircle size={16} />
              <span>
                Nộp bài thi ({answeredCount}/{questions.length} câu đã làm)
              </span>
            </button>
          </div>

          {/* Card 3: Online Exam Rules */}
          <div className="et-rules-card">
            <h4 className="et-rules-title">
              <FiList size={15} />
              <span>Quy chế thi trực tuyến</span>
            </h4>
            <ul className="et-rules-list">
              <li>Không chuyển đổi tab hoặc rời khỏi cửa sổ làm bài.</li>
              <li>Đảm bảo khuôn mặt luôn nằm trọn trong khung camera.</li>
              <li>Hệ thống tự động thu bài khi hết {examDurationMin} phút làm bài.</li>
            </ul>
          </div>
        </aside>
      </main>

      {/* Non-violation AI/network status toast */}
      {proctoringError && (
        <div className="exam-proctoring-error" role="status">
          <FiAlertTriangle size={16} />
          <span>{proctoringError}</span>
          <button
            type="button"
            onClick={() => setProctoringError(null)}
            aria-label="Đóng thông báo"
          >
            ×
          </button>
        </div>
      )}

      {/* MODAL 1: Critical Violation Alert Modal (Khớp UI/image13.png) */}
      {violationModal.open && (
        <div className="exam-modal-overlay red-alert-overlay">
          <div className="et-crit-modal">
            <div className="et-crit-modal-topbar">
              <div className="et-crit-topbar-left">
                <span className="et-crit-pulse-dot" />
                <strong>{violationModal.title}</strong>
              </div>
              <span className="et-crit-level-tag">NGHIÊM TRỌNG</span>
            </div>

            <div className="et-crit-modal-body">
              <div className="et-crit-heading-row">
                <div className="et-crit-alert-icon">
                  <FiAlertTriangle size={24} />
                </div>
                <div>
                  <h3>Hệ thống AI Proctoring phát hiện hành vi bất thường nghiêm trọng</h3>
                  <p>
                    Sự kiện vi phạm đã được ghi nhận tự động và truyền trực tiếp tới giám thị coi thi.
                  </p>
                </div>
              </div>

              <div className="et-crit-kv-box">
                <div className="et-crit-kv-row">
                  <span>Loại vi phạm:</span>
                  <strong className="text-red">{violationModal.reason.toUpperCase()}</strong>
                </div>
                {violationModal.count !== null && (
                  <div className="et-crit-kv-row">
                    <span>Mức độ cảnh cáo:</span>
                    <strong className="text-red">
                      Nghiêm trọng — Vi phạm lần {violationModal.count}
                      {violationModal.max !== null ? ` / ${violationModal.max}` : ''}
                    </strong>
                  </div>
                )}
                <div className="et-crit-kv-row">
                  <span>Thời điểm ghi nhận:</span>
                  <strong>
                    {violationModal.occurredAt}
                    {violationModal.elapsedMin !== null
                      ? ` (Phút thứ ${violationModal.elapsedMin} của bài thi)`
                      : ''}
                  </strong>
                </div>
              </div>

              {violationModal.snapshotUrl && (
                <div className="et-crit-evidence-card">
                  <div className="et-crit-ev-thumb">
                    <img src={violationModal.snapshotUrl} alt="Ảnh bằng chứng từ webcam" />
                    <span className="et-ev-badge-red">AI DETECTION</span>
                  </div>
                  <div className="et-crit-ev-info">
                    <strong>
                      <FiCamera size={14} /> Bằng chứng ghi nhận (Attempt #{attemptId})
                    </strong>
                    <p>
                      Hình ảnh tại thời điểm phát hiện vi phạm đã được lưu trữ bảo mật phục vụ đối
                      soát hậu kiểm của giảng viên phụ trách.
                    </p>
                    <span className="et-ev-saved-pill">✓ Đã đồng bộ lên máy chủ giám thị</span>
                  </div>
                </div>
              )}

              {violationModal.max !== null && (
                <div className="et-crit-warn-callout">
                  <div>
                    • Hệ thống đã tự động chụp lại hình ảnh vi phạm và gửi trực tiếp đến giám thị phòng thi.
                  </div>
                  <strong>
                    ⚠ CẢNH BÁO: Nếu đạt đủ {violationModal.max} lần vi phạm nghiêm trọng, hệ thống
                    sẽ NGAY LẬP TỨC ĐÌNH CHỈ THI VÀ TỰ ĐỘNG NỘP BÀI của bạn!
                  </strong>
                </div>
              )}

              <label className="et-crit-ack-check">
                <input
                  type="checkbox"
                  checked={violationAckChecked}
                  onChange={(e) => setViolationAckChecked(e.target.checked)}
                />
                <span>
                  Tôi cam kết khắc phục ngay hành vi vi phạm, tuân thủ nghiêm quy chế phòng thi và
                  chịu trách nhiệm trước hội đồng khảo thí.
                </span>
              </label>

              <div className="et-crit-footer">
                <span className="et-crit-timer-note">
                  <FiClock size={13} /> Thời gian thi vẫn tiếp tục đếm ngược
                </span>
                <button
                  type="button"
                  className="et-crit-confirm-btn"
                  disabled={!violationAckChecked}
                  onClick={() => setViolationModal({ ...violationModal, open: false })}
                >
                  <FiCheckCircle size={15} />
                  <span>
                    {violationAckChecked
                      ? 'Tôi đã hiểu & tiếp tục làm bài'
                      : 'Vui lòng tích xác nhận cam kết'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Submission Confirmation Modal (Khớp UI/image14.png) */}
      {isConfirmSubmitOpen && (
        <div className="exam-modal-overlay">
          <div className="et-submit-modal">
            <div className="et-submit-hero">
              <div>
                <span className="et-submit-pill">✓ Xác nhận hoàn tất phiên thi</span>
                <h3>Xác nhận nộp bài thi</h3>
                <p>{examTitle}</p>
              </div>
              <button
                type="button"
                className="et-submit-close"
                onClick={() => setIsConfirmSubmitOpen(false)}
              >
                <FiX size={20} />
              </button>
            </div>

            <div className="et-submit-body">
              <div className="et-submit-stats-grid">
                <div className="et-submit-stat-card">
                  <div>
                    <div className="et-stat-label">TIẾN ĐỘ BÀI LÀM</div>
                    <div className="et-stat-big-indigo">
                      {answeredCount} <small>/ {questions.length} câu</small>
                    </div>
                    <span className="et-stat-green-tag">Đạt {progressPct}% khối lượng</span>
                  </div>
                  <div className="et-mini-ring">
                    <span>{progressPct}%</span>
                  </div>
                </div>

                <div className="et-submit-stat-card">
                  <div>
                    <div className="et-stat-label">THỜI GIAN CÒN LẠI</div>
                    <div className="et-stat-big-red">{formatTime(remainingSeconds)}</div>
                    <span className="et-stat-muted-sub">
                      {remainingSeconds > 60
                        ? 'Vẫn còn thời gian kiểm tra kỹ'
                        : 'Sắp hết thời gian làm bài'}
                    </span>
                  </div>
                  <div className="et-mini-clock-box">
                    <FiClock size={20} />
                  </div>
                </div>
              </div>

              {(unansweredItems.length > 0 || flaggedItems.length > 0) && (
                <>
                  <div className="et-submit-warn-box">
                    <div className="et-submit-warn-icon">
                      <FiAlertTriangle size={18} />
                    </div>
                    <div>
                      <strong>Cảnh báo: Bạn còn câu hỏi cần lưu ý!</strong>
                      <p>
                        Hiện tại bạn còn <strong>{unansweredItems.length} câu chưa trả lời</strong>{' '}
                        và <strong>{flaggedItems.length} câu đang gắn cờ xem lại</strong>. Các câu
                        chưa chọn đáp án sẽ không có điểm.
                      </p>
                    </div>
                  </div>

                  <div className="et-attention-header">
                    <strong>Danh sách cần lưu ý xử lý:</strong>
                    <span>
                      {unansweredItems.length + flaggedItems.length} vị trí cần kiểm tra
                    </span>
                  </div>

                  <div className="et-attention-grid">
                    {unansweredItems.slice(0, 6).map(({ q, idx }) => (
                      <div key={`u-${q.id}`} className="et-attention-card is-unanswered">
                        <div>
                          <strong>● Câu {idx + 1}</strong>
                          <small>Chưa làm</small>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setCurrentQIndex(idx);
                            setIsConfirmSubmitOpen(false);
                          }}
                        >
                          Làm ngay →
                        </button>
                      </div>
                    ))}
                    {flaggedItems.slice(0, 6).map(({ q, idx }) => (
                      <div key={`f-${q.id}`} className="et-attention-card is-flagged">
                        <div>
                          <strong>⚑ Câu {idx + 1}</strong>
                          <small>Đang gắn cờ</small>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setCurrentQIndex(idx);
                            setIsConfirmSubmitOpen(false);
                          }}
                        >
                          Kiểm tra ✎
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="et-submit-security-strip">
                <div className="et-sec-top">
                  <span>THÔNG TIN GIÁM SÁT BẢO MẬT</span>
                  <strong className={aiStatus === 'ok' ? 'ok' : ''}>
                    ●{' '}
                    {aiStatus === 'ok'
                      ? 'Dữ liệu AI hợp lệ'
                      : aiStatus === 'disabled'
                        ? 'Không bật AI'
                        : 'Đang ghi nhận'}
                  </strong>
                </div>
                <div className="et-sec-metrics">
                  <span>🛡 Khuôn mặt: {aiStatus === 'disabled' ? 'Tắt' : 'Đã xác thực'}</span>
                  <span>🗔 Chuyển tab: {tabSwitchCount} lần</span>
                  <span>
                    ⚡ Xử lý AI:{' '}
                    {lastInferenceMs !== null ? `${Math.round(lastInferenceMs)}ms` : '--'}
                  </span>
                </div>
              </div>

              <div className="et-submit-policy-note">
                <FiShield size={16} />
                <span>
                  <strong>Lưu ý quy chế thi cử:</strong> Sau khi bấm xác nhận nộp bài, hệ thống sẽ
                  tự động đóng phiên thi và khóa toàn bộ quyền chỉnh sửa đáp án. Thao tác này không
                  thể hoàn tác.
                </span>
              </div>

              <div className="et-submit-footer">
                <button
                  type="button"
                  className="et-btn-prev"
                  onClick={() => setIsConfirmSubmitOpen(false)}
                >
                  <FiArrowLeft size={15} />
                  <span>Quay lại tiếp tục làm bài</span>
                </button>
                <button
                  type="button"
                  className="et-btn-confirm-final"
                  onClick={() => void handleFinalSubmit(false)}
                  disabled={isSubmitting}
                >
                  <span>{isSubmitting ? 'Đang nộp bài...' : 'Đồng ý nộp bài thi'}</span>
                  <FiSend size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
