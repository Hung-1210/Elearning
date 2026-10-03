import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { classApi } from '../../api';
import { useAuthStore } from '../../store/authStore';
import type { ClassInfo } from '../../types';
import Sidebar from '../../components/layout/Sidebar';

const CLASS_COLORS = [
  '#4F46E5', '#7C3AED', '#2563EB', '#0891B2',
  '#059669', '#D97706', '#DC2626', '#DB2777',
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddClass, setShowAddClass] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [addingClass, setAddingClass] = useState(false);

  useEffect(() => {
    loadClasses();
  }, []);

  const loadClasses = async () => {
    try {
      const res = await classApi.getAll();
      setClasses(res.data.data || []);
    } catch {
      console.error('Failed to load classes');
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
      setClasses(prev => [newClass, ...prev]);
      setNewClassName('');
      setShowAddClass(false);
    } catch {
      alert('Không thể tạo lớp học');
    } finally {
      setAddingClass(false);
    }
  };

  const totalMembers = classes.reduce((s, c) => s + (c.member_count || 0), 0);

  return (
    <div className="app-layout">
      <Sidebar classes={classes} />
      <div className="main-content">
        {/* Header */}
        <header className="page-header">
          <div className="page-header-left">
            <div className="page-header-breadcrumb">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
              </svg>
              <span>Dashboard</span>
            </div>
            <h1 className="page-header-title">
              Xin chào, {user?.name?.split(' ').pop()} 👋
            </h1>
          </div>
          {user?.isLecturer && (
            <button id="btn-add-class" className="btn btn-primary" onClick={() => setShowAddClass(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Tạo lớp mới
            </button>
          )}
        </header>

        {/* Page Content */}
        <main className="page-content">
          {/* Stats Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: '#EEF2FF' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <div className="stat-body">
                <div className="stat-value">{classes.length}</div>
                <div className="stat-label">{user?.isLecturer ? 'Lớp quản lý' : 'Lớp đang học'}</div>
              </div>
            </div>

            {user?.isLecturer && (
              <div className="stat-card">
                <div className="stat-icon" style={{ background: '#F0FDF4' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                </div>
                <div className="stat-body">
                  <div className="stat-value">{totalMembers}</div>
                  <div className="stat-label">Tổng học viên</div>
                </div>
              </div>
            )}

            <div className="stat-card">
              <div className="stat-icon" style={{ background: '#FFF7ED' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
              </div>
              <div className="stat-body">
                <div className="stat-value">—</div>
                <div className="stat-label">{user?.isLecturer ? 'Bài tập đang mở' : 'Bài cần nộp'}</div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ background: '#EFF6FF' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                  <polygon points="23 7 16 12 23 17 23 7"/>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
              </div>
              <div className="stat-body">
                <div className="stat-value">—</div>
                <div className="stat-label">Buổi sắp tới</div>
              </div>
            </div>
          </div>

          {/* Classes Grid */}
          <div className="flex items-center justify-between mb-4">
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              {user?.isLecturer ? 'Lớp học của tôi' : 'Lớp đang tham gia'}
            </h2>
          </div>

          {loading ? (
            <div className="page-loading"><div className="spinner" /></div>
          ) : classes.length === 0 ? (
            <div className="empty-state card">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                </svg>
              </div>
              <div className="empty-state-title">Chưa có lớp học nào</div>
              <div className="empty-state-desc">
                {user?.isLecturer
                  ? 'Nhấn "Tạo lớp mới" để bắt đầu tạo lớp học đầu tiên'
                  : 'Liên hệ giảng viên để nhận link mời vào lớp'}
              </div>
            </div>
          ) : (
            <div className="class-grid">
              {classes.map((cls, idx) => (
                <div
                  key={cls.id}
                  id={`class-card-${cls.id}`}
                  className="class-card"
                  onClick={() => navigate(`/class/${cls.id}`)}
                >
                  <div className="class-card-banner" style={{ background: `linear-gradient(135deg, ${CLASS_COLORS[idx % CLASS_COLORS.length]}, ${CLASS_COLORS[(idx + 2) % CLASS_COLORS.length]})` }}>
                    <div className="class-card-name">{cls.name}</div>
                  </div>
                  <div className="class-card-body">
                    <div className="class-card-meta">
                      {!user?.isLecturer && cls.lecturer_name && (
                        <div className="class-card-lecturer">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                            <circle cx="12" cy="7" r="4"/>
                          </svg>
                          {cls.lecturer_name}
                        </div>
                      )}
                      <div className="class-card-member">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                          <circle cx="9" cy="7" r="4"/>
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                        {cls.member_count || 0} học viên
                      </div>
                    </div>
                    <div className="class-card-footer">
                      <span className="badge badge-primary" style={{ fontSize: 10 }}>
                        {user?.isLecturer ? 'Giảng viên' : 'Sinh viên'}
                      </span>
                      {cls.is_open_students && user?.isLecturer && (
                        <span className="badge badge-success" style={{ fontSize: 10 }}>Đang mở</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {user?.isLecturer && (
                <div
                  id="class-card-add"
                  className="class-card"
                  style={{ border: '2px dashed var(--color-border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 160 }}
                  onClick={() => setShowAddClass(true)}
                >
                  <div style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
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
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Tạo lớp học mới</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowAddClass(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <form onSubmit={handleCreateClass}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label" htmlFor="new-class-name">Tên lớp học</label>
                  <input
                    id="new-class-name"
                    type="text"
                    className="form-input"
                    placeholder="VD: Lập trình Web (Nhóm 1)"
                    value={newClassName}
                    onChange={e => setNewClassName(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowAddClass(false)}>Hủy</button>
                <button id="btn-confirm-create-class" type="submit" className="btn btn-primary" disabled={addingClass}>
                  {addingClass ? <span className="spinner" style={{ width: 14, height: 14, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white' }} /> : null}
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
