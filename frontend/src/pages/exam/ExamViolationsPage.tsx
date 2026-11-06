import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  FiArrowLeft,
  FiShield,
  FiFilter,
  FiCamera,
  FiClock,
  FiCheck,
  FiX,
  FiBarChart2,
  FiSearch,
  FiAlertTriangle,
  FiUsers,
  FiActivity,
  FiVideo,
  FiCheckCircle,
} from 'react-icons/fi';
import { examApi, classApi } from '../../api';
import type { ClassInfo, BehaviorStat } from '../../types';
import Sidebar from '../../components/layout/Sidebar';
import { useLayoutStore } from '../../store/layoutStore';
import './exam.css';

interface ViolationDetails {
  yaw?: number;
  pitch?: number;
  similarity?: number;
  detected_object?: string;
  confidence?: number;
  inference_ms?: number;
  description?: string;
}

interface ViolationRecord {
  id: string;
  event_id: number;
  attempt_id: string;
  student_id: string;
  student_name: string;
  student_code: string;
  event_type: string;
  event_label: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
  ended_at?: string | null;
  duration_ms: number;
  duration_seconds: number;
  sample_count?: number;
  review_status: 'pending' | 'confirmed_cheating' | 'dismissed';
  review_note?: string | null;
  evidence_id?: number | null;
  details: ViolationDetails;
}

interface ExamAnalytics {
  total_events: number;
  active_events: number;
  pending_count: number;
  confirmed_cheating_count: number;
  dismissed_count: number;
  categories: Array<{
    key: string;
    label: string;
    color: string;
    count: number;
    percentage: number;
    totalDurationSec: number;
  }>;
  timeline_buckets: Array<{
    label: string;
    total: number;
    critical: number;
    warning: number;
    info: number;
  }>;
  ai_health: {
    total_frames: number;
    total_ai_errors: number;
  };
}

interface TimelineEpisode {
  id: number;
  event_type: string;
  severity: 'info' | 'warning' | 'critical';
  started_at: string;
  ended_at?: string | null;
  duration_ms?: number;
  review_status: string;
}

