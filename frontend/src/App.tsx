import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { classApi } from './api';

// Pages (code-split by route to keep initial bundle small)
import LoginPage from './pages/auth/LoginPage';
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'));
const ClassPage = lazy(() => import('./pages/class/ClassPage'));
const MeetingRoom = lazy(() => import('./pages/meeting/MeetingRoom'));
const DocumentsPage = lazy(() => import('./pages/documents/DocumentsPage'));
const CreateExamWizard = lazy(() =>
  import('./pages/exam/CreateExamWizard').then((m) => ({ default: m.CreateExamWizard })),
);
const LiveMonitorPage = lazy(() =>
  import('./pages/exam/LiveMonitorPage').then((m) => ({ default: m.LiveMonitorPage })),
);
const GradingResultsPage = lazy(() =>
  import('./pages/exam/GradingResultsPage').then((m) => ({ default: m.GradingResultsPage })),
);
const ExamViolationsPage = lazy(() =>
  import('./pages/exam/ExamViolationsPage').then((m) => ({ default: m.ExamViolationsPage })),
);
const PrecheckRoomPage = lazy(() =>
  import('./pages/exam/PrecheckRoomPage').then((m) => ({ default: m.PrecheckRoomPage })),
);
const ExamTakingPage = lazy(() =>
  import('./pages/exam/ExamTakingPage').then((m) => ({ default: m.ExamTakingPage })),
);
const ExamResultPage = lazy(() =>
  import('./pages/exam/ExamResultPage').then((m) => ({ default: m.ExamResultPage })),
);

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
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
        {/* Public */}
        <Route path="/login" element={<AuthRoute><LoginPage /></AuthRoute>} />

        {/* Protected */}
        <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/documents" element={<ProtectedRoute><DocumentsPage /></ProtectedRoute>} />
        <Route path="/class/:id" element={<ProtectedRoute><ClassPage /></ProtectedRoute>} />
        <Route path="/class/:classId/meet/:meetingCode" element={<ProtectedRoute><MeetingRoom /></ProtectedRoute>} />
        <Route path="/join/:inviteCode" element={<ProtectedRoute><JoinClassRedirect /></ProtectedRoute>} />

        {/* Exam Module Routes */}
        <Route path="/class/:classId/exam/create" element={<ProtectedRoute><CreateExamWizard /></ProtectedRoute>} />
        <Route path="/exam/:examId/monitor" element={<ProtectedRoute><LiveMonitorPage /></ProtectedRoute>} />
        <Route path="/exam/:examId/grading" element={<ProtectedRoute><GradingResultsPage /></ProtectedRoute>} />
        <Route path="/exam/:examId/violations" element={<ProtectedRoute><ExamViolationsPage /></ProtectedRoute>} />
        <Route path="/exam/:examId/precheck" element={<ProtectedRoute><PrecheckRoomPage /></ProtectedRoute>} />
        <Route path="/exam/:examId/take/:attemptId" element={<ProtectedRoute><ExamTakingPage /></ProtectedRoute>} />
        <Route path="/exam/:examId/result/:attemptId" element={<ProtectedRoute><ExamResultPage /></ProtectedRoute>} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
