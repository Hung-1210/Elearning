import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import {
  FiArrowLeft,
  FiVideo,
  FiVideoOff,
  FiUsers,
  FiAlertTriangle,
  FiCheckCircle,
  FiClock,
  FiVolume2,
  FiVolumeX,
  FiRadio,
  FiLock,
  FiRefreshCw,
  FiSend,
  FiSearch,
  FiActivity,
  FiShield,
} from 'react-icons/fi';
import { examApi, classApi, BACKEND_ORIGIN } from '../../api';
import type { ClassInfo } from '../../types';
import Sidebar from '../../components/layout/Sidebar';
import { useLayoutStore } from '../../store/layoutStore';
import { useAuthStore } from '../../store/authStore';
import './exam.css';

interface MonitorExamInfo {
  id: number;
  class_id: number;
  class_name: string;
  name: string;
  title?: string;
  duration_minutes: number;
  start_time: string;
  end_time: string;
  status: string;
  total_enrolled: number;
  total_questions: number;
  proctoring_enabled: boolean;
  frame_interval_ms: number;
}

interface MonitorSummary {
  total_enrolled: number;
  in_progress_count: number;
  submitted_count: number;
  warning_count: number;
  ai_error_total: number;
}

interface CandidateFeed {
  attempt_id: string;
  student_id: string;
  student_name: string;
  student_code: string;
  attempt_status: 'in_progress' | 'submitted';
  submit_reason?: string | null;
  camera_active: boolean;
  camera_stale: boolean;
  has_snapshot: boolean;
  last_frame_at?: string | null;
  status: 'normal' | 'warning' | 'critical';
  violation_count: number;
  last_violation_type?: string | null;
  last_violation_label?: string;
  start_time: string;
  submitted_at?: string | null;
  progress_answered: number;
  total_questions: number;
  frame_count?: number;
  ai_error_count?: number;
}

