import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { classApi } from './api';

// Pages
import LoginPage from './pages/auth/LoginPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import ClassPage from './pages/class/ClassPage';
import MeetingRoom from './pages/meeting/MeetingRoom';
import DocumentsPage from './pages/documents/DocumentsPage';

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Join class via invite link
function JoinClassRedirect() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (!inviteCode) { navigate('/'); return; }
    classApi.join(inviteCode)
      .then((res) => {
        const data = (res.data as { data: { classId: number } }).data;
        navigate(`/class/${data.classId}`);
      })
      .catch(() => navigate('/'));
  }, [inviteCode]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--color-bg)' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3, margin: '0 auto 16px' }} />
        <div style={{ color: 'var(--color-text-muted)' }}>Đang tham gia lớp học...</div>
      </div>
    </div>
  );
}

// Loading screen
function LoadingScreen() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--color-bg)' }}>
      <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
    </div>
  );
}

export default function App() {
  const { setAccessToken } = useAuthStore();
  const [loading, setLoading] = React.useState(true);

  // On mount, try to refresh access token silently (uses httpOnly cookie)
  useEffect(() => {
    const tryRefresh = async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/auth/refresh`,
          { method: 'POST', credentials: 'include' }
        );
        if (res.ok) {
          const json = await res.json();
          if (json.data?.accessToken) {
            setAccessToken(json.data.accessToken);
          }
        }
      } catch {
        // No valid refresh token — user needs to login
      }
      setLoading(false);
    };
    tryRefresh();
  }, []);

  if (loading) return <LoadingScreen />;

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<AuthRoute><LoginPage /></AuthRoute>} />

        {/* Protected */}
        <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/documents" element={<ProtectedRoute><DocumentsPage /></ProtectedRoute>} />
        <Route path="/class/:id" element={<ProtectedRoute><ClassPage /></ProtectedRoute>} />
        <Route path="/class/:classId/meet/:meetingCode" element={<ProtectedRoute><MeetingRoom /></ProtectedRoute>} />
        <Route path="/join/:inviteCode" element={<ProtectedRoute><JoinClassRedirect /></ProtectedRoute>} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
