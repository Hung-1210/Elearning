import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { classApi, documentApi, exerciseApi, faceProfileApi, meetingApi } from '../../api';
import { useAuthStore } from '../../store/authStore';
import type { ClassInfo, Exercise, FaceProfileMe, Meeting } from '../../types';
import Sidebar, { MobileMenuButton } from '../../components/layout/Sidebar';
import { useLayoutStore } from '../../store/layoutStore';

const CLASS_COLORS = [
  '#4F46E5', '#7C3AED', '#2563EB', '#0891B2',
  '#059669', '#D97706', '#DC2626', '#DB2777',
];

interface AggregatedMeeting extends Meeting {
  className: string;
}

interface AggregatedExercise extends Exercise {
  className: string;
  classMemberCount: number;
}

const DAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

function buildSmoothPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cx = (p0.x + p1.x) / 2;
    d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { sidebarCollapsed } = useLayoutStore();
  const isLecturer = Boolean(user?.isLecturer);

  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [allExercises, setAllExercises] = useState<AggregatedExercise[]>([]);
  const [allMeetings, setAllMeetings] = useState<AggregatedMeeting[]>([]);
  const [totalDocsCount, setTotalDocsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [chartRange, setChartRange] = useState<'7d' | '30d'>('7d');

  const [showAddClass, setShowAddClass] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [addingClass, setAddingClass] = useState(false);
  const [faceProfile, setFaceProfile] = useState<FaceProfileMe | null>(null);

  useEffect(() => {
    loadDashboardData();
    if (user && !user.isLecturer) {
      faceProfileApi
        .getMe()
        .then((res) => setFaceProfile(res.data.data))
        .catch(() => {});
    }
  }, [user?.userId, user?.isLecturer]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const res = await classApi.getAll();
      const clsList: ClassInfo[] = res.data.data || [];
      setClasses(clsList);

      // Fetch exercises, meetings, and docs across classes in parallel for real stats
      const perClassPromises = clsList.map(async (cls) => {
        const [exRes, meetRes, attachRes] = await Promise.all([
          exerciseApi.getByClass(cls.id).catch(() => ({ data: { data: [] as Exercise[] } })),
          meetingApi.getByClass(cls.id).catch(() => ({ data: { data: [] as Meeting[] } })),
          classApi.getAttachFiles(cls.id).catch(() => ({ data: { data: [] } })),
        ]);
        const exercises: AggregatedExercise[] = (exRes.data.data || []).map((ex) => ({
          ...ex,
          className: cls.name,
          classMemberCount: cls.member_count || 0,
        }));
        const meetings: AggregatedMeeting[] = (meetRes.data.data || []).map((m) => ({
          ...m,
          className: cls.name,
        }));
        return {
          exercises,
          meetings,
          attachCount: (attachRes.data.data || []).length,
        };
      });

      const [perClassResults, libDocsRes] = await Promise.all([
        Promise.all(perClassPromises),
        isLecturer
          ? documentApi.getAll().catch(() => ({ data: { data: [] } }))
          : Promise.resolve(null),
      ]);

      setAllExercises(perClassResults.flatMap((r) => r.exercises));
      setAllMeetings(perClassResults.flatMap((r) => r.meetings));

      if (isLecturer && libDocsRes) {
        const uniqueDocIds = new Set(
          (libDocsRes.data.data || [])
            .filter((row: { doc_id: number | null }) => row.doc_id !== null)
            .map((row: { doc_id: number | null }) => row.doc_id),
        );
        setTotalDocsCount(uniqueDocIds.size);
      } else {
        setTotalDocsCount(perClassResults.reduce((s, r) => s + r.attachCount, 0));
      }
    } catch {
      console.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClassName.trim()) return;
    setAddingClass(true);
    try {
      const res = await classApi.create(newClassName.trim());
      const newClass = (res.data as { data: ClassInfo }).data;
      setClasses((prev) => [newClass, ...prev]);
      setNewClassName('');
      setShowAddClass(false);
    } catch {
      alert('Không thể tạo lớp học');
    } finally {
      setAddingClass(false);
    }
  };

  // ── Real Computed Statistics ──────────────────────────────────
  const now = Date.now();
  const totalMembers = useMemo(
    () => classes.reduce((s, c) => s + (c.member_count || 0), 0),
    [classes],
  );
  const openClassesCount = useMemo(
    () => classes.filter((c) => c.is_open_students !== false).length,
    [classes],
  );
  const closedClassesCount = classes.length - openClassesCount;

  const activeExercisesCount = useMemo(
    () =>
      allExercises.filter((ex) => {
        const end = new Date(ex.end_time).getTime();
        return end >= now;
      }).length,
    [allExercises, now],
  );

  const avgCompletionRate = useMemo(() => {
    if (allExercises.length === 0) return 0;
    if (isLecturer) {
      const ratios = allExercises.map((ex) => {
        const denom = Math.max(ex.classMemberCount, 1);
        return Math.min(100, Math.round(((ex.submission_count || 0) / denom) * 100));
      });
      return Math.round(ratios.reduce((a, b) => a + b, 0) / ratios.length);
    }
    const submitted = allExercises.filter((ex) => ex.submission_status === 'submitted').length;
    return Math.round((submitted / allExercises.length) * 100);
  }, [allExercises, isLecturer]);

  const upcomingMeetings = useMemo(() => {
    return allMeetings
      .filter((m) => m.status !== 'ended' && new Date(m.end_time).getTime() >= now)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
      .slice(0, 4);
  }, [allMeetings, now]);

  // Activity chart data grouped by day of week (T2..CN)
  const activitySeries = useMemo(() => {
    const windowMs = (chartRange === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000;
    const exByDay = [0, 0, 0, 0, 0, 0, 0];
    const meetByDay = [0, 0, 0, 0, 0, 0, 0];

    const toMonIdx = (d: Date) => (d.getDay() + 6) % 7;

    allExercises.forEach((ex) => {
      const d = new Date(ex.start_time || ex.end_time);
      if (!Number.isNaN(d.getTime()) && Math.abs(now - d.getTime()) <= windowMs * 4) {
        exByDay[toMonIdx(d)] += 1;
      }
    });

    allMeetings.forEach((m) => {
      const d = new Date(m.start_time);
      if (!Number.isNaN(d.getTime()) && Math.abs(now - d.getTime()) <= windowMs * 4) {
        meetByDay[toMonIdx(d)] += 1;
      }
    });

    const maxVal = Math.max(4, ...exByDay, ...meetByDay);
    return { exByDay, meetByDay, maxVal };
  }, [allExercises, allMeetings, chartRange, now]);

  // Class status donut data
  const donutSegments = useMemo(() => {
    const activeMeetClassIds = new Set(upcomingMeetings.map((m) => m.class_id));
    const withUpcoming = classes.filter((c) => activeMeetClassIds.has(c.id)).length;
    const openOnly = Math.max(0, openClassesCount - withUpcoming);
    const total = Math.max(classes.length, 1);
    return {
      total: classes.length,
      items: [
        { label: 'Đang mở', count: openClassesCount, color: '#4F46E5' },
        { label: 'Có lịch học', count: withUpcoming, color: '#10B981' },
        { label: 'Đang khóa', count: closedClassesCount, color: '#94A3B8' },
      ],
      arcs: [
        { value: withUpcoming / total, color: '#10B981' },
        { value: openOnly / total, color: '#4F46E5' },
        { value: closedClassesCount / total, color: '#94A3B8' },
      ],
    };
  }, [classes, openClassesCount, closedClassesCount, upcomingMeetings]);

  const filteredClasses = useMemo(() => {
    if (!searchQuery.trim()) return classes;
    const q = searchQuery.toLowerCase();
    return classes.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.lecturer_name && c.lecturer_name.toLowerCase().includes(q)),
    );
  }, [classes, searchQuery]);

  // SVG Chart Geometry
  const chartW = 360;
  const chartH = 155;
  const padL = 28;
  const padR = 14;
  const padT = 14;
  const padB = 26;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const exPoints = activitySeries.exByDay.map((v, i) => ({
    x: padL + (i * innerW) / 6,
    y: padT + innerH - (v / activitySeries.maxVal) * innerH,
    v,
  }));
  const meetPoints = activitySeries.meetByDay.map((v, i) => ({
    x: padL + (i * innerW) / 6,
    y: padT + innerH - (v / activitySeries.maxVal) * innerH,
    v,
  }));

  const exLine = buildSmoothPath(exPoints);
  const meetLine = buildSmoothPath(meetPoints);
  const exArea = `${exLine} L ${exPoints[exPoints.length - 1].x} ${padT + innerH} L ${exPoints[0].x} ${padT + innerH} Z`;
  const meetArea = `${meetLine} L ${meetPoints[meetPoints.length - 1].x} ${padT + innerH} L ${meetPoints[0].x} ${padT + innerH} Z`;

  // Donut stroke math
  const donutR = 46;
  const donutC = 2 * Math.PI * donutR;

  const formatMeetingTime = (m: AggregatedMeeting) => {
    const s = new Date(m.start_time);
    const e = new Date(m.end_time);
    const dowNames = ['CN', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
    return {
      dow: dowNames[s.getDay()],
      day: String(s.getDate()).padStart(2, '0'),
      month: `Th${s.getMonth() + 1}`,
      time: `${s.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} – ${e.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`,
    };
  };

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).slice(-2).join('').toUpperCase()
    : '?';

  return (
    <div className="app-layout">
      <Sidebar classes={classes} />
      <div className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        {/* Top Header */}
        <header className="page-header">
          <div className="page-header-left">
            <MobileMenuButton />
            <div className="header-search-box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Tìm kiếm lớp học, giảng viên..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isLecturer && (
              <button id="btn-add-class" className="btn btn-primary btn-sm" onClick={() => setShowAddClass(true)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Tạo lớp mới
              </button>
            )}
            <div
              className="user-avatar"
              style={{ cursor: 'pointer' }}
              title={user?.name}
              onClick={() => navigate('/settings')}
            >
              {initials}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="page-content">
          {/* Welcome Hero Banner */}
          <div className="hero-banner">
            <div className="hero-banner-content">
              <h1 className="hero-banner-title">
                Xin chào, {user?.name}! 👋
              </h1>
              <p className="hero-banner-subtitle">
                {isLecturer
                  ? 'Chúc bạn một ngày giảng dạy hiệu quả cùng hệ thống Elearn & Trợ lý AI'
                  : 'Chúc bạn một ngày học tập hiệu quả cùng hệ thống Elearn & Trợ giảng AI'}
              </p>
            </div>
            <div className="hero-banner-art" aria-hidden="true">
              <svg width="128" height="84" viewBox="0 0 128 84" fill="none">
                <rect x="20" y="42" width="84" height="30" rx="8" fill="#6366F1" fillOpacity="0.16" />
                <rect x="30" y="34" width="64" height="28" rx="6" fill="#4F46E5" fillOpacity="0.22" />
                <path d="M64 10L24 26L64 42L104 26L64 10Z" fill="#4F46E5" />
                <path d="M40 33V48C40 53 50.7 57 64 57C77.3 57 88 53 88 48V33L64 43L40 33Z" fill="#312E81" />
                <line x1="100" y1="28" x2="100" y2="48" stroke="#F59E0B" strokeWidth="3" strokeLinecap="round" />
                <circle cx="100" cy="51" r="4" fill="#F59E0B" />
              </svg>
            </div>
          </div>

          {/* Student Face Profile Reminder Banner */}
          {!isLecturer &&
            faceProfile &&
            (faceProfile.reviewStatus === 'unregistered' || faceProfile.reviewStatus === 'rejected') && (
              <div
                style={{
                  background: faceProfile.reviewStatus === 'rejected' ? 'var(--color-danger-subtle)' : 'var(--color-primary-subtle)',
                  border:
                    faceProfile.reviewStatus === 'rejected'
                      ? '1px solid rgba(239,68,68,0.3)'
                      : '1px solid rgba(99,102,241,0.3)',
                  borderRadius: 14,
                  padding: '16px 20px',
                  marginBottom: 24,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 15,
                      color: faceProfile.reviewStatus === 'rejected' ? 'var(--color-danger)' : 'var(--color-primary)',
                      marginBottom: 4,
                    }}
                  >
                    {faceProfile.reviewStatus === 'rejected'
                      ? '⚠️ Hồ sơ khuôn mặt của bạn bị từ chối — Cần chụp lại'
                      : '📸 Bạn chưa đăng ký hồ sơ khuôn mặt (4 ảnh)'}
                  </div>
                  <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)' }}>
                    {faceProfile.reviewStatus === 'rejected'
                      ? `Lý do từ chối: ${faceProfile.rejectReason || 'Ảnh chưa đạt yêu cầu'}. Vui lòng chụp lại 4 ảnh để sử dụng điểm danh tự động & thi.`
                      : 'Đăng ký khuôn mặt giúp bạn điểm danh tự động trong phòng học trực tuyến và xác thực nhanh trước khi vào phòng thi.'}
                  </div>
                </div>
                <button className="btn btn-primary" onClick={() => navigate('/face-profile')}>
                  {faceProfile.reviewStatus === 'rejected' ? 'Chụp lại ngay →' : 'Đăng ký ngay →'}
                </button>
              </div>
            )}

          {/* 4 KPI Stat Cards */}
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-icon" style={{ background: '#EEF2FF' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" width="22" height="22">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <div className="kpi-body">
                <div className="kpi-top">
                  <span className="kpi-value">{isLecturer ? totalMembers : classes.length}</span>
                  <span className="kpi-trend up">{classes.length} lớp</span>
                </div>
                <div className="kpi-label">{isLecturer ? 'Tổng học viên' : 'Lớp đang tham gia'}</div>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon" style={{ background: '#EFF6FF' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" width="22" height="22">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
              </div>
              <div className="kpi-body">
                <div className="kpi-top">
                  <span className="kpi-value">{isLecturer ? openClassesCount : activeExercisesCount}</span>
                  <span className="kpi-trend info">
                    {isLecturer ? `${closedClassesCount} đang khóa` : `${allExercises.length} tổng`}
                  </span>
                </div>
                <div className="kpi-label">{isLecturer ? 'Lớp đang mở' : 'Bài tập đang mở'}</div>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon" style={{ background: '#ECFDF5' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" width="22" height="22">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <div className="kpi-body">
                <div className="kpi-top">
                  <span className="kpi-value">{avgCompletionRate}%</span>
                  <span className="kpi-trend up">{allExercises.length} bài tập</span>
                </div>
                <div className="kpi-label">Tỷ lệ hoàn thành TB</div>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon" style={{ background: '#FFF7ED' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" width="22" height="22">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </div>
              <div className="kpi-body">
                <div className="kpi-top">
                  <span className="kpi-value">{totalDocsCount}</span>
                  <span className="kpi-trend info">{upcomingMeetings.length} buổi tới</span>
                </div>
                <div className="kpi-label">{isLecturer ? 'Tài liệu trong kho' : 'Tài liệu lớp học'}</div>
              </div>
            </div>
          </div>

          {/* 3-Column Analytics Row */}
          <div className="analytics-grid-3">
            {/* 1. Thống kê hoạt động */}
            <div className="widget-card">
              <div className="widget-header">
                <h2 className="widget-title">Thống kê hoạt động</h2>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={`btn btn-sm ${chartRange === '7d' ? 'btn-secondary' : 'btn-ghost'}`}
                    onClick={() => setChartRange('7d')}
                  >
                    7 ngày
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${chartRange === '30d' ? 'btn-secondary' : 'btn-ghost'}`}
                    onClick={() => setChartRange('30d')}
                  >
                    30 ngày
                  </button>
                </div>
              </div>

              <div className="chart-legend">
                <span className="chart-legend-item">
                  <span className="chart-legend-dot" style={{ background: '#4F46E5' }} />
                  Bài tập ({allExercises.length})
                </span>
                <span className="chart-legend-item">
                  <span className="chart-legend-dot" style={{ background: '#38BDF8' }} />
                  Buổi học ({allMeetings.length})
                </span>
              </div>

              <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
                <defs>
                  <linearGradient id="dashExGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4F46E5" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#4F46E5" stopOpacity="0.01" />
                  </linearGradient>
                  <linearGradient id="dashMeetGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.01" />
                  </linearGradient>
                </defs>

                {[0, 0.5, 1].map((t, idx) => {
                  const y = padT + innerH * (1 - t);
                  const val = Math.round(activitySeries.maxVal * t);
                  return (
                    <g key={idx}>
                      <line
                        x1={padL}
                        y1={y}
                        x2={chartW - padR}
                        y2={y}
                        stroke="var(--color-border)"
                        strokeDasharray="3 3"
                        strokeWidth="1"
                      />
                      <text x={padL - 8} y={y + 3} textAnchor="end" fontSize="10" fill="var(--color-text-muted)">
                        {val}
                      </text>
                    </g>
                  );
                })}

                <path d={exArea} fill="url(#dashExGrad)" />
                <path d={meetArea} fill="url(#dashMeetGrad)" />
                <path d={exLine} fill="none" stroke="#4F46E5" strokeWidth="2.4" strokeLinecap="round" />
                <path d={meetLine} fill="none" stroke="#38BDF8" strokeWidth="2.4" strokeLinecap="round" />

                {exPoints.map((p, i) => (
                  <g key={`ex-${i}`}>
                    <circle cx={p.x} cy={p.y} r="3.5" fill="#ffffff" stroke="#4F46E5" strokeWidth="2">
                      <title>{`${DAY_LABELS[i]}: ${p.v} bài tập`}</title>
                    </circle>
                    <text
                      x={p.x}
                      y={chartH - 6}
                      textAnchor="middle"
                      fontSize="10.5"
                      fill="var(--color-text-muted)"
                    >
                      {DAY_LABELS[i]}
                    </text>
                  </g>
                ))}
                {meetPoints.map((p, i) => (
                  <circle key={`mt-${i}`} cx={p.x} cy={p.y} r="3.2" fill="#ffffff" stroke="#38BDF8" strokeWidth="2">
                    <title>{`${DAY_LABELS[i]}: ${p.v} buổi học`}</title>
                  </circle>
                ))}
              </svg>
            </div>

            {/* 2. Trạng thái lớp học */}
            <div className="widget-card">
              <div className="widget-header">
                <h2 className="widget-title">Trạng thái lớp học</h2>
              </div>
              <div className="donut-wrap">
                <svg width="124" height="124" viewBox="0 0 124 124">
                  <circle
                    cx="62"
                    cy="62"
                    r={donutR}
                    fill="none"
                    stroke="var(--color-border-subtle)"
                    strokeWidth="14"
                  />
                  {(() => {
                    let offset = 0;
                    return donutSegments.arcs.map((arc, idx) => {
                      const dash = arc.value * donutC;
                      const el = (
                        <circle
                          key={idx}
                          cx="62"
                          cy="62"
                          r={donutR}
                          fill="none"
                          stroke={arc.color}
                          strokeWidth="14"
                          strokeDasharray={`${dash} ${donutC - dash}`}
                          strokeDashoffset={-offset}
                          transform="rotate(-90 62 62)"
                          strokeLinecap={dash > 0 ? 'butt' : 'butt'}
                        />
                      );
                      offset += dash;
                      return el;
                    });
                  })()}
                  <text
                    x="62"
                    y="58"
                    textAnchor="middle"
                    fontSize="22"
                    fontWeight="800"
                    fill="var(--color-text-primary)"
                  >
                    {donutSegments.total}
                  </text>
                  <text
                    x="62"
                    y="75"
                    textAnchor="middle"
                    fontSize="11"
                    fill="var(--color-text-muted)"
                  >
                    Lớp học
                  </text>
                </svg>

                <div className="donut-legend">
                  {donutSegments.items.map((item) => (
                    <div key={item.label} className="donut-legend-row">
                      <span className="chart-legend-item">
                        <span className="chart-legend-dot" style={{ background: item.color }} />
                        {item.label}
                      </span>
                      <strong style={{ color: 'var(--color-text-primary)' }}>{item.count}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 3. Lịch học sắp tới */}
            <div className="widget-card">
              <div className="widget-header">
                <h2 className="widget-title">Lịch học sắp tới</h2>
                <span className="badge badge-primary">{upcomingMeetings.length} buổi</span>
              </div>

              {upcomingMeetings.length === 0 ? (
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    padding: '18px 8px',
                    color: 'var(--color-text-muted)',
                    fontSize: 13,
                    gap: 8,
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="28" height="28">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <span>Chưa có buổi học sắp tới nào</span>
                </div>
              ) : (
                <div className="schedule-list">
                  {upcomingMeetings.map((m) => {
                    const fmt = formatMeetingTime(m);
                    const isLive = m.status === 'started';
                    return (
                      <div
                        key={m.id}
                        className="schedule-item"
                        onClick={() => navigate(`/class/${m.class_id}?tab=meetings`)}
                      >
                        <div className="schedule-date-box">
                          <div className="schedule-date-dow">{fmt.dow}</div>
                          <div className="schedule-date-day">{fmt.day}</div>
                          <div className="schedule-date-month">{fmt.month}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            className="truncate"
                            style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}
                          >
                            {m.className}
                          </div>
                          <div className="truncate" style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                            {m.name} · {fmt.time}
                          </div>
                        </div>
                        <span className={`badge ${isLive ? 'badge-success' : 'badge-info'}`}>
                          {isLive ? 'Đang diễn ra' : 'Trực tuyến'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Classes Grid (kept in card format as requested) */}
          <div className="flex items-center justify-between mb-4">
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              {isLecturer ? 'Lớp học của tôi' : 'Lớp đang tham gia'} ({filteredClasses.length})
            </h2>
          </div>

          {loading ? (
            <div className="page-loading">
              <div className="spinner" />
            </div>
          ) : filteredClasses.length === 0 ? (
            <div className="empty-state card">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                </svg>
              </div>
              <div className="empty-state-title">
                {searchQuery ? 'Không tìm thấy lớp học phù hợp' : 'Chưa có lớp học nào'}
              </div>
              <div className="empty-state-desc">
                {searchQuery
                  ? 'Thử tìm với từ khóa khác'
                  : isLecturer
                  ? 'Nhấn "Tạo lớp mới" để bắt đầu tạo lớp học đầu tiên'
                  : 'Liên hệ giảng viên để nhận link mời vào lớp'}
              </div>
            </div>
          ) : (
            <div className="class-grid">
              {filteredClasses.map((cls, idx) => (
                <div
                  key={cls.id}
                  id={`class-card-${cls.id}`}
                  className="class-card"
                  onClick={() => navigate(`/class/${cls.id}`)}
                >
                  <div
                    className="class-card-banner"
                    style={{
                      background: `linear-gradient(135deg, ${CLASS_COLORS[idx % CLASS_COLORS.length]}, ${CLASS_COLORS[(idx + 2) % CLASS_COLORS.length]})`,
                    }}
                  >
                    <div className="class-card-name">{cls.name}</div>
                  </div>
                  <div className="class-card-body">
                    <div className="class-card-meta">
                      {!isLecturer && cls.lecturer_name && (
                        <div className="class-card-lecturer">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                          {cls.lecturer_name}
                        </div>
                      )}
                      <div className="class-card-member">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                        {cls.member_count || 0} học viên
                      </div>
                    </div>
                    <div className="class-card-footer">
                      <span className="badge badge-primary" style={{ fontSize: 10 }}>
                        {isLecturer ? 'Giảng viên' : 'Sinh viên'}
                      </span>
                      {cls.is_open_students && isLecturer && (
                        <span className="badge badge-success" style={{ fontSize: 10 }}>
                          Đang mở
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {isLecturer && (
                <div
                  id="class-card-add"
                  className="class-card"
                  style={{
                    border: '2px dashed var(--color-border)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 160,
                  }}
                  onClick={() => setShowAddClass(true)}
                >
                  <div style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: '50%',
                        background: 'var(--color-bg)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 8px',
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Tạo lớp mới</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Add Class Modal */}
      {showAddClass && (
        <div className="modal-overlay" onClick={() => setShowAddClass(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Tạo lớp học mới</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowAddClass(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleCreateClass}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label" htmlFor="new-class-name">
                    Tên lớp học
                  </label>
                  <input
                    id="new-class-name"
                    type="text"
                    className="form-input"
                    placeholder="VD: Lập trình Web (Nhóm 1)"
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowAddClass(false)}>
                  Hủy
                </button>
                <button id="btn-confirm-create-class" type="submit" className="btn btn-primary" disabled={addingClass}>
                  {addingClass ? (
                    <span
                      className="spinner"
                      style={{ width: 14, height: 14, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white' }}
                    />
                  ) : null}
                  Tạo lớp
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
