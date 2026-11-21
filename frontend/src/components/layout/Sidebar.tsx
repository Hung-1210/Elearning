import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useLayoutStore } from '../../store/layoutStore';
import { authApi, faceProfileApi } from '../../api';
import type { ClassInfo, FaceProfileMe } from '../../types';

const CLASS_COLORS = [
  '#4F46E5', '#7C3AED', '#2563EB', '#0891B2',
  '#059669', '#D97706', '#DC2626', '#DB2777',
];

export type ClassTabKey =
  | 'overview'
  | 'exercises'
  | 'meetings'
  | 'students'
  | 'face-profiles'
  | 'documents'
  | 'exams'
  | 'question-bank';

export interface ClassSidebarContext {
  classId: number;
  className: string;
  studentCount: number;
  isOpenStudents?: boolean;
  activeTab: ClassTabKey;
  onSelectTab: (tab: ClassTabKey) => void;
  pendingFaceCount?: number;
}

interface SidebarProps {
  classes: ClassInfo[];
  currentClassId?: number;
  classContext?: ClassSidebarContext;
}

interface FloatingTooltip {
  label: string;
  top: number;
  left: number;
}

/** Mobile hamburger button for opening the sidebar drawer on screens <= 768px */
export function MobileMenuButton() {
  const { toggleMobileSidebar } = useLayoutStore();
  return (
    <button
      type="button"
      className="mobile-menu-btn"
      onClick={toggleMobileSidebar}
      aria-label="Mở menu điều hướng"
      title="Mở menu"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="20" height="20">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    </button>
  );
}