interface LiveAlertItem {
  id: string;
  attempt_id?: string;
  timestamp: string;
  student_name: string;
  student_code: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export const LiveMonitorPage: React.FC = () => {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const { sidebarCollapsed } = useLayoutStore();

  const [allClasses, setAllClasses] = useState<ClassInfo[]>([]);
  const [exam, setExam] = useState<MonitorExamInfo | null>(null);
  const [summary, setSummary] = useState<MonitorSummary>({
    total_enrolled: 0,
    in_progress_count: 0,
    submitted_count: 0,
    warning_count: 0,
    ai_error_total: 0,
  });
  const [candidates, setCandidates] = useState<CandidateFeed[]>([]);
  const [alerts, setAlerts] = useState<LiveAlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [socketConnected, setSocketConnected] = useState(false);

  const [filterTab, setFilterTab] = useState<'all' | 'warning' | 'online' | 'submitted'>('all');
  const [alertSearch, setAlertSearch] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [inlineBroadcastText, setInlineBroadcastText] = useState('');
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [broadcastModalOpen, setBroadcastModalOpen] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [warnTarget, setWarnTarget] = useState<CandidateFeed | null>(null);
  const [warnMessage, setWarnMessage] = useState('Vui lòng tập trung nhìn thẳng vào màn hình làm bài!');
  const [sendingWarn, setSendingWarn] = useState(false);
  const [toastNotice, setToastNotice] = useState<string | null>(null);

  const [aiStatusInfo, setAiStatusInfo] = useState<{
    ready: boolean;
    p50Ms: number | null;
    p95Ms: number | null;
    degradedDetail: string | null;
  }>({ ready: true, p50Ms: null, p95Ms: null, degradedDetail: null });

  // Blob URL cache cho snapshot riêng tư của từng attempt (revoke để không rò rỉ bộ nhớ)
  const [snapshotUrls, setSnapshotUrls] = useState<Record<string, string>>({});
  const snapshotUrlsRef = useRef<Record<string, string>>({});
  const snapshotLastFetchRef = useRef<Record<string, number>>({});
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const socketRef = useRef<Socket | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastNotice(msg);
    window.setTimeout(() => {
      setToastNotice((cur) => (cur === msg ? null : cur));
    }, 3500);
  }, []);

  const playAlertBeep = useCallback((isCritical: boolean) => {
    if (!soundEnabledRef.current) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = isCritical ? 'sawtooth' : 'sine';
      osc.frequency.value = isCritical ? 880 : 620;
      gain.gain.value = 0.06;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (isCritical ? 0.22 : 0.12));
      osc.onended = () => ctx.close().catch(() => {});
    } catch {
      // Trình duyệt chưa cho phép phát âm thanh tự động
    }
  }, []);

  const refreshAttemptSnapshot = useCallback(async (attemptId: string, force = false) => {
    const now = Date.now();
    const lastFetch = snapshotLastFetchRef.current[attemptId] ?? 0;
    if (!force && now - lastFetch < 3200) return;
    snapshotLastFetchRef.current[attemptId] = now;
    try {
      const res = await examApi.fetchLiveSnapshotBlob(attemptId);
      if (!res.data || res.data.size === 0) return;
      const nextUrl = URL.createObjectURL(res.data);
      const prevUrl = snapshotUrlsRef.current[attemptId];
      snapshotUrlsRef.current[attemptId] = nextUrl;
      if (prevUrl) URL.revokeObjectURL(prevUrl);
      setSnapshotUrls((prev) => ({ ...prev, [attemptId]: nextUrl }));
    } catch {
      // Chưa có ảnh chụp cho thí sinh này
    }
  }, []);

  const fetchAiTelemetry = useCallback(async () => {
    try {
      const res = await examApi.getAiStatus();
      const data = res.data?.data;
      const ready = Boolean(data?.readiness?.ready);
      const latency = data?.readiness?.payload?.latency_ms ?? null;
      const p50 = typeof latency?.p50 === 'number' ? Math.round(latency.p50) : null;
      const p95 = typeof latency?.p95 === 'number' ? Math.round(latency.p95) : null;
      setAiStatusInfo((prev) => ({
        ready,
        p50Ms: p50,
        p95Ms: p95,
        degradedDetail: ready ? null : (data?.readiness?.reason ?? prev.degradedDetail ?? 'AI chưa sẵn sàng'),
      }));
    } catch {
      setAiStatusInfo((prev) => ({ ...prev, ready: false }));
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    if (!examId) return;
    try {
      const res = await examApi.getLiveMonitor(examId);
      const payload = res.data?.data;
      const nextExam: MonitorExamInfo | null = payload?.exam || null;
      const nextCandidates: CandidateFeed[] = payload?.candidates || [];
      setExam(nextExam);
      if (payload?.summary) {
        setSummary(payload.summary);
      }
      setCandidates(nextCandidates);
      setAlerts(payload?.recent_events || []);

      // Tải snapshot xác thực cho các thí sinh đã có khung hình
      nextCandidates.forEach((c) => {
        if (c.has_snapshot) {
          void refreshAttemptSnapshot(c.attempt_id, true);
        }
      });
    } catch (err) {
      console.error('Lỗi tải dữ liệu giám sát:', err);
    } finally {
      setLoading(false);
    }
  }, [examId, refreshAttemptSnapshot]);

  useEffect(() => {
    classApi.getAll().then((res) => setAllClasses(res.data.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      Object.values(snapshotUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      snapshotUrlsRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!examId) return;
    void loadInitialData();
    void fetchAiTelemetry();
    const aiTimer = window.setInterval(() => {
      void fetchAiTelemetry();
    }, 15000);
    return () => window.clearInterval(aiTimer);
  }, [examId, loadInitialData, fetchAiTelemetry]);

  // Kiểm tra mất tín hiệu camera định kỳ phía giao diện nếu frame ngừng gửi
  useEffect(() => {
    const staleThresholdMs = Math.max((exam?.frame_interval_ms ?? 2000) * 3, 8000);
    const timer = window.setInterval(() => {
      const now = Date.now();
      setCandidates((prev) =>
        prev.map((c) => {
          if (c.attempt_status !== 'in_progress' || !exam?.proctoring_enabled) return c;
          const lastMs = c.last_frame_at ? new Date(c.last_frame_at).getTime() : 0;
          const isStale = !lastMs || now - lastMs > staleThresholdMs;
          if (isStale === c.camera_stale && !isStale === c.camera_active) return c;
          return { ...c, camera_active: !isStale, camera_stale: isStale };
        }),
      );
    }, 5000);
    return () => window.clearInterval(timer);
  }, [exam?.frame_interval_ms, exam?.proctoring_enabled]);

  // Kết nối Socket.IO namespace /monitor thật với JWT
  useEffect(() => {
    if (!examId || !accessToken) return;
    let firstConnect = true;

    const socket = io(`${BACKEND_ORIGIN}/monitor`, {
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      socket.emit('join-exam', Number(examId), (ok: boolean) => {
        if (ok && !firstConnect) {
          // Đồng bộ lại từ DB sau khi mất mạng / kết nối lại để không sót cảnh báo
          void loadInitialData();
        }
        firstConnect = false;
      });
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on('violation', (ev: {
      eventId?: number;
      attemptId: number;
      studentId: number;
      studentName: string;
      studentCode?: string;
      eventType: string;
      severity: 'info' | 'warning' | 'critical';
      messageVi: string;
      occurredAt: string;
      violationCount?: number;
    }) => {
      const attId = String(ev.attemptId);
      const alertId = ev.eventId ? String(ev.eventId) : `${attId}-${ev.occurredAt}-${ev.eventType}`;
      const newAlert: LiveAlertItem = {
        id: alertId,
        attempt_id: attId,
        timestamp: ev.occurredAt || new Date().toISOString(),
        student_name: ev.studentName || 'Thí sinh',
        student_code: ev.studentCode || '',
        type: ev.eventType,
        severity: ev.severity || 'warning',
        message: ev.messageVi,
      };

      setAlerts((prev) => {
        if (prev.some((x) => x.id === alertId)) return prev;
        return [newAlert, ...prev.slice(0, 59)];
      });

      playAlertBeep(ev.severity === 'critical');

      setCandidates((prev) => {
        const exists = prev.some((c) => c.attempt_id === attId);
        if (!exists) {
          void loadInitialData();
          return prev;
        }
        return prev.map((c) => {
          if (c.attempt_id !== attId) return c;
          const nextSeverity: 'warning' | 'critical' =
            ev.severity === 'critical' || c.status === 'critical' ? 'critical' : 'warning';
          return {
            ...c,
            status: nextSeverity,
            violation_count: typeof ev.violationCount === 'number' ? ev.violationCount : c.violation_count + 1,
            last_violation_type: ev.eventType,
            last_violation_label: ev.messageVi,
          };
        });
      });

      void refreshAttemptSnapshot(attId, true);
    });

    socket.on('frame-heartbeat', (hb: {
      attemptId: number;
      lastFrameAt: string;
      progressAnswered: number;
      totalQuestions: number;
      faceCount: number | null;
      aiStatus: 'ok' | 'degraded';
    }) => {
      const attId = String(hb.attemptId);
      setCandidates((prev) => {
        const exists = prev.some((c) => c.attempt_id === attId);
        if (!exists) {
          void loadInitialData();
          return prev;
        }
        return prev.map((c) =>
          c.attempt_id === attId
            ? {
                ...c,
                camera_active: true,
                camera_stale: false,
                has_snapshot: true,
                last_frame_at: hb.lastFrameAt,
                progress_answered: hb.progressAnswered,
                total_questions: hb.totalQuestions || c.total_questions,
              }
            : c,
        );
      });
      void refreshAttemptSnapshot(attId, false);
    });

    socket.on('attempt-status', () => {
      void loadInitialData();
    });

    socket.on('ai-status', (st: { status: 'degraded' | 'ok'; code: string; detail: string }) => {
      setAiStatusInfo((prev) => ({
        ...prev,
        ready: st.status === 'ok',
        degradedDetail: st.status === 'degraded' ? `${st.code}: ${st.detail}` : null,
      }));
    });

    return () => {
      socket.emit('leave-exam', Number(examId));
      socket.disconnect();
      socketRef.current = null;
    };
  }, [examId, accessToken, loadInitialData, playAlertBeep, refreshAttemptSnapshot]);

  const sendBroadcastMessage = async (rawText: string) => {
    const msg = rawText.trim();
    if (!examId || !msg) return;
    setSendingBroadcast(true);
    try {
      const res = await examApi.broadcastMonitorNotice(examId, msg);
      const count = res.data?.data?.recipients ?? 0;
      showToast(`Đã gửi thông báo tức thì tới ${count} thí sinh đang làm bài.`);
      setInlineBroadcastText('');
      setBroadcastMessage('');
      setBroadcastModalOpen(false);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Không thể gửi thông báo tới phòng thi.');
    } finally {
      setSendingBroadcast(false);
    }
  };

  const handleConfirmWarn = async () => {
    if (!warnTarget || !warnMessage.trim()) return;
    setSendingWarn(true);
    try {
      await examApi.warnCandidate(warnTarget.attempt_id, warnMessage.trim());
      showToast(`Đã gửi nhắc nhở trực tiếp tới ${warnTarget.student_name}.`);
      setWarnTarget(null);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Không thể gửi nhắc nhở.');
    } finally {
      setSendingWarn(false);
    }
  };

  const handleForceSubmit = async (candidate: CandidateFeed) => {
    if (candidate.attempt_status === 'submitted') return;
    const confirmed = window.confirm(
      `XÁC NHẬN THU BÀI TRỰC TIẾP:\nBạn có chắc chắn muốn chấm dứt lượt làm bài và thu bài ngay lập tức của thí sinh ${candidate.student_name} (${candidate.student_code || 'SV'})?`,
    );
    if (!confirmed) return;
    try {
      await examApi.forceSubmitAttempt(candidate.attempt_id, 'Giảng viên thu bài trực tiếp từ phòng giám sát.');
      showToast(`Đã thu bài của thí sinh ${candidate.student_name}.`);
      void loadInitialData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Không thể cưỡng chế nộp bài.');
    }
  };

  // Thống kê trực tiếp từ danh sách candidates thật
  const inProgressCount = candidates.filter((c) => c.attempt_status === 'in_progress').length;
  const submittedCount = candidates.filter((c) => c.attempt_status === 'submitted').length;
  const warningCount = candidates.filter(
    (c) => c.attempt_status === 'in_progress' && (c.status !== 'normal' || c.camera_stale),
  ).length;
  const totalEnrolled = exam?.total_enrolled ?? summary.total_enrolled ?? candidates.length;

  const filteredCandidates = candidates.filter((c) => {
    if (filterTab === 'warning') return c.violation_count > 0 || c.status !== 'normal' || c.camera_stale;
    if (filterTab === 'online') return c.attempt_status === 'in_progress';
    if (filterTab === 'submitted') return c.attempt_status === 'submitted';
    return true;
  });

  const filteredAlerts = alerts.filter((al) => {
    if (!alertSearch.trim()) return true;
    const q = alertSearch.toLowerCase();
    return (
      al.student_name.toLowerCase().includes(q) ||
      al.student_code.toLowerCase().includes(q) ||
      al.message.toLowerCase().includes(q)
    );
  });

  const formatClock = (isoOrStr: string) => {
    const d = new Date(isoOrStr);
    if (Number.isNaN(d.getTime())) return isoOrStr;
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="exam-layout-wrapper">
      <Sidebar classes={allClasses} currentClassId={exam?.class_id ? Number(exam.class_id) : undefined} />
      <div className={`exam-main-panel ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        {/* Top Breadcrumb Bar */}
        <header className="page-header" style={{ padding: '16px 32px' }}>
          <div className="page-header-left">
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => navigate(-1)}>
              <FiArrowLeft size={16} />
            </button>
            <div className="page-header-breadcrumb">
              <span className="breadcrumb-link" onClick={() => navigate('/')}>Tổng quan</span>
              <span style={{ color: '#94A3B8' }}>/</span>
              <span
                className="breadcrumb-link"
                onClick={() => exam?.class_id && navigate(`/class/${exam.class_id}?tab=exams`)}
              >
                {exam?.class_name || 'Lớp học'}
              </span>
              <span style={{ color: '#94A3B8' }}>/</span>
              <span>Giám sát trực tiếp</span>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <span className="badge badge-neutral">● {totalEnrolled} học viên</span>
            <span
              className={`status-pill-badge ${socketConnected ? 'badge-green' : 'badge-orange'}`}
              title="Trạng thái kết nối kênh giám sát thời gian thực"
            >
              {socketConnected ? '● Socket Live' : '● Đang kết nối lại...'}
            </span>
          </div>
        </header>

        <div className="exam-page-content" style={{ maxWidth: '100%' }}>
          {toastNotice && (
            <div className="monitor-toast-banner">
              <FiCheckCircle size={16} />
              <span>{toastNotice}</span>
            </div>
          )}

          {aiStatusInfo.degradedDetail && (
            <div className="monitor-ai-degraded-banner">
              <FiShield size={16} />
              <span>
                <strong>Trạng thái hạ tầng AI:</strong> {aiStatusInfo.degradedDetail} — Hệ thống tự động bỏ qua khung hình lỗi, tuyệt đối không tính nhầm thành vi phạm của thí sinh.
              </span>
            </div>
          )}

          {/* Top Header Bar */}
          <div className="monitor-top-nav">
            <div className="nav-left-info">
              <div>
                <div className="exam-title-with-pulse">
                  <span className="live-pulsing-badge">
                    <FiRadio size={12} /> TRỰC TIẾP
                  </span>
                  <h2>{exam?.name || 'Phòng giám sát bài thi trực tuyến'}</h2>
                </div>
                <span className="exam-session-sub">
                  {exam?.class_name || 'Lớp học'} › Mã đề #{examId} • Thời lượng: {exam?.duration_minutes ?? '--'} phút • Chu kỳ quét AI: {((exam?.frame_interval_ms ?? 2000) / 1000).toFixed(1)}s
                </span>
              </div>
            </div>

            <div className="nav-right-actions">
              <button
                type="button"
                className="exam-btn exam-btn-outline"
                onClick={() => navigate(`/exam/${examId}/violations`)}
              >
                <FiShield size={15} /> Nhật ký vi phạm
              </button>
              <button
                type="button"
                className="exam-btn exam-btn-outline"
                onClick={() => setBroadcastModalOpen(true)}
              >
                <FiVolume2 size={15} /> Phát loa toàn phòng
              </button>
              <button
                type="button"
                className="exam-btn exam-btn-secondary"
                onClick={() => void loadInitialData()}
                title="Đồng bộ lại dữ liệu phòng thi"
              >
                <FiRefreshCw size={15} /> Làm mới
              </button>
            </div>
          </div>

          {/* 4 Stats Metrics Row (Matching image7.png) */}
          <div className="monitor-stats-banner">
            <div className="m-stat-box">
              <div className="m-stat-icon-wrap bg-blue">
                <FiUsers size={22} />
              </div>
              <div className="m-stat-data">
                <span className="m-val">{totalEnrolled}</span>
                <span className="m-lbl">Tổng sĩ số lớp</span>
              </div>
            </div>

            <div className="m-stat-box">
              <div className="m-stat-icon-wrap bg-green">
                <FiVideo size={22} />
              </div>
              <div className="m-stat-data">
                <span className="m-val">{inProgressCount}</span>
                <span className="m-lbl">Đang làm bài trực tuyến</span>
              </div>
            </div>

            <div className="m-stat-box">
              <div className="m-stat-icon-wrap bg-gray">
                <FiCheckCircle size={22} />
              </div>
              <div className="m-stat-data">
                <span className="m-val">{submittedCount}</span>
                <span className="m-lbl">Đã nộp bài</span>
              </div>
            </div>

            <div className="m-stat-box highlight-warning">
              <div className="m-stat-icon-wrap bg-red">
                <FiAlertTriangle size={22} />
              </div>
              <div className="m-stat-data">
                <span className="m-val text-red">{warningCount}</span>
                <span className="m-lbl">Cảnh báo nghi vấn</span>
              </div>
            </div>
          </div>

          {/* Main Grid View: Candidate Cam Feeds + Right Alert Feed */}
          <div className="monitor-main-content">
            {/* Left Candidate Grid + Bottom Broadcast Bar */}
            <div className="candidates-grid-panel">
              <div className="grid-controls-row">
                <div className="filter-tabs">
                  <button
                    type="button"
                    className={`filter-btn ${filterTab === 'all' ? 'active' : ''}`}
                    onClick={() => setFilterTab('all')}
                  >
                    Tất cả thí sinh ({candidates.length})
                  </button>
                  <button
                    type="button"
                    className={`filter-btn ${filterTab === 'warning' ? 'active' : ''}`}
                    onClick={() => setFilterTab('warning')}
                  >
                    Có vi phạm ({candidates.filter((c) => c.violation_count > 0 || c.camera_stale).length})
                  </button>
                  <button
                    type="button"
                    className={`filter-btn ${filterTab === 'online' ? 'active' : ''}`}
                    onClick={() => setFilterTab('online')}
                  >
                    Đang trực tuyến ({inProgressCount})
                  </button>
                  <button
                    type="button"
                    className={`filter-btn ${filterTab === 'submitted' ? 'active' : ''}`}
                    onClick={() => setFilterTab('submitted')}
                  >
                    Đã nộp bài ({submittedCount})
                  </button>
                </div>

                <span className="grid-layout-indicator">
                  {exam?.proctoring_enabled === false ? 'Chế độ không bật Camera AI' : 'Lưới Camera AI thời gian thực'}
                </span>
              </div>

              {loading ? (
                <div className="exam-loading-state">
                  <div className="spinner" />
                  <p>Đang tải danh sách thí sinh trong phòng thi...</p>
                </div>
              ) : filteredCandidates.length === 0 ? (
                <div className="exam-empty-state" style={{ minHeight: 260 }}>
                  <FiUsers size={28} />
                  <h3>Chưa có thí sinh nào trong bộ lọc này</h3>
                  <p>Danh sách sẽ tự động cập nhật ngay khi thí sinh vào phòng làm bài.</p>
                </div>
              ) : (
                <div className="monitor-video-grid">
                  {filteredCandidates.map((c) => {
                    const isSubmitted = c.attempt_status === 'submitted';
                    const isCritical = !isSubmitted && c.status === 'critical';
                    const isWarning = !isSubmitted && (c.status === 'warning' || c.camera_stale);
                    const snapUrl = snapshotUrls[c.attempt_id];
                    const initials = c.student_name
                      .split(' ')
                      .filter(Boolean)
                      .slice(-2)
                      .map((p) => p[0])
                      .join('')
                      .toUpperCase();

                    return (
                      <div
                        key={c.attempt_id}
                        className={`candidate-feed-card ${
                          isSubmitted
                            ? 'card-submitted'
                            : isCritical
                              ? 'card-critical'
                              : isWarning
                                ? 'card-warning'
                                : 'card-normal'
                        }`}
                      >
                        <div className="feed-top-bar">
                          <span className="candidate-name-badge" title={`${c.student_name} (${c.student_code})`}>
                            {c.student_name} {c.student_code ? `(${c.student_code})` : ''}
                          </span>

                          {isSubmitted ? (
                            <span className="status-pill-badge badge-gray">✓ Đã nộp bài</span>
                          ) : c.camera_stale ? (
                            <span className="status-pill-badge badge-orange">● Mất Cam</span>
                          ) : isCritical ? (
                            <span className="status-pill-badge badge-red">● Báo động đỏ</span>
                          ) : isWarning ? (
                            <span className="status-pill-badge badge-orange">● Nghi vấn</span>
                          ) : (
                            <span className="status-pill-badge badge-green">● Hợp lệ</span>
                          )}
                        </div>

                        <div className="candidate-video-viewport">
                          {snapUrl && !isSubmitted ? (
                            <img
                              src={snapUrl}
                              alt={c.student_name}
                              className={`candidate-live-snapshot ${c.camera_stale ? 'stale-dimmed' : ''}`}
                            />
                          ) : (
                            <div className="simulated-avatar-view">
                              <div className="avatar-circle">{initials || 'SV'}</div>
                              <span className="feed-camera-label">
                                {isSubmitted ? (
                                  <>
                                    <FiCheckCircle size={12} /> Hoàn thành lúc{' '}
                                    {c.submitted_at ? formatClock(c.submitted_at) : '--:--'}
                                  </>
                                ) : exam?.proctoring_enabled === false ? (
                                  <>
                                    <FiVideoOff size={12} /> Không yêu cầu Camera
                                  </>
                                ) : c.camera_stale ? (
                                  <>
                                    <FiVideoOff size={12} /> Tạm mất khung hình
                                  </>
                                ) : (
                                  <>
                                    <FiVideo size={12} /> Đang chờ khung hình...
                                  </>
                                )}
                              </span>
                            </div>
                          )}

                          {!isSubmitted && c.camera_stale && (
                            <div className="hud-warning-box">
                              <span>Mất tín hiệu Camera quá ngưỡng</span>
                            </div>
                          )}

                          {!isSubmitted && !c.camera_stale && isCritical && c.last_violation_label && (
                            <div className="hud-critical-box">
                              <span>{c.last_violation_label}</span>
                            </div>
                          )}

                          {!isSubmitted && !c.camera_stale && !isCritical && isWarning && c.last_violation_label && (
                            <div className="hud-warning-box">
                              <span>{c.last_violation_label}</span>
                            </div>
                          )}

                          <div className="feed-bottom-telemetry">
                            <span>
                              Tiến độ: {c.progress_answered}/{c.total_questions} câu
                            </span>
                            <span>
                              Vi phạm: <strong>{c.violation_count}</strong>
                            </span>
                          </div>
                        </div>

                        <div className="candidate-card-footer">
                          <button
                            type="button"
                            className="cam-action-btn"
                            disabled={isSubmitted}
                            onClick={() => {
                              setWarnTarget(c);
                              setWarnMessage('Vui lòng tập trung nhìn thẳng vào màn hình làm bài!');
                            }}
                            title="Gửi nhắc nhở riêng cho thí sinh"
                          >
                            <FiVolume2 size={13} /> Nhắc nhở
                          </button>
                          <button
                            type="button"
                            className="cam-action-btn danger"
                            disabled={isSubmitted}
                            onClick={() => void handleForceSubmit(c)}
                            title="Cưỡng chế thu bài ngay lập tức"
                          >
                            <FiLock size={13} /> Thu bài
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Bottom Inline Broadcast Bar (Matching image7.png bottom-left) */}
              <form
                className="monitor-inline-broadcast"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendBroadcastMessage(inlineBroadcastText);
                }}
              >
                <div className="broadcast-bar-label">
                  <FiVolume2 size={16} />
                  <span>Kênh thông báo tức thì đến thí sinh:</span>
                </div>
                <input
                  type="text"
                  placeholder="Nhập thông báo gửi tới toàn bộ thí sinh đang làm bài (VD: Còn 10 phút làm bài, kiểm tra lại đáp án)..."
                  value={inlineBroadcastText}
                  onChange={(e) => setInlineBroadcastText(e.target.value)}
                />
                <button
                  type="submit"
                  className="exam-btn exam-btn-primary"
                  disabled={sendingBroadcast || !inlineBroadcastText.trim()}
                >
                  <FiSend size={14} /> Gửi toàn phòng
                </button>
              </form>
            </div>

            {/* Right Sidebar: Real-time Violation Event Stream (Matching image7.png right side) */}
            <div className="monitor-realtime-feed-panel">
              <div className="feed-panel-header">
                <h4>
                  <FiAlertTriangle className="text-orange" /> Feed Cảnh báo Real-time
                </h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    className="btn-icon-square"
                    style={{ width: 28, height: 28 }}
                    onClick={() => setSoundEnabled((v) => !v)}
                    title={soundEnabled ? 'Đang bật âm báo vi phạm' : 'Đang tắt âm báo vi phạm'}
                  >
                    {soundEnabled ? <FiVolume2 size={14} /> : <FiVolumeX size={14} />}
                  </button>
                  <span className="event-count-badge">{alerts.length}</span>
                </div>
              </div>

              <div className="monitor-feed-search">
                <FiSearch size={14} />
                <input
                  type="text"
                  placeholder="Lọc theo tên, mã SV, hành vi..."
                  value={alertSearch}
                  onChange={(e) => setAlertSearch(e.target.value)}
                />
              </div>

              <div className="alert-event-scroll-list">
                {filteredAlerts.length === 0 ? (
                  <div className="exam-empty-state" style={{ minHeight: 180, padding: 20 }}>
                    <FiShield size={22} />
                    <span>Chưa ghi nhận cảnh báo vi phạm nào.</span>
                  </div>
                ) : (
                  filteredAlerts.map((al) => (
                    <div key={al.id} className={`alert-event-item alert-${al.severity}`}>
                      <div className="alert-item-time">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <FiClock size={11} />
                          {formatClock(al.timestamp)}
                        </span>
                        <span
                          className={`status-pill-badge ${
                            al.severity === 'critical'
                              ? 'badge-red'
                              : al.severity === 'warning'
                                ? 'badge-orange'
                                : 'badge-green'
                          }`}
                        >
                          {al.severity === 'critical' ? 'Nghiêm trọng' : al.severity === 'warning' ? 'Cảnh báo' : 'Thông tin'}
                        </span>
                      </div>
                      <div className="alert-item-body">
                        <span className="alert-student">
                          {al.student_name} {al.student_code ? `(${al.student_code})` : ''}
                        </span>
                        <span className="alert-msg">{al.message}</span>
                      </div>
                      {al.attempt_id && (
                        <div className="alert-item-actions">
                          <button
                            type="button"
                            className="alert-mini-link"
                            onClick={() => {
                              const found = candidates.find((c) => c.attempt_id === al.attempt_id);
                              if (found && found.attempt_status === 'in_progress') {
                                setWarnTarget(found);
                                setWarnMessage(`Nhắc nhở AI: Hệ thống ghi nhận "${al.message}". Vui lòng nghiêm túc làm bài!`);
                              }
                            }}
                          >
                            Nhắc nhở ngay
                          </button>
                          <button
                            type="button"
                            className="alert-mini-link"
                            onClick={() => navigate(`/exam/${examId}/violations`)}
                          >
                            Xem bằng chứng ›
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Bottom Proctoring Latency Card (Matching image7.png bottom-right) */}
              <div className="monitor-latency-footer">
                <div className="latency-left">
                  <FiActivity size={15} />
                  <span>Độ trễ hệ thống AI Proctoring</span>
                </div>
                <strong className={aiStatusInfo.ready ? 'latency-ok' : 'latency-warn'}>
                  {aiStatusInfo.ready
                    ? aiStatusInfo.p50Ms !== null
                      ? `p50: ${aiStatusInfo.p50Ms} ms${aiStatusInfo.p95Ms !== null ? ` • p95: ${aiStatusInfo.p95Ms} ms` : ''}`
                      : 'Sẵn sàng (0 mẫu)'
                    : 'AI đang bận / Offline'}
                </strong>
              </div>
            </div>
          </div>

          {/* Broadcast Modal */}
          {broadcastModalOpen && (
            <div className="exam-modal-overlay">
              <div className="exam-modal-container">
                <div className="exam-modal-header">
                  <h3>Phát loa nhắc nhở toàn thể thí sinh</h3>
                  <button className="modal-close-btn" onClick={() => setBroadcastModalOpen(false)}>×</button>
                </div>
                <div className="modal-body-content">
                  <p>Thông điệp sẽ xuất hiện tức thì dưới dạng biểu ngữ nổi trên màn hình của tất cả thí sinh đang thi.</p>
                  <textarea
                    rows={4}
                    placeholder="Nhập nội dung thông báo... (VD: Đề nghị tất cả thí sinh giữ khuôn mặt trong khung hình camera)"
                    value={broadcastMessage}
                    onChange={(e) => setBroadcastMessage(e.target.value)}
                  />
                </div>
                <div className="exam-modal-footer">
                  <button
                    type="button"
                    className="exam-btn exam-btn-secondary"
                    onClick={() => setBroadcastModalOpen(false)}
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    className="exam-btn exam-btn-primary"
                    disabled={sendingBroadcast || !broadcastMessage.trim()}
                    onClick={() => void sendBroadcastMessage(broadcastMessage)}
                  >
                    <FiSend size={14} /> Phát thông báo ngay
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Direct Candidate Warning Modal */}
          {warnTarget && (
            <div className="exam-modal-overlay">
              <div className="exam-modal-container">
                <div className="exam-modal-header">
                  <h3>Nhắc nhở thí sinh: {warnTarget.student_name}</h3>
                  <button className="modal-close-btn" onClick={() => setWarnTarget(null)}>×</button>
                </div>
                <div className="modal-body-content">
                  <p>
                    Tin nhắn này sẽ hiển thị trực tiếp trên màn hình bài thi của{' '}
                    <strong>{warnTarget.student_name}</strong> ({warnTarget.student_code || 'SV'}).
                  </p>
                  <textarea
                    rows={3}
                    value={warnMessage}
                    onChange={(e) => setWarnMessage(e.target.value)}
                  />
                </div>
                <div className="exam-modal-footer">
                  <button
                    type="button"
                    className="exam-btn exam-btn-secondary"
                    onClick={() => setWarnTarget(null)}
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    className="exam-btn exam-btn-primary"
                    disabled={sendingWarn || !warnMessage.trim()}
                    onClick={() => void handleConfirmWarn()}
                  >
                    <FiSend size={14} /> Gửi nhắc nhở
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
