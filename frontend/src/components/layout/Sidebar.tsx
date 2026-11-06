import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useLayoutStore } from '../../store/layoutStore';
import { authApi } from '../../api';
import type { ClassInfo } from '../../types';

const CLASS_COLORS = [
  '#4F46E5', '#7C3AED', '#2563EB', '#0891B2',
  '#059669', '#D97706', '#DC2626', '#DB2777',
];

interface SidebarProps {
  classes: ClassInfo[];
  currentClassId?: number;
}

export default function Sidebar({ classes, currentClassId }: SidebarProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar } = useLayoutStore();

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {}
    logout();
    navigate('/login');
  };

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).slice(-2).join('').toUpperCase()
    : '?';

  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-left">
          <div className="sidebar-logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" width="18" height="18">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          {!sidebarCollapsed && <span className="sidebar-logo-text">E<span>learn</span></span>}
        </div>
        <button
          type="button"
          id="btn-toggle-sidebar"
          className="sidebar-toggle-btn"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
            {sidebarCollapsed ? (
              <polyline points="9 18 15 12 9 6" />
            ) : (
              <polyline points="15 18 9 12 15 6" />
            )}
          </svg>
        </button>
      </div>

      {/* Main Nav */}
      <nav className="sidebar-nav">
        {!sidebarCollapsed && <span className="sidebar-section-label">Menu chính</span>}

        <NavLink to="/" id="nav-dashboard"
          className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
          title={sidebarCollapsed ? "Tổng quan" : ""}
          end
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
          </svg>
          {!sidebarCollapsed && <span className="nav-label">Tổng quan</span>}
        </NavLink>

        {user?.isLecturer && (
          <NavLink to="/documents" id="nav-documents"
            className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
            title={sidebarCollapsed ? "Tài liệu" : ""}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            {!sidebarCollapsed && <span className="nav-label">Tài liệu</span>}
          </NavLink>
        )}

        {/* Class list */}
        {classes.length > 0 && (
          <>
            {!sidebarCollapsed && <span className="sidebar-section-label" style={{ marginTop: 16 }}>Lớp học của tôi</span>}
            {classes.map((cls, idx) => (
              <div
                key={cls.id}
                id={`nav-class-${cls.id}`}
                className={`sidebar-class-item ${currentClassId === cls.id ? 'active' : ''}`}
                onClick={() => navigate(`/class/${cls.id}`)}
                title={sidebarCollapsed ? cls.name : ""}
              >
                <div
                  className="sidebar-class-dot"
                  style={{ background: CLASS_COLORS[idx % CLASS_COLORS.length] }}
                />
                {!sidebarCollapsed && <span className="nav-label">{cls.name}</span>}
              </div>
            ))}
          </>
        )}
      </nav>

      {/* Footer user */}
      <div className="sidebar-footer">
        <div className="sidebar-user" id="sidebar-user" onClick={handleLogout} title={sidebarCollapsed ? `Đăng xuất: ${user?.name}` : "Đăng xuất"}>
          <div className="user-avatar">{initials}</div>
          {!sidebarCollapsed && (
            <div className="user-info">
              <div className="user-name">{user?.name}</div>
              <div className="user-role">{user?.isLecturer ? 'Giảng viên' : 'Sinh viên'}</div>
            </div>
          )}
          {!sidebarCollapsed && (
            <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" width="16" height="16">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          )}
        </div>
      </div>
    </aside>
  );
}