export default function Sidebar({ classes, currentClassId, classContext }: SidebarProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const {
    sidebarCollapsed,
    toggleSidebar,
    mobileSidebarOpen,
    closeMobileSidebar,
  } = useLayoutStore();

  const [faceStatus, setFaceStatus] = useState<FaceProfileMe['reviewStatus'] | null>(null);
  const [tooltip, setTooltip] = useState<FloatingTooltip | null>(null);

  // Collapsible menu groups
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    mainMenu: true,
    myClasses: true,
    classManagement: true,
    toolsAi: true,
  });

  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    if (!user || user.isLecturer) return;
    const fetchStatus = () => {
      faceProfileApi
        .getMe()
        .then((res) => {
          setFaceStatus(res.data.data?.reviewStatus || 'unregistered');
        })
        .catch(() => {});
    };
    fetchStatus();
    window.addEventListener('face-profile-updated', fetchStatus);
    return () => window.removeEventListener('face-profile-updated', fetchStatus);
  }, [user?.userId, user?.isLecturer]);

  // Clear tooltip when sidebar expands or route/context changes
  useEffect(() => {
    setTooltip(null);
  }, [sidebarCollapsed, classContext?.classId, classContext?.activeTab]);

  // Close mobile drawer on Escape
  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMobileSidebar();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileSidebarOpen, closeMobileSidebar]);

  const faceDotColor =
    faceStatus === 'approved'
      ? '#10B981'
      : faceStatus === 'pending'
      ? '#F59E0B'
      : '#EF4444';

  const faceDotTitle =
    faceStatus === 'approved'
      ? 'Đã được duyệt'
      : faceStatus === 'pending'
      ? 'Đang chờ giảng viên duyệt'
      : faceStatus === 'rejected'
      ? 'Bị từ chối — Cần chụp lại'
      : 'Chưa đăng ký khuôn mặt';

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {}
    closeMobileSidebar();
    logout();
    navigate('/login');
  };

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).slice(-2).join('').toUpperCase()
    : '?';

  const isLecturer = Boolean(user?.isLecturer);
  const isClassMode = Boolean(classContext);
  const isCollapsed = sidebarCollapsed && !mobileSidebarOpen;

  const showTooltip = (e: React.MouseEvent<HTMLElement>, label: string) => {
    if (!isCollapsed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({
      label,
      top: rect.top + rect.height / 2,
      left: rect.right + 10,
    });
  };

  const hideTooltip = () => setTooltip(null);

  // Class mode menu items (preserving exact role permissions)
  const classManagementItems: {
    key: ClassTabKey;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      key: 'overview',
      label: 'Tổng quan',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
      ),
    },
    {
      key: 'exercises',
      label: 'Bài tập',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      ),
    },
    {
      key: 'meetings',
      label: 'Buổi học',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      ),
    },
    ...(isLecturer
      ? [
          {
            key: 'students' as ClassTabKey,
            label: 'Học viên',
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            ),
          },
        ]
      : []),
  ];

  const toolsAiItems: {
    key: ClassTabKey;
    label: string;
    badge?: number;
    icon: React.ReactNode;
  }[] = [
    ...(isLecturer
      ? [
          {
            key: 'face-profiles' as ClassTabKey,
            label: 'Khuôn mặt sinh viên',
            badge: classContext?.pendingFaceCount && classContext.pendingFaceCount > 0
              ? classContext.pendingFaceCount
              : undefined,
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 8V6a2 2 0 0 1 2-2h2" />
                <path d="M4 16v2a2 2 0 0 0 2 2h2" />
                <path d="M16 4h2a2 2 0 0 1 2 2v2" />
                <path d="M16 20h2a2 2 0 0 0 2-2v-2" />
                <circle cx="9" cy="10" r="1" />
                <circle cx="15" cy="10" r="1" />
                <path d="M9.5 15a3.5 3.5 0 0 0 5 0" />
              </svg>
            ),
          },
        ]
      : []),
    {
      key: 'documents',
      label: 'Tài liệu lớp',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      key: 'exams',
      label: 'Đề thi',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      ),
    },
    ...(isLecturer
      ? [
          {
            key: 'question-bank' as ClassTabKey,
            label: 'Ngân hàng câu hỏi',
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            ),
          },
        ]
      : []),
  ];

  const renderGroupHeader = (groupKey: string, title: string, extraStyle?: React.CSSProperties) => {
    if (isCollapsed) {
      return <div className="sidebar-collapsed-divider" />;
    }
    const isOpen = openGroups[groupKey];
    return (
      <button
        type="button"
        className="sidebar-group-header"
        style={extraStyle}
        onClick={() => toggleGroup(groupKey)}
        aria-expanded={isOpen}
      >
        <span>{title}</span>
        <svg
          className={`sidebar-group-chevron ${isOpen ? 'open' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          width="12"
          height="12"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    );
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileSidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={closeMobileSidebar}
          aria-hidden="true"
        />
      )}

      <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${mobileSidebarOpen ? 'open' : ''}`}>
        {/* Logo Header */}
        <div className="sidebar-logo">
          <div
            className="sidebar-logo-left"
            onClick={() => {
              closeMobileSidebar();
              navigate('/');
            }}
            style={{ cursor: 'pointer' }}
            title="Về Dashboard"
          >
            <div className="sidebar-logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" width="18" height="18">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            {!isCollapsed && <span className="sidebar-logo-text">E<span>learn</span></span>}
          </div>

          <div className="sidebar-logo-actions">
            <button
              type="button"
              id="btn-toggle-sidebar"
              className="sidebar-toggle-btn desktop-only-toggle"
              onClick={toggleSidebar}
              title={isCollapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                {isCollapsed ? (
                  <>
                    <polyline points="13 17 18 12 13 7" />
                    <polyline points="6 17 11 12 6 7" />
                  </>
                ) : (
                  <>
                    <polyline points="11 17 6 12 11 7" />
                    <polyline points="18 17 13 12 18 7" />
                  </>
                )}
              </svg>
            </button>

            <button
              type="button"
              className="sidebar-toggle-btn mobile-close-btn"
              onClick={closeMobileSidebar}
              aria-label="Đóng menu"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Navigation Body */}
        <nav className="sidebar-nav">
          {isClassMode && classContext ? (
            /* ── B. CHẾ ĐỘ QUẢN LÝ LỚP HỌC ───────────────────────────── */
            <>
              {/* Nút quay lại Dashboard */}
              <button
                type="button"
                id="btn-back-dashboard"
                className="sidebar-back-btn"
                onClick={() => {
                  closeMobileSidebar();
                  navigate('/');
                }}
                onMouseEnter={(e) => showTooltip(e, 'Quay lại Dashboard')}
                onMouseLeave={hideTooltip}
                title={isCollapsed ? 'Quay lại Dashboard' : ''}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="15" height="15">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
                {!isCollapsed && <span>Quay lại Dashboard</span>}
              </button>

              {/* Thẻ thông tin lớp hiện tại */}
              {isCollapsed ? (
                <div
                  className="sidebar-class-mini"
                  onMouseEnter={(e) =>
                    showTooltip(
                      e,
                      `${classContext.className} · ${classContext.studentCount} học viên · ${
                        classContext.isOpenStudents === false ? 'Đang khóa' : 'Đang mở'
                      }`,
                    )
                  }
                  onMouseLeave={hideTooltip}
                  title={`${classContext.className} (${classContext.studentCount} học viên)`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" width="18" height="18">
                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                  </svg>
                  <span
                    className="sidebar-class-mini-dot"
                    style={{
                      background: classContext.isOpenStudents === false ? '#94A3B8' : '#10B981',
                    }}
                  />
                </div>
              ) : (
                <div className="sidebar-class-card">
                  <div className="sidebar-class-card-top">
                    <div className="sidebar-class-card-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" width="18" height="18">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                      </svg>
                    </div>
                    <div className="sidebar-class-card-meta">
                      <div className="sidebar-class-card-name" title={classContext.className}>
                        {classContext.className}
                      </div>
                      <div className="sidebar-class-card-count">
                        {classContext.studentCount} học viên
                      </div>
                    </div>
                  </div>
                  <div className="sidebar-class-card-status">
                    <span
                      className={`sidebar-status-pill ${
                        classContext.isOpenStudents === false ? 'closed' : 'open'
                      }`}
                    >
                      <span className="sidebar-status-dot" />
                      {classContext.isOpenStudents === false ? 'Đang khóa' : 'Đang mở'}
                    </span>
                  </div>
                </div>
              )}

              {/* NHÓM 1: QUẢN LÝ LỚP HỌC */}
              {renderGroupHeader('classManagement', 'Quản lý lớp học', { marginTop: 12 })}
              {(isCollapsed || openGroups.classManagement) && (
                <div className="sidebar-group-items">
                  {classManagementItems.map((item) => {
                    const isActive = classContext.activeTab === item.key;
                    return (
                      <button
                        type="button"
                        key={item.key}
                        id={`tab-${item.key}`}
                        className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => {
                          classContext.onSelectTab(item.key);
                          closeMobileSidebar();
                        }}
                        onMouseEnter={(e) => showTooltip(e, item.label)}
                        onMouseLeave={hideTooltip}
                        title={isCollapsed ? item.label : ''}
                      >
                        {item.icon}
                        {!isCollapsed && <span className="nav-label">{item.label}</span>}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* NHÓM 2: CÔNG CỤ & AI */}
              {renderGroupHeader('toolsAi', 'Công cụ & AI', { marginTop: 12 })}
              {(isCollapsed || openGroups.toolsAi) && (
                <div className="sidebar-group-items">
                  {toolsAiItems.map((item) => {
                    const isActive = classContext.activeTab === item.key;
                    const tooltipText = item.badge
                      ? `${item.label} (${item.badge} chờ duyệt)`
                      : item.label;
                    return (
                      <button
                        type="button"
                        key={item.key}
                        id={`tab-${item.key}`}
                        className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => {
                          classContext.onSelectTab(item.key);
                          closeMobileSidebar();
                        }}
                        onMouseEnter={(e) => showTooltip(e, tooltipText)}
                        onMouseLeave={hideTooltip}
                        title={isCollapsed ? tooltipText : ''}
                        style={{ position: 'relative' }}
                      >
                        {item.icon}
                        {!isCollapsed && (
                          <span className="nav-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                            <span className="truncate">{item.label}</span>
                            {item.badge !== undefined && (
                              <span className="sidebar-badge">{item.badge}</span>
                            )}
                          </span>
                        )}
                        {isCollapsed && item.badge !== undefined && (
                          <span className="sidebar-collapsed-badge" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            /* ── A. CHẾ ĐỘ TOÀN HỆ THỐNG (DASHBOARD) ─────────────────── */
            <>
              {renderGroupHeader('mainMenu', 'Menu chính', { marginTop: 2 })}
              {(isCollapsed || openGroups.mainMenu) && (
                <div className="sidebar-group-items">
                  <NavLink
                    to="/"
                    id="nav-dashboard"
                    className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                    onClick={closeMobileSidebar}
                    onMouseEnter={(e) => showTooltip(e, 'Tổng quan')}
                    onMouseLeave={hideTooltip}
                    title={isCollapsed ? 'Tổng quan' : ''}
                    end
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="7" height="7" />
                      <rect x="14" y="3" width="7" height="7" />
                      <rect x="14" y="14" width="7" height="7" />
                      <rect x="3" y="14" width="7" height="7" />
                    </svg>
                    {!isCollapsed && <span className="nav-label">Tổng quan</span>}
                  </NavLink>

                  {isLecturer && (
                    <NavLink
                      to="/documents"
                      id="nav-documents"
                      className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                      onClick={closeMobileSidebar}
                      onMouseEnter={(e) => showTooltip(e, 'Tài liệu')}
                      onMouseLeave={hideTooltip}
                      title={isCollapsed ? 'Tài liệu' : ''}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                        <polyline points="10 9 9 9 8 9" />
                      </svg>
                      {!isCollapsed && <span className="nav-label">Tài liệu</span>}
                    </NavLink>
                  )}

                  {!isLecturer && (
                    <NavLink
                      to="/face-profile"
                      id="nav-face-profile"
                      className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                      onClick={closeMobileSidebar}
                      onMouseEnter={(e) => showTooltip(e, `Khuôn mặt của tôi (${faceDotTitle})`)}
                      onMouseLeave={hideTooltip}
                      title={isCollapsed ? `Khuôn mặt của tôi (${faceDotTitle})` : faceDotTitle}
                      style={{ position: 'relative' }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 8V6a2 2 0 0 1 2-2h2" />
                        <path d="M4 16v2a2 2 0 0 0 2 2h2" />
                        <path d="M16 4h2a2 2 0 0 1 2 2v2" />
                        <path d="M16 20h2a2 2 0 0 0 2-2v-2" />
                        <circle cx="9" cy="10" r="1" />
                        <circle cx="15" cy="10" r="1" />
                        <path d="M9.5 15a3.5 3.5 0 0 0 5 0" />
                      </svg>
                      {!isCollapsed && (
                        <span
                          className="nav-label"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flex: 1,
                          }}
                        >
                          <span>Khuôn mặt của tôi</span>
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: faceDotColor,
                              display: 'inline-block',
                              boxShadow: '0 0 0 2px rgba(255,255,255,0.2)',
                            }}
                          />
                        </span>
                      )}
                      {isCollapsed && (
                        <span
                          style={{
                            position: 'absolute',
                            top: 8,
                            right: 10,
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: faceDotColor,
                          }}
                        />
                      )}
                    </NavLink>
                  )}

                  <NavLink
                    to="/settings"
                    id="nav-settings"
                    className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                    onClick={closeMobileSidebar}
                    onMouseEnter={(e) => showTooltip(e, 'Cài đặt')}
                    onMouseLeave={hideTooltip}
                    title={isCollapsed ? 'Cài đặt' : ''}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    {!isCollapsed && <span className="nav-label">Cài đặt</span>}
                  </NavLink>
                </div>
              )}

              {/* Danh sách lớp học (mở nhanh) */}
              {classes.length > 0 && (
                <>
                  {renderGroupHeader('myClasses', 'Lớp học của tôi', { marginTop: 14 })}
                  {(isCollapsed || openGroups.myClasses) && (
                    <div className="sidebar-group-items">
                      {classes.map((cls, idx) => (
                        <div
                          key={cls.id}
                          id={`nav-class-${cls.id}`}
                          className={`sidebar-class-item ${currentClassId === cls.id ? 'active' : ''}`}
                          onClick={() => {
                            closeMobileSidebar();
                            navigate(`/class/${cls.id}`);
                          }}
                          onMouseEnter={(e) => showTooltip(e, cls.name)}
                          onMouseLeave={hideTooltip}
                          title={isCollapsed ? cls.name : ''}
                        >
                          <div
                            className="sidebar-class-dot"
                            style={{ background: CLASS_COLORS[idx % CLASS_COLORS.length] }}
                          />
                          {!isCollapsed && <span className="nav-label">{cls.name}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </nav>

        {/* Footer user (giữ nguyên như cũ) */}
        <div className="sidebar-footer">
          <div
            className="sidebar-user"
            id="sidebar-user"
            onClick={handleLogout}
            onMouseEnter={(e) => showTooltip(e, `Đăng xuất: ${user?.name || ''}`)}
            onMouseLeave={hideTooltip}
            title={isCollapsed ? `Đăng xuất: ${user?.name}` : 'Đăng xuất'}
          >
            <div className="user-avatar">{initials}</div>
            {!isCollapsed && (
              <div className="user-info">
                <div className="user-name">{user?.name}</div>
                <div className="user-role">{user?.isLecturer ? 'Giảng viên' : 'Sinh viên'}</div>
              </div>
            )}
            {!isCollapsed && (
              <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" width="16" height="16">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            )}
          </div>
        </div>
      </aside>

      {/* Floating Tooltip when Sidebar is collapsed */}
      {isCollapsed && tooltip && (
        <div
          className="sidebar-floating-tooltip"
          style={{ top: tooltip.top, left: tooltip.left }}
          role="tooltip"
        >
          {tooltip.label}
        </div>
      )}
    </>
  );
}