export const ExamViolationsPage: React.FC = () => {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const { sidebarCollapsed } = useLayoutStore();

  const [allClasses, setAllClasses] = useState<ClassInfo[]>([]);
  const [examInfo, setExamInfo] = useState<any>(null);
  const [violations, setViolations] = useState<ViolationRecord[]>([]);
  const [analytics, setAnalytics] = useState<ExamAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedFilter, setSelectedFilter] = useState<
    'all' | 'critical' | 'warning' | 'info' | 'confirmed_cheating' | 'dismissed'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Thí sinh đang được chọn để xem 6 thẻ Telemetry & Timeline chi tiết bên phải (image9.png)
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [behaviorStats, setBehaviorStats] = useState<BehaviorStat[]>([]);
  const [attemptTimeline, setAttemptTimeline] = useState<TimelineEpisode[]>([]);
  const [verdictNote, setVerdictNote] = useState('');
  const [savingVerdict, setSavingVerdict] = useState(false);

  // Modal xem ảnh bằng chứng riêng tư qua blob xác thực
  const [selectedEvidence, setSelectedEvidence] = useState<ViolationRecord | null>(null);
  const [evidenceBlobUrl, setEvidenceBlobUrl] = useState<string | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [modalReviewNote, setModalReviewNote] = useState('');

  useEffect(() => {
    classApi.getAll().then((res) => setAllClasses(res.data.data || [])).catch(() => {});
  }, []);

  const loadViolations = useCallback(async () => {
    if (!examId) return;
    setLoading(true);
    try {
      const res = await examApi.getViolations(examId, false);
      const data = res.data?.data;
      const list: ViolationRecord[] = data?.violations || [];
      setExamInfo(data?.exam || null);
      setViolations(list);
      setAnalytics(data?.analytics || null);
      setSelectedAttemptId((prev) => {
        if (prev && list.some((v) => v.attempt_id === prev)) return prev;
        return list[0]?.attempt_id ?? null;
      });
    } catch (err) {
      console.error('Lỗi tải nhật ký vi phạm:', err);
      setViolations([]);
      setAnalytics(null);
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    void loadViolations();
  }, [loadViolations]);

  // Tải 6 chỉ số hành vi & timeline ngang của thí sinh đang chọn
  useEffect(() => {
    if (!selectedAttemptId) {
      setBehaviorStats([]);
      setAttemptTimeline([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      examApi.getBehaviorStats(selectedAttemptId),
      examApi.getTimeline(selectedAttemptId),
    ])
      .then(([statsRes, tlRes]) => {
        if (cancelled) return;
        setBehaviorStats(statsRes.data?.data || []);
        setAttemptTimeline(tlRes.data?.data || []);
      })
      .catch(() => {
        if (cancelled) return;
        setBehaviorStats([]);
        setAttemptTimeline([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAttemptId]);

  // Tải ảnh bằng chứng thật qua JWT (không dùng static URL công khai)
  useEffect(() => {
    let activeUrl: string | null = null;
    if (!selectedEvidence) {
      setEvidenceBlobUrl(null);
      setEvidenceLoading(false);
      return;
    }
    setModalReviewNote(selectedEvidence.review_note || '');
    if (!selectedEvidence.evidence_id) {
      setEvidenceBlobUrl(null);
      setEvidenceLoading(false);
      return;
    }
    let cancelled = false;
    setEvidenceLoading(true);
    setEvidenceBlobUrl(null);
    examApi
      .fetchEvidenceBlob(selectedEvidence.attempt_id, selectedEvidence.evidence_id)
      .then((res) => {
        if (cancelled) return;
        activeUrl = URL.createObjectURL(res.data);
        setEvidenceBlobUrl(activeUrl);
      })
      .catch(() => {
        if (!cancelled) setEvidenceBlobUrl(null);
      })
      .finally(() => {
        if (!cancelled) setEvidenceLoading(false);
      });

    return () => {
      cancelled = true;
      if (activeUrl) URL.revokeObjectURL(activeUrl);
    };
  }, [selectedEvidence]);

  const handleReviewEvent = async (
    record: ViolationRecord,
    status: 'confirmed_cheating' | 'dismissed',
    note?: string,
  ) => {
    try {
      await examApi.reviewEvent(record.event_id, status, note);
      await loadViolations();
      if (selectedEvidence && selectedEvidence.event_id === record.event_id) {
        setSelectedEvidence((prev) =>
          prev ? { ...prev, review_status: status, review_note: note ?? prev.review_note } : null,
        );
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Không thể cập nhật trạng thái duyệt sự kiện.');
    }
  };

  const handleAttemptVerdict = async (verdict: 'clean' | 'suspected' | 'confirmed_cheating') => {
    if (!selectedAttemptId) return;
    setSavingVerdict(true);
    try {
      await examApi.reviewAttempt(selectedAttemptId, verdict, verdictNote.trim() || undefined);
      const label =
        verdict === 'confirmed_cheating' ? 'Xác nhận gian lận' : verdict === 'suspected' ? 'Cần xem xét' : 'Hợp lệ';
      alert(`Đã lưu kết luận "${label}" cho bài thi của thí sinh.`);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Không thể lưu kết luận hậu kiểm.');
    } finally {
      setSavingVerdict(false);
    }
  };

  // Danh sách các thí sinh có sự kiện trong đề thi
  const candidateOptions = useMemo(() => {
    const map = new Map<string, { attempt_id: string; student_name: string; student_code: string; count: number }>();
    for (const v of violations) {
      const cur = map.get(v.attempt_id);
      if (cur) {
        if (v.review_status !== 'dismissed') cur.count += 1;
      } else {
        map.set(v.attempt_id, {
          attempt_id: v.attempt_id,
          student_name: v.student_name,
          student_code: v.student_code,
          count: v.review_status !== 'dismissed' ? 1 : 0,
        });
      }
    }
    return Array.from(map.values());
  }, [violations]);

  // Tính 4 thẻ thống kê đầu trang từ dữ liệu thật (image9.png)
  const activeViolations = useMemo(
    () => violations.filter((v) => v.review_status !== 'dismissed'),
    [violations],
  );

  const uniqueFlaggedStudents = useMemo(
    () => new Set(activeViolations.map((v) => v.attempt_id)).size,
    [activeViolations],
  );

  const mostCommonViolation = useMemo(() => {
    if (activeViolations.length === 0) return { label: 'Chưa phát sinh', count: 0 };
    const counts = new Map<string, number>();
    for (const v of activeViolations) {
      counts.set(v.event_label, (counts.get(v.event_label) ?? 0) + 1);
    }
    let bestLabel = '';
    let bestCount = 0;
    counts.forEach((cnt, lbl) => {
      if (cnt > bestCount) {
        bestCount = cnt;
        bestLabel = lbl;
      }
    });
    return { label: bestLabel, count: bestCount };
  }, [activeViolations]);

  const criticalCount = useMemo(
    () => activeViolations.filter((v) => v.severity === 'critical').length,
    [activeViolations],
  );

  // Lọc danh sách sự kiện theo bộ lọc & ô tìm kiếm
  const filteredViolations = useMemo(() => {
    return violations.filter((v) => {
      if (selectedFilter === 'critical' && (v.severity !== 'critical' || v.review_status === 'dismissed')) return false;
      if (selectedFilter === 'warning' && (v.severity !== 'warning' || v.review_status === 'dismissed')) return false;
      if (selectedFilter === 'info' && (v.severity !== 'info' || v.review_status === 'dismissed')) return false;
      if (selectedFilter === 'confirmed_cheating' && v.review_status !== 'confirmed_cheating') return false;
      if (selectedFilter === 'dismissed' && v.review_status !== 'dismissed') return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          v.student_name.toLowerCase().includes(q) ||
          v.student_code.toLowerCase().includes(q) ||
          v.event_label.toLowerCase().includes(q) ||
          (v.details?.description || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [violations, selectedFilter, searchQuery]);

  // Tổng hợp 6 ô Telemetry chi tiết cho thí sinh đang chọn (image9.png)
  const sixTelemetryCards = useMemo(() => {
    const sumTypes = (pred: (t: string) => boolean) => {
      let count = 0;
      let sec = 0;
      for (const s of behaviorStats) {
        if (pred(s.type)) {
          count += Number(s.count || 0);
          sec += Number(s.totalDurationSec || 0);
        }
      }
      return { count, sec: Math.round(sec * 10) / 10 };
    };

    return [
      { title: 'Quay đầu TRÁI', tone: 'blue', ...sumTypes((t) => t === 'head_turn_left') },
      { title: 'Quay đầu PHẢI', tone: 'blue', ...sumTypes((t) => t === 'head_turn_right') },
      {
        title: 'Lệch mắt / Cúi ngẩng',
        tone: 'green',
        ...sumTypes((t) => t.startsWith('gaze_') || t === 'head_pitch_up' || t === 'head_pitch_down'),
      },
      {
        title: 'Vắng mặt / Sai mặt',
        tone: 'orange',
        ...sumTypes((t) => t === 'no_face' || t === 'multiple_faces' || t === 'identity_mismatch'),
      },
      {
        title: 'Điện thoại / Thiết bị',
        tone: 'red',
        ...sumTypes(
          (t) =>
            t === 'object_cell_phone' ||
            t === 'object_laptop' ||
            t === 'object_tv' ||
            t === 'object_headphone',
        ),
      },
      {
        title: 'Tài liệu / Rời tab',
        tone: 'purple',
        ...sumTypes(
          (t) =>
            t === 'object_book' ||
            t === 'extra_person' ||
            t === 'tab_hidden' ||
            t === 'window_blur' ||
            t === 'fullscreen_exit' ||
            t === 'camera_lost',
        ),
      },
    ];
  }, [behaviorStats]);

  // Tính toạ độ phần trăm cho thanh Timeline ngang của thí sinh đang chọn
  const timelineSegments = useMemo(() => {
    if (attemptTimeline.length === 0) return [];
    const sorted = [...attemptTimeline].sort(
      (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
    );
    const minMs = new Date(sorted[0].started_at).getTime();
    const examDurMs = Math.max((examInfo?.duration_minutes ?? 60) * 60_000, 60_000);
    const maxEventMs = Math.max(
      ...sorted.map((e) => new Date(e.ended_at || e.started_at).getTime()),
      minMs + examDurMs,
    );
    const spanMs = Math.max(maxEventMs - minMs, 60_000);

    return sorted.map((ep) => {
      const startMs = new Date(ep.started_at).getTime();
      const durMs = Math.max(Number(ep.duration_ms ?? 3000), 3000);
      const leftPct = Math.min(98, Math.max(0, ((startMs - minMs) / spanMs) * 100));
      const widthPct = Math.min(100 - leftPct, Math.max(1.8, (durMs / spanMs) * 100));
      return { ...ep, leftPct, widthPct };
    });
  }, [attemptTimeline, examInfo?.duration_minutes]);

  const selectedStudentObj = candidateOptions.find((c) => c.attempt_id === selectedAttemptId) ?? null;

  return (
    <div className="exam-layout-wrapper">
      <Sidebar classes={allClasses} currentClassId={examInfo?.class_id ? Number(examInfo.class_id) : undefined} />
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
                onClick={() => examInfo?.class_id && navigate(`/class/${examInfo.class_id}?tab=exams`)}
              >
                {examInfo?.class_name || 'Lớp học'}
              </span>
              <span style={{ color: '#94A3B8' }}>/</span>
              <span>Nhật ký vi phạm AI</span>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <span className="badge badge-neutral">● {examInfo?.total_enrolled ?? 0} học viên</span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => navigate(`/exam/${examId}/monitor`)}
            >
              <FiVideo size={14} /> Phòng Giám sát
            </button>
          </div>
        </header>

        <div className="exam-page-content" style={{ maxWidth: '100%' }}>
          {/* Top Header */}
          <div className="violations-top-bar">
            <div className="v-top-left">
              <div>
                <div className="title-with-shield">
                  <FiShield className="shield-icon text-orange" />
                  <h2>Nhật ký vi phạm & Phân tích Telemetry AI</h2>
                </div>
                <span className="sub-title-text">
                  {examInfo?.name || 'Đề thi trực tuyến'} • Đối chiếu bằng chứng hình ảnh & hậu kiểm hành vi bất thường từ dữ liệu thực tế
                </span>
              </div>
            </div>

            <div className="v-top-actions" style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="exam-btn exam-btn-secondary"
                onClick={() => navigate(`/exam/${examId}/grading`)}
              >
                Chấm bài & Điểm số
              </button>
              <button
                type="button"
                className="exam-btn exam-btn-outline"
                onClick={() => window.print()}
              >
                Xuất báo cáo PDF
              </button>
            </div>
          </div>

          {/* 4 Top Stat Cards (Matching image9.png) */}
          <div className="exam-stats-row">
            <div className="stat-box-card">
              <div className="stat-box-left">
                <span className="stat-box-label">TỔNG LƯỢT VI PHẠM</span>
                <div className="stat-box-val-row">
                  <span className="stat-box-number">{analytics?.active_events ?? activeViolations.length}</span>
                  {(analytics?.dismissed_count ?? 0) > 0 && (
                    <span className="stat-sub-text">({analytics?.dismissed_count} đã bỏ qua)</span>
                  )}
                </div>
              </div>
              <div className="stat-icon-wrapper purple-bg">
                <FiActivity size={22} />
              </div>
            </div>

            <div className="stat-box-card">
              <div className="stat-box-left">
                <span className="stat-box-label">THÍ SINH BỊ CẢNH BÁO</span>
                <div className="stat-box-val-row">
                  <span className="stat-box-number text-blue">{uniqueFlaggedStudents}</span>
                  <span className="stat-sub-text">/ {examInfo?.total_enrolled ?? 0} học viên</span>
                </div>
              </div>
              <div className="stat-icon-wrapper blue-ring">
                <FiUsers size={22} />
              </div>
            </div>

            <div className="stat-box-card">
              <div className="stat-box-left">
                <span className="stat-box-label">VI PHẠM PHỔ BIẾN NHẤT</span>
                <div className="stat-box-val-row" style={{ flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: '#0F172A' }}>
                    {mostCommonViolation.label}
                  </span>
                  <span className="stat-sub-text">
                    {mostCommonViolation.count > 0 ? `${mostCommonViolation.count} lượt ghi nhận` : 'Không có dữ liệu'}
                  </span>
                </div>
              </div>
              <div className="stat-icon-wrapper green-bg">
                <FiBarChart2 size={22} />
              </div>
            </div>

            <div className="stat-box-card">
              <div className="stat-box-left">
                <span className="stat-box-label">MỨC ĐỘ NGHIÊM TRỌNG</span>
                <div className="stat-box-val-row">
                  <span className="stat-box-number text-red">{criticalCount}</span>
                  <span className="stat-alert-tag">
                    {analytics?.confirmed_cheating_count ?? 0} đã xác nhận
                  </span>
                </div>
              </div>
              <div className="stat-icon-wrapper red-bg">
                <FiAlertTriangle size={22} />
              </div>
            </div>
          </div>

          {/* Main Grid: Left Violations Table + Right Telemetry & Analytics Panel */}
          <div className="violations-split-grid">
            {/* Left Violations Table */}
            <div className="violations-table-panel">
              <div className="table-controls-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
                <div className="filter-group" style={{ flexWrap: 'wrap' }}>
                  <FiFilter />
                  <button
                    type="button"
                    className={`filter-btn ${selectedFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setSelectedFilter('all')}
                  >
                    Tất cả ({violations.length})
                  </button>
                  <button
                    type="button"
                    className={`filter-btn ${selectedFilter === 'critical' ? 'active' : ''}`}
                    onClick={() => setSelectedFilter('critical')}
                  >
                    Nghiêm trọng ({criticalCount})
                  </button>
                  <button
                    type="button"
                    className={`filter-btn ${selectedFilter === 'warning' ? 'active' : ''}`}
                    onClick={() => setSelectedFilter('warning')}
                  >
                    Cảnh báo ({activeViolations.filter((v) => v.severity === 'warning').length})
                  </button>
                  <button
                    type="button"
                    className={`filter-btn ${selectedFilter === 'confirmed_cheating' ? 'active' : ''}`}
                    onClick={() => setSelectedFilter('confirmed_cheating')}
                  >
                    Đã xác nhận ({analytics?.confirmed_cheating_count ?? 0})
                  </button>
                  <button
                    type="button"
                    className={`filter-btn ${selectedFilter === 'dismissed' ? 'active' : ''}`}
                    onClick={() => setSelectedFilter('dismissed')}
                  >
                    Đã bỏ qua ({analytics?.dismissed_count ?? 0})
                  </button>
                </div>

                <div className="v-inline-search">
                  <FiSearch size={14} />
                  <input
                    type="text"
                    placeholder="Tìm tên, mã SV, hành vi..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {loading ? (
                <div className="exam-loading-state">
                  <div className="spinner" />
                  <p>Đang tải nhật ký sự kiện AI...</p>
                </div>
              ) : filteredViolations.length === 0 ? (
                <div className="exam-empty-state" style={{ border: 'none', borderRadius: 0, minHeight: 280 }}>
                  <FiCheckCircle size={30} color="#10B981" />
                  <h3>Không có sự kiện vi phạm nào khớp bộ lọc</h3>
                  <p>Hệ thống chưa ghi nhận hành vi bất thường nào trong phạm vi truy vấn hiện tại.</p>
                </div>
              ) : (
                <div className="v-table-wrapper">
                  <table className="violations-data-table">
                    <thead>
                      <tr>
                        <th>Thời điểm</th>
                        <th>Thí sinh</th>
                        <th>Hành vi vi phạm</th>
                        <th>Mức độ & Trạng thái</th>
                        <th>Thời lượng</th>
                        <th>Bằng chứng</th>
                        <th>Hậu kiểm</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredViolations.map((v) => {
                        const isRowSelected = v.attempt_id === selectedAttemptId;
                        const isDismissed = v.review_status === 'dismissed';
                        const isConfirmed = v.review_status === 'confirmed_cheating';
                        return (
                          <tr
                            key={v.id}
                            className={`${isRowSelected ? 'v-row-selected' : ''} ${isDismissed ? 'v-row-dismissed' : ''}`}
                            onClick={() => setSelectedAttemptId(v.attempt_id)}
                            style={{ cursor: 'pointer' }}
                          >
                            <td className="col-time">
                              <FiClock size={13} />{' '}
                              {new Date(v.timestamp).toLocaleTimeString('vi-VN', {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </td>
                            <td className="col-student">
                              <strong>{v.student_name}</strong>
                              <span className="sub-code">{v.student_code || `Attempt #${v.attempt_id}`}</span>
                            </td>
                            <td className="col-event">
                              <span className="event-name">{v.event_label}</span>
                              {v.details?.description && (
                                <p className="event-desc">{v.details.description}</p>
                              )}
                            </td>
                            <td className="col-severity">
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                                <span
                                  className={`status-pill-badge ${
                                    v.severity === 'critical'
                                      ? 'badge-red'
                                      : v.severity === 'warning'
                                        ? 'badge-orange'
                                        : 'badge-green'
                                  }`}
                                >
                                  {v.severity === 'critical'
                                    ? 'NGHIÊM TRỌNG'
                                    : v.severity === 'warning'
                                      ? 'CẢNH BÁO'
                                      : 'THÔNG TIN'}
                                </span>
                                {isConfirmed && (
                                  <span className="review-tag confirmed">✓ Đã xác nhận</span>
                                )}
                                {isDismissed && (
                                  <span className="review-tag dismissed">Đã bỏ qua</span>
                                )}
                              </div>
                            </td>
                            <td className="col-duration">
                              {v.duration_seconds > 0 ? `${v.duration_seconds}s` : 'Tức thời'}
                            </td>
                            <td className="col-evidence" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className="thumb-btn"
                                onClick={() => setSelectedEvidence(v)}
                              >
                                <FiCamera size={14} />{' '}
                                {v.evidence_id ? 'Xem ảnh AI' : 'Chi tiết'}
                              </button>
                            </td>
                            <td className="col-action" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className={`icon-btn-check ${isConfirmed ? 'active' : ''}`}
                                title="Xác nhận hành vi gian lận"
                                onClick={() => void handleReviewEvent(v, 'confirmed_cheating')}
                              >
                                <FiCheck size={15} />
                              </button>
                              <button
                                type="button"
                                className={`icon-btn-reject ${isDismissed ? 'active' : ''}`}
                                title="Bỏ qua (Cảnh báo nhầm)"
                                onClick={() => void handleReviewEvent(v, 'dismissed')}
                              >
                                <FiX size={15} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Right Telemetry & Analytics Panel (Matching image9.png right column) */}
            <div className="telemetry-stats-panel">
              {/* Card 1: Selected Candidate Telemetry 6 Cards + Horizontal Timeline */}
              <div className="exam-card">
                <div className="card-subhead-row">
                  <h4 className="card-subhead">
                    <FiUsers className="subhead-icon" /> Hồ sơ Telemetry thí sinh
                  </h4>
                  {candidateOptions.length > 0 && (
                    <select
                      className="compact-select"
                      value={selectedAttemptId ?? ''}
                      onChange={(e) => setSelectedAttemptId(e.target.value)}
                    >
                      {candidateOptions.map((opt) => (
                        <option key={opt.attempt_id} value={opt.attempt_id}>
                          {opt.student_name} ({opt.count} lỗi)
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {!selectedStudentObj ? (
                  <div className="exam-empty-state compact-empty-state" style={{ minHeight: 140 }}>
                    <FiShield size={20} />
                    <span>Chọn một dòng vi phạm bên trái để xem phân tích chi tiết của thí sinh.</span>
                  </div>
                ) : (
                  <>
                    <div className="behavior-6-grid">
                      {sixTelemetryCards.map((card, i) => (
                        <div key={i} className={`b-stat-card tone-${card.tone} ${card.count > 0 ? 'has-val' : ''}`}>
                          <span className="b-card-title">{card.title}</span>
                          <strong className="b-card-count">{card.count} lần</strong>
                          <small className="b-card-sec">Tổng {card.sec} giây</small>
                        </div>
                      ))}
                    </div>

                    <div className="attempt-timeline-block">
                      <div className="tl-header">
                        <span>Timeline hành vi trong ca thi ({examInfo?.duration_minutes ?? 60} phút)</span>
                        <span>{attemptTimeline.length} sự kiện</span>
                      </div>
                      <div className="attempt-timeline-track">
                        {timelineSegments.map((seg) => (
                          <div
                            key={seg.id}
                            className={`timeline-marker sev-${seg.severity}`}
                            style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }}
                            title={`${seg.event_type} • ${new Date(seg.started_at).toLocaleTimeString('vi-VN')}`}
                          />
                        ))}
                      </div>
                      <div className="tl-scale-labels">
                        <span>Bắt đầu</span>
                        <span>Giữa giờ</span>
                        <span>Kết thúc</span>
                      </div>
                    </div>

                    <div className="attempt-verdict-box">
                      <label>Kết luận hậu kiểm cho {selectedStudentObj.student_name}:</label>
                      <input
                        type="text"
                        className="form-input-custom"
                        style={{ padding: '7px 10px', fontSize: 12, marginBottom: 8 }}
                        placeholder="Ghi chú biên bản hậu kiểm (tùy chọn)..."
                        value={verdictNote}
                        onChange={(e) => setVerdictNote(e.target.value)}
                      />
                      <div className="verdict-btn-row">
                        <button
                          type="button"
                          className="verdict-chip clean"
                          disabled={savingVerdict}
                          onClick={() => void handleAttemptVerdict('clean')}
                        >
                          ✓ Hợp lệ
                        </button>
                        <button
                          type="button"
                          className="verdict-chip suspicious"
                          disabled={savingVerdict}
                          onClick={() => void handleAttemptVerdict('suspected')}
                        >
                          ! Cần xem xét
                        </button>
                        <button
                          type="button"
                          className="verdict-chip cheating"
                          disabled={savingVerdict}
                          onClick={() => void handleAttemptVerdict('confirmed_cheating')}
                        >
                          ✕ Gian lận
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Card 2: Real Category Distribution from DB */}
              <div className="exam-card">
                <h4 className="card-subhead">
                  <FiBarChart2 className="subhead-icon" /> Cơ cấu nhóm vi phạm toàn phòng
                </h4>

                <div className="telemetry-category-list">
                  {(analytics?.categories || []).map((cat) => (
                    <div key={cat.key} className="telemetry-row">
                      <div className="t-row-labels">
                        <span>{cat.label}</span>
                        <strong>
                          {cat.count} lượt ({cat.percentage}%)
                        </strong>
                      </div>
                      <div className="progress-track">
                        <div
                          className={`progress-fill fill-${cat.color}`}
                          style={{ width: `${cat.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {analytics?.ai_health && (
                  <div className="ai-health-footnote">
                    <span>
                      Đã phân tích AI: <strong>{analytics.ai_health.total_frames}</strong> khung hình
                    </span>
                    <span>
                      Khung hình bỏ qua do hạ tầng AI:{' '}
                      <strong>{analytics.ai_health.total_ai_errors}</strong> (không tính lỗi SV)
                    </span>
                  </div>
                )}
              </div>

              {/* Card 3: 5-Minute Buckets Timeline */}
              <div className="exam-card">
                <h4 className="card-subhead">
                  <FiClock className="subhead-icon" /> Mật độ cảnh báo theo khung 5 phút
                </h4>
                {!analytics?.timeline_buckets || analytics.timeline_buckets.length === 0 ? (
                  <div className="exam-empty-state compact-empty-state" style={{ minHeight: 110 }}>
                    <FiClock size={18} />
                    <span>Chưa phát sinh sự kiện trong ca thi.</span>
                  </div>
                ) : (
                  <div className="bucket-bars-list">
                    {analytics.timeline_buckets.map((b, idx) => {
                      const maxTotal = Math.max(...analytics.timeline_buckets.map((x) => x.total), 1);
                      const pct = Math.round((b.total / maxTotal) * 100);
                      return (
                        <div key={idx} className="bucket-bar-row">
                          <span className="b-time">{b.label}</span>
                          <div className="progress-track" style={{ flex: 1 }}>
                            <div
                              className={`progress-fill ${b.critical > 0 ? 'fill-red' : 'fill-orange'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <strong className="b-cnt">{b.total}</strong>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Evidence Snapshot Modal */}
          {selectedEvidence && (
            <div className="exam-modal-overlay" onClick={() => setSelectedEvidence(null)}>
              <div
                className="exam-modal-container evidence-preview-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="exam-modal-header">
                  <h3>
                    Bằng chứng giám sát AI: {selectedEvidence.student_name}{' '}
                    {selectedEvidence.student_code ? `(${selectedEvidence.student_code})` : ''}
                  </h3>
                  <button className="modal-close-btn" onClick={() => setSelectedEvidence(null)}>
                    ×
                  </button>
                </div>

                <div className="evidence-modal-body">
                  <div className="simulated-evidence-frame">
                    {evidenceLoading ? (
                      <div className="frame-placeholder">
                        <div className="spinner" />
                        <span>Đang tải ảnh bằng chứng được mã hóa quyền truy cập...</span>
                      </div>
                    ) : evidenceBlobUrl ? (
                      <img
                        src={evidenceBlobUrl}
                        alt={selectedEvidence.event_label}
                        className="real-evidence-img"
                      />
                    ) : (
                      <div className="frame-placeholder">
                        <FiCamera size={40} />
                        <span>
                          {selectedEvidence.evidence_id
                            ? 'Không thể tải tệp ảnh bằng chứng.'
                            : 'Sự kiện trình duyệt / hệ thống (không kèm ảnh chụp webcam).'}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="evidence-meta-details">
                    <div className="meta-row">
                      <span className="lbl">Hành vi ghi nhận:</span>
                      <strong>{selectedEvidence.event_label}</strong>
                    </div>
                    <div className="meta-row">
                      <span className="lbl">Thông số Telemetry AI:</span>
                      <span>
                        {selectedEvidence.details?.description || 'Xác nhận qua chuỗi mẫu liên tiếp'}
                      </span>
                    </div>
                    {(selectedEvidence.details?.yaw !== undefined ||
                      selectedEvidence.details?.pitch !== undefined ||
                      selectedEvidence.details?.detected_object !== undefined ||
                      selectedEvidence.details?.similarity !== undefined) && (
                      <div className="meta-telemetry-chips">
                        {selectedEvidence.details.yaw !== undefined && (
                          <span className="t-chip">Yaw: {selectedEvidence.details.yaw}°</span>
                        )}
                        {selectedEvidence.details.pitch !== undefined && (
                          <span className="t-chip">Pitch: {selectedEvidence.details.pitch}°</span>
                        )}
                        {selectedEvidence.details.similarity !== undefined && (
                          <span className="t-chip">
                            ArcFace Sim: {(selectedEvidence.details.similarity * 100).toFixed(1)}%
                          </span>
                        )}
                        {selectedEvidence.details.detected_object && (
                          <span className="t-chip danger">
                            YOLOv8: {selectedEvidence.details.detected_object}{' '}
                            {selectedEvidence.details.confidence !== undefined
                              ? `(${Math.round(selectedEvidence.details.confidence * 100)}%)`
                              : ''}
                          </span>
                        )}
                        {selectedEvidence.details.inference_ms !== undefined && (
                          <span className="t-chip">Inference: {selectedEvidence.details.inference_ms} ms</span>
                        )}
                      </div>
                    )}
                    <div className="meta-row">
                      <span className="lbl">Thời điểm & Thời lượng:</span>
                      <span>
                        {new Date(selectedEvidence.timestamp).toLocaleString('vi-VN')} •{' '}
                        {selectedEvidence.duration_seconds > 0
                          ? `Kéo dài ${selectedEvidence.duration_seconds}s`
                          : 'Tức thời'}
                      </span>
                    </div>

                    <div className="meta-note-input">
                      <label>Ghi chú duyệt của giảng viên:</label>
                      <input
                        type="text"
                        className="form-input-custom"
                        placeholder="Nhập lý do xác nhận hoặc bỏ qua sự kiện này..."
                        value={modalReviewNote}
                        onChange={(e) => setModalReviewNote(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="exam-modal-footer">
                  <button
                    type="button"
                    className="exam-btn exam-btn-outline"
                    onClick={() => void handleReviewEvent(selectedEvidence, 'dismissed', modalReviewNote)}
                  >
                    <FiX size={15} /> Bỏ qua (Báo nhầm)
                  </button>
                  <button
                    type="button"
                    className="exam-btn exam-btn-danger"
                    onClick={() =>
                      void handleReviewEvent(selectedEvidence, 'confirmed_cheating', modalReviewNote)
                    }
                  >
                    <FiCheck size={15} /> Xác nhận vi phạm
                  </button>
                  <button
                    type="button"
                    className="exam-btn exam-btn-secondary"
                    onClick={() => setSelectedEvidence(null)}
                  >
                    Đóng
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
