import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../../api';
import { useAuthStore } from '../../store/authStore';

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Login form state
  const [loginForm, setLoginForm] = useState({ loginId: '', password: '' });
  // Signup form state
  const [signupForm, setSignupForm] = useState({ name: '', loginId: '', password: '' });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.login(loginForm.loginId, loginForm.password);
      const { accessToken, user } = res.data.data;
      setAuth(user, accessToken);
      navigate('/');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Đăng nhập thất bại';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.signup(signupForm.name, signupForm.loginId, signupForm.password);
      const { accessToken, user } = (res.data as { data: { accessToken: string; user: Parameters<typeof setAuth>[0] } }).data;
      setAuth(user, accessToken);
      navigate('/');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Đăng ký thất bại';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      {/* Left Hero Panel */}
      <div className="auth-hero">
        <div className="auth-hero-content">
          <div className="auth-logo">
            <div className="auth-logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <span className="auth-logo-text">E<span>learn</span></span>
          </div>
          <h1 className="auth-hero-title">Nền tảng học tập<br />trực tuyến hiện đại</h1>
          <p className="auth-hero-subtitle">Quản lý lớp học, giao bài tập, và tổ chức buổi học trực tuyến — tất cả trong một nơi.</p>

          <div className="auth-features">
            {[
              { icon: '🎓', text: 'Quản lý lớp học linh hoạt' },
              { icon: '📝', text: 'Giao & nộp bài tập dễ dàng' },
              { icon: '📹', text: 'Học trực tuyến WebRTC' },
              { icon: '📚', text: 'Thư viện tài liệu tập trung' },
            ].map((f) => (
              <div key={f.text} className="auth-feature-item">
                <span className="auth-feature-icon">{f.icon}</span>
                <span>{f.text}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="auth-hero-decoration">
          <div className="hero-circle hero-circle-1" />
          <div className="hero-circle hero-circle-2" />
          <div className="hero-circle hero-circle-3" />
        </div>
      </div>

      {/* Right Form Panel */}
      <div className="auth-form-panel">
        <div className="auth-card">
          <div className="auth-card-header">
            <h2 className="auth-card-title">
              {tab === 'login' ? 'Chào mừng trở lại!' : 'Tạo tài khoản mới'}
            </h2>
            <p className="auth-card-subtitle">
              {tab === 'login' ? 'Đăng nhập để tiếp tục học tập' : 'Bắt đầu hành trình giảng dạy'}
            </p>
          </div>

          {/* Tab switcher */}
          <div className="tabs" style={{ margin: '0 0 24px' }}>
            <button
              id="tab-login"
              className={`tab-btn ${tab === 'login' ? 'active' : ''}`}
              onClick={() => { setTab('login'); setError(''); }}
            >
              Đăng nhập
            </button>
            <button
              id="tab-signup"
              className={`tab-btn ${tab === 'signup' ? 'active' : ''}`}
              onClick={() => { setTab('signup'); setError(''); }}
            >
              Đăng ký (GV)
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="auth-error">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          {/* Login Form */}
          {tab === 'login' && (
            <form id="form-login" onSubmit={handleLogin} className="auth-form">
              <div className="form-group">
                <label className="form-label" htmlFor="login-id">Tên đăng nhập / Mã sinh viên</label>
                <div className="input-with-icon">
                  <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                  <input
                    id="login-id"
                    type="text"
                    className="form-input"
                    placeholder="Nhập tên đăng nhập"
                    value={loginForm.loginId}
                    onChange={(e) => setLoginForm({ ...loginForm, loginId: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="login-password">Mật khẩu</label>
                <div className="input-with-icon">
                  <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  <input
                    id="login-password"
                    type="password"
                    className="form-input"
                    placeholder="Nhập mật khẩu"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                    required
                  />
                </div>
              </div>
              <button id="btn-login" type="submit" className="btn btn-primary btn-lg w-full" disabled={loading}>
                {loading ? <span className="spinner" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white' }} /> : null}
                {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
              </button>
            </form>
          )}

          {/* Signup Form */}
          {tab === 'signup' && (
            <form id="form-signup" onSubmit={handleSignup} className="auth-form">
              <div className="form-group">
                <label className="form-label" htmlFor="signup-name">Họ và tên</label>
                <div className="input-with-icon">
                  <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                  <input
                    id="signup-name"
                    type="text"
                    className="form-input"
                    placeholder="Nguyễn Văn A"
                    value={signupForm.name}
                    onChange={(e) => setSignupForm({ ...signupForm, name: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="signup-id">Tên đăng nhập</label>
                <div className="input-with-icon">
                  <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                  <input
                    id="signup-id"
                    type="text"
                    className="form-input"
                    placeholder="Tên đăng nhập duy nhất"
                    value={signupForm.loginId}
                    onChange={(e) => setSignupForm({ ...signupForm, loginId: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="signup-password">Mật khẩu</label>
                <div className="input-with-icon">
                  <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  <input
                    id="signup-password"
                    type="password"
                    className="form-input"
                    placeholder="Tối thiểu 6 ký tự"
                    value={signupForm.password}
                    onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })}
                    required
                    minLength={6}
                  />
                </div>
              </div>
              <button id="btn-signup" type="submit" className="btn btn-primary btn-lg w-full" disabled={loading}>
                {loading ? <span className="spinner" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white' }} /> : null}
                {loading ? 'Đang tạo tài khoản...' : 'Tạo tài khoản'}
              </button>
            </form>
          )}
        </div>
      </div>

      <style>{`
        .auth-page {
          min-height: 100vh;
          display: flex;
        }

        .auth-hero {
          flex: 1;
          background: linear-gradient(135deg, #1E1B4B 0%, #312E81 50%, #4338CA 100%);
          padding: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
        }

        .auth-hero-content {
          position: relative;
          z-index: 1;
          max-width: 420px;
        }

        .auth-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 48px;
        }

        .auth-logo-icon {
          width: 44px;
          height: 44px;
          background: rgba(255,255,255,0.15);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .auth-logo-icon svg { width: 22px; height: 22px; }

        .auth-logo-text {
          font-size: 22px;
          font-weight: 800;
          color: white;
          letter-spacing: -0.5px;
        }

        .auth-logo-text span { color: #A5B4FC; }

        .auth-hero-title {
          font-size: 36px;
          font-weight: 800;
          color: white;
          line-height: 1.2;
          letter-spacing: -0.5px;
          margin-bottom: 16px;
        }

        .auth-hero-subtitle {
          font-size: 16px;
          color: rgba(255,255,255,0.65);
          line-height: 1.6;
          margin-bottom: 40px;
        }

        .auth-features { display: flex; flex-direction: column; gap: 14px; }

        .auth-feature-item {
          display: flex;
          align-items: center;
          gap: 12px;
          color: rgba(255,255,255,0.8);
          font-size: 14px;
        }

        .auth-feature-icon {
          width: 36px;
          height: 36px;
          background: rgba(255,255,255,0.1);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          flex-shrink: 0;
        }

        .hero-circle {
          position: absolute;
          border-radius: 50%;
          background: rgba(255,255,255,0.04);
        }

        .hero-circle-1 { width: 400px; height: 400px; bottom: -100px; right: -100px; }
        .hero-circle-2 { width: 250px; height: 250px; top: -60px; right: 60px; background: rgba(255,255,255,0.06); }
        .hero-circle-3 { width: 150px; height: 150px; top: 40%; left: -40px; }

        .auth-form-panel {
          width: 480px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px;
          background: #F8FAFC;
        }

        .auth-card {
          background: white;
          border-radius: 20px;
          padding: 32px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.08);
          width: 100%;
        }

        .auth-card-header { margin-bottom: 24px; }
        .auth-card-title { font-size: 22px; font-weight: 800; color: #0F172A; margin-bottom: 6px; }
        .auth-card-subtitle { font-size: 14px; color: #64748B; }

        .auth-form { display: flex; flex-direction: column; gap: 16px; }

        .input-with-icon { position: relative; }

        .input-icon {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          width: 16px;
          height: 16px;
          color: #94A3B8;
          pointer-events: none;
        }

        .input-with-icon .form-input { padding-left: 40px; }

        .auth-error {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          background: #FEF2F2;
          border: 1px solid #FECACA;
          border-radius: 8px;
          color: #DC2626;
          font-size: 13px;
          margin-bottom: 8px;
        }

        @media (max-width: 900px) {
          .auth-hero { display: none; }
          .auth-form-panel { width: 100%; }
        }
      `}</style>
    </div>
  );
}
