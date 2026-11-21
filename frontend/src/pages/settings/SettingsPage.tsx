import React, { useEffect, useState } from 'react';
import Sidebar, { MobileMenuButton } from '../../components/layout/Sidebar';
import { authApi, classApi } from '../../api';
import { useAuthStore } from '../../store/authStore';
import { useLayoutStore } from '../../store/layoutStore';
import type { ClassInfo } from '../../types';

export default function SettingsPage() {
  const { user } = useAuthStore();
  const { sidebarCollapsed, theme, setTheme } = useLayoutStore();
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [loginId, setLoginId] = useState<string>('');

  // Change password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);

  useEffect(() => {
    classApi
      .getAll()
      .then((res) => setClasses(res.data.data || []))
      .catch(() => {});

    authApi
      .getMe()
      .then((res) => {
        if (res.data.data?.user?.loginId) {
          setLoginId(res.data.data.user.loginId);
        }
      })
      .catch(() => {});
  }, []);

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((w) => w[0])
        .slice(-2)
        .join('')
        .toUpperCase()
    : '?';

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPwError('Vui lòng điền đầy đủ các trường mật khẩu.');
      return;
    }
    if (newPassword.length < 6) {
      setPwError('Mật khẩu mới phải có tối thiểu 6 ký tự.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('Mật khẩu xác nhận không khớp với mật khẩu mới.');
      return;
    }
    if (currentPassword === newPassword) {
      setPwError('Mật khẩu mới phải khác mật khẩu hiện tại.');
      return;
    }

    setSavingPw(true);
    try {
      const res = await authApi.changePassword(currentPassword, newPassword);
      setPwSuccess(res.data.message || 'Đổi mật khẩu thành công!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPwError(
        err.response?.data?.error || 'Không thể đổi mật khẩu. Vui lòng thử lại.',
      );
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="app-layout">
      <Sidebar classes={classes} />

      <div className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <header className="page-header">
          <div className="page-header-left">
            <MobileMenuButton />
            <div>
              <h1 className="page-title">Cài đặt</h1>
              <p className="text-sm text-muted">
                Quản lý giao diện hiển thị (Sáng/Tối) và bảo mật tài khoản của bạn
              </p>
            </div>
          </div>
        </header>

        <main className="page-content" style={{ maxWidth: 880, width: '100%', margin: '0 auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* ── 1. Thông tin tài khoản ── */}
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Thông tin tài khoản</h2>
              </div>
              <div
                className="card-body"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 20,
                  flexWrap: 'wrap',
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {initials}
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: 16,
                    flex: 1,
                  }}
                >
                  <div>
                    <div className="text-xs text-muted" style={{ marginBottom: 4 }}>
                      HỌ VÀ TÊN
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {user?.name || '--'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted" style={{ marginBottom: 4 }}>
                      TÊN ĐĂNG NHẬP
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>
                      {loginId || '--'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted" style={{ marginBottom: 4 }}>
                      VAI TRÒ
                    </div>
                    <span className="badge badge-primary">
                      {user?.isLecturer ? 'Giảng viên' : 'Sinh viên'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── 2. Chế độ giao diện Sáng / Tối ── */}
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Giao diện hiển thị</h2>
                  <p className="text-sm text-muted" style={{ marginTop: 2 }}>
                    Tùy chỉnh chế độ Sáng hoặc Tối để bảo vệ mắt khi học tập và giảng dạy
                  </p>
                </div>
              </div>

              <div className="card-body">
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: 16,
                  }}
                >
                  {/* Card Giao diện Sáng */}
                  <button
                    type="button"
                    id="btn-theme-light"
                    onClick={() => setTheme('light')}
                    style={{
                      textAlign: 'left',
                      padding: 16,
                      borderRadius: 14,
                      border:
                        theme === 'light'
                          ? '2px solid var(--color-primary)'
                          : '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div
                      style={{
                        height: 84,
                        borderRadius: 10,
                        background: '#F8FAFC',
                        border: '1px solid #E2E8F0',
                        display: 'flex',
                        overflow: 'hidden',
                        marginBottom: 12,
                      }}
                    >
                      <div style={{ width: 42, background: '#1E1B4B' }} />
                      <div style={{ flex: 1, padding: 10 }}>
                        <div
                          style={{
                            width: '55%',
                            height: 8,
                            borderRadius: 4,
                            background: '#CBD5E1',
                            marginBottom: 8,
                          }}
                        />
                        <div
                          style={{
                            width: '85%',
                            height: 28,
                            borderRadius: 6,
                            background: '#FFFFFF',
                            border: '1px solid #E2E8F0',
                          }}
                        />
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 14.5,
                            fontWeight: 700,
                            color: 'var(--color-text-primary)',
                          }}
                        >
                          ☀️ Giao diện Sáng
                        </div>
                        <div className="text-xs text-muted">
                          Nền sáng rõ ràng, phù hợp ban ngày
                        </div>
                      </div>
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          border:
                            theme === 'light'
                              ? '6px solid var(--color-primary)'
                              : '2px solid var(--color-border)',
                        }}
                      />
                    </div>
                  </button>

                  {/* Card Giao diện Tối */}
                  <button
                    type="button"
                    id="btn-theme-dark"
                    onClick={() => setTheme('dark')}
                    style={{
                      textAlign: 'left',
                      padding: 16,
                      borderRadius: 14,
                      border:
                        theme === 'dark'
                          ? '2px solid var(--color-primary)'
                          : '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div
                      style={{
                        height: 84,
                        borderRadius: 10,
                        background: '#0F172A',
                        border: '1px solid #334155',
                        display: 'flex',
                        overflow: 'hidden',
                        marginBottom: 12,
                      }}
                    >
                      <div style={{ width: 42, background: '#090D16' }} />
                      <div style={{ flex: 1, padding: 10 }}>
                        <div
                          style={{
                            width: '55%',
                            height: 8,
                            borderRadius: 4,
                            background: '#475569',
                            marginBottom: 8,
                          }}
                        />
                        <div
                          style={{
                            width: '85%',
                            height: 28,
                            borderRadius: 6,
                            background: '#1E293B',
                            border: '1px solid #334155',
                          }}
                        />
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 14.5,
                            fontWeight: 700,
                            color: 'var(--color-text-primary)',
                          }}
                        >
                          🌙 Giao diện Tối
                        </div>
                        <div className="text-xs text-muted">
                          Dịu mắt khi làm việc trong môi trường thiếu sáng
                        </div>
                      </div>
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          border:
                            theme === 'dark'
                              ? '6px solid var(--color-primary)'
                              : '2px solid var(--color-border)',
                        }}
                      />
                    </div>
                  </button>
                </div>
              </div>
            </div>

            {/* ── 3. Đổi mật khẩu ── */}
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Đổi mật khẩu</h2>
                  <p className="text-sm text-muted" style={{ marginTop: 2 }}>
                    Cập nhật mật khẩu định kỳ để bảo vệ tài khoản học tập của bạn
                  </p>
                </div>
              </div>

              <form className="card-body" onSubmit={handleChangePassword}>
                {pwError && (
                  <div
                    style={{
                      maxWidth: 480,
                      margin: '0 auto 16px',
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: 'var(--color-danger-subtle)',
                      border: '1px solid var(--color-danger)',
                      color: 'var(--color-danger)',
                      fontSize: 13.5,
                      fontWeight: 600,
                    }}
                  >
                    ⚠️ {pwError}
                  </div>
                )}

                {pwSuccess && (
                  <div
                    style={{
                      maxWidth: 480,
                      margin: '0 auto 16px',
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: 'var(--color-success-subtle)',
                      border: '1px solid var(--color-success)',
                      color: 'var(--color-success)',
                      fontSize: 13.5,
                      fontWeight: 600,
                    }}
                  >
                    ✓ {pwSuccess}
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                    maxWidth: 480,
                    width: '100%',
                    margin: '0 auto',
                  }}
                >
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Mật khẩu hiện tại</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showCurrentPw ? 'text' : 'password'}
                        className="form-input"
                        placeholder="Nhập mật khẩu hiện tại..."
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        style={{ paddingRight: 42 }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPw((v) => !v)}
                        style={{
                          position: 'absolute',
                          right: 10,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          color: 'var(--color-text-muted)',
                          fontSize: 13,
                        }}
                      >
                        {showCurrentPw ? 'Ẩn' : 'Hiện'}
                      </button>
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">
                      Mật khẩu mới (tối thiểu 6 ký tự)
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showNewPw ? 'text' : 'password'}
                        className="form-input"
                        placeholder="Nhập mật khẩu mới..."
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        style={{ paddingRight: 42 }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPw((v) => !v)}
                        style={{
                          position: 'absolute',
                          right: 10,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          color: 'var(--color-text-muted)',
                          fontSize: 13,
                        }}
                      >
                        {showNewPw ? 'Ẩn' : 'Hiện'}
                      </button>
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Xác nhận mật khẩu mới</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showConfirmPw ? 'text' : 'password'}
                        className="form-input"
                        placeholder="Nhập lại mật khẩu mới..."
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        style={{ paddingRight: 42 }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPw((v) => !v)}
                        style={{
                          position: 'absolute',
                          right: 10,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          color: 'var(--color-text-muted)',
                          fontSize: 13,
                        }}
                      >
                        {showConfirmPw ? 'Ẩn' : 'Hiện'}
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: 6, display: 'flex', justifyContent: 'center' }}>
                    <button
                      type="submit"
                      id="btn-submit-change-password"
                      className="btn btn-primary"
                      disabled={savingPw}
                      style={{ minWidth: 180, justifyContent: 'center' }}
                    >
                      {savingPw ? 'Đang cập nhật...' : 'Lưu mật khẩu mới'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
