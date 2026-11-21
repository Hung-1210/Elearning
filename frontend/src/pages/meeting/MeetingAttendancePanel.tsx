import { useEffect, useMemo, useRef, useState } from 'react';
import { attendanceApi, faceProfileApi } from '../../api';
import type {
  AttendanceRecord,
  AttendanceSession,
} from '../../types';

// ── Helper: Capture JPEG Blob from a MediaStream ──────────────
async function captureBlobFromStream(stream: MediaStream | null): Promise<Blob | null> {
  if (!stream) return null;
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack || videoTrack.readyState !== 'live' || !videoTrack.enabled) {
    return null;
  }

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([videoTrack]);

  try {
    await video.play();
    if (!video.videoWidth || !video.videoHeight) {
      await new Promise((r) => setTimeout(r, 180));
    }
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.86);
    });
  } catch {
    return null;
  } finally {
    video.pause();
    video.srcObject = null;
  }
}

// ── Student Floating Attendance Banner ────────────────────────
export function StudentAttendanceFloatingCard({
  activeSession,
  myRecordFromOverview,
  myUserId,
  camOn,
  localStream,
  onRequestTurnOnCam,
  reminderPulse,
}: {
  activeSession: AttendanceSession | null;
  myRecordFromOverview: AttendanceRecord | null;
  myUserId: number;
  camOn: boolean;
  localStream: MediaStream | null;
  onRequestTurnOnCam: () => Promise<void>;
  reminderPulse: number;
}) {
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{
    matched: boolean;
    status: string;
    similarity?: number | null;
    reason?: string;
    attemptsUsed?: number;
    retriesRemaining?: number;
  } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [remainingSec, setRemainingSec] = useState<number>(0);
  const autoTriggeredKeyRef = useRef<string | null>(null);

  const myRecord = useMemo(() => {
    if (activeSession?.records?.length) {
      return (
        activeSession.records.find((r) => Number(r.studentId) === Number(myUserId)) ||
        myRecordFromOverview
      );
    }
    return myRecordFromOverview;
  }, [activeSession, myRecordFromOverview, myUserId]);

  const roundKey = activeSession ? `${activeSession.id}_${activeSession.currentRound}` : null;

  // Countdown timer
  useEffect(() => {
    if (!activeSession || !activeSession.roundOpen || !activeSession.roundEndsAt) {
      setRemainingSec(0);
      return;
    }
    const updateRemaining = () => {
      const diff = Math.max(
        0,
        Math.floor((new Date(activeSession.roundEndsAt).getTime() - Date.now()) / 1000),
      );
      setRemainingSec(diff);
    };
    updateRemaining();
    const timer = setInterval(updateRemaining, 1000);
    return () => clearInterval(timer);
  }, [activeSession?.id, activeSession?.roundOpen, activeSession?.roundEndsAt]);

  // Reset local state when a new session or new round opens
  useEffect(() => {
    if (!roundKey) {
      setCheckResult(null);
      setCollapsed(false);
      return;
    }
    if (autoTriggeredKeyRef.current !== roundKey) {
      setCheckResult(null);
      setCollapsed(false);
    }
  }, [roundKey]);

  // Expand card if lecturer sends a reminder
  useEffect(() => {
    if (reminderPulse > 0) {
      setCollapsed(false);
    }
  }, [reminderPulse]);

  const performAttendanceCheck = async () => {
    if (!activeSession || !activeSession.roundOpen) return;
    if (checking) return;

    setChecking(true);
    try {
      const blob = await captureBlobFromStream(localStream);
      if (!blob) {
        setCheckResult({
          matched: false,
          status: 'pending',
          reason: 'Chưa lấy được hình ảnh từ Camera. Hãy bật Camera và thử lại.',
        });
        return;
      }
      const res = await attendanceApi.check(activeSession.id, blob);
      const data = res.data.data;
      const matched = data.status === 'present';
      setCheckResult({
        matched,
        status: data.status,
        similarity: data.similarity,
        reason: data.messageVi,
        attemptsUsed: data.attempts,
        retriesRemaining: data.attemptsLeft,
      });
      if (matched) {
        setTimeout(() => {
          setCollapsed(true);
        }, 4500);
      }
    } catch (err: any) {
      const errMsg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        'Lỗi kết nối khi gửi ảnh điểm danh.';
      const isNoProfile = err?.response?.status === 403;
      setCheckResult({
        matched: false,
        status: isNoProfile ? 'no_profile' : 'pending',
        reason: errMsg,
      });
    } finally {
      setChecking(false);
    }
  };

  // Auto-trigger with random jitter (400..2200ms) when round opens and camera is ON
  useEffect(() => {
    if (!activeSession || !activeSession.roundOpen || !roundKey) return;
    if (myRecord?.effectiveStatus === 'present') return;
    if (!camOn || !localStream) return;
    if (autoTriggeredKeyRef.current === roundKey) return;

    autoTriggeredKeyRef.current = roundKey;
    const jitterMs = 400 + Math.floor(Math.random() * 1800);
    const t = setTimeout(() => {
      performAttendanceCheck();
    }, jitterMs);
    return () => clearTimeout(t);
  }, [roundKey, activeSession?.roundOpen, camOn, localStream, myRecord?.effectiveStatus]);

  if (!activeSession) return null;

  const isAlreadyPresent =
    myRecord?.effectiveStatus === 'present' || checkResult?.matched === true;

  if (!activeSession.roundOpen && !isAlreadyPresent && !checkResult) {
    return null;
  }

  const mm = String(Math.floor(remainingSec / 60)).padStart(2, '0');
  const ss = String(remainingSec % 60).padStart(2, '0');

  if (collapsed && isAlreadyPresent) {
    return (
      <div
        onClick={() => setCollapsed(false)}
        style={{
          position: 'absolute',
          top: 12,
          right: 14,
          zIndex: 12,
          background: 'rgba(6, 95, 70, 0.92)',
          border: '1px solid #34D399',
          color: '#ECFDF5',
          padding: '6px 14px',
          borderRadius: 999,
          fontSize: 12.5,
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
        title="Nhấn để xem chi tiết điểm danh"
      >
        <span>✅ Đã điểm danh Đợt #{activeSession.currentRound}</span>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 15,
        width: 'min(92vw, 540px)',
        background: 'rgba(24, 25, 28, 0.95)',
        border: isAlreadyPresent
          ? '1.5px solid #10B981'
          : reminderPulse > 0
          ? '2px solid #F59E0B'
          : '1.5px solid #60A5FA',
        borderRadius: 14,
        padding: '12px 16px',
        color: '#F8FAFC',
        boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              background: isAlreadyPresent ? '#059669' : '#2563EB',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 999,
            }}
          >
            {activeSession.mode === 'periodic'
              ? `Điểm danh định kỳ • Đợt #${activeSession.currentRound}`
              : `Điểm danh khuôn mặt • Đợt #${activeSession.currentRound}`}
          </span>
          {activeSession.roundOpen && (
            <span style={{ fontSize: 12.5, color: '#93C5FD', fontWeight: 600 }}>
              ⏱ Còn {mm}:{ss}
            </span>
          )}
        </div>

        {isAlreadyPresent && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94A3B8',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Thu gọn ✕
          </button>
        )}
      </div>

      {/* Status Body */}
      {isAlreadyPresent ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 13.5, color: '#6EE7B7', fontWeight: 600 }}>
            {myRecord?.status === 'manual'
              ? '✅ Bạn đã được giảng viên điểm danh thủ công.'
              : `✅ Điểm danh khuôn mặt thành công! ${
                  (checkResult?.similarity ?? myRecord?.similarity)
                    ? `(Độ khớp: ${Math.round(
                        ((checkResult?.similarity ?? myRecord?.similarity) || 0) * 100,
                      )}%)`
                    : ''
                }`}
          </div>
        </div>
      ) : !camOn ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: 13, color: '#FDE68A' }}>
            📷 Camera của bạn đang tắt. Vui lòng bật Camera để hệ thống tự động điểm danh khuôn mặt.
          </div>
          <button
            type="button"
            onClick={async () => {
              await onRequestTurnOnCam();
              setTimeout(() => performAttendanceCheck(), 600);
            }}
            style={{
              background: '#2563EB',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '7px 14px',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Bật Camera & Điểm danh
          </button>
        </div>
      ) : checking ? (
        <div style={{ fontSize: 13, color: '#E2E8F0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>⏳ Đang chụp khung hình và đối chiếu khuôn mặt bằng AI...</span>
        </div>
      ) : checkResult && !checkResult.matched ? (
        <div>
          <div style={{ fontSize: 13, color: '#FCA5A5', marginBottom: 8, fontWeight: 500 }}>
            ⚠️ {checkResult.reason || 'Chưa khớp khuôn mặt.'}
            {typeof checkResult.attemptsUsed === 'number' && (
              <span> (Lần thử {checkResult.attemptsUsed}/3)</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {checkResult.status === 'no_profile' && (
              <button
                type="button"
                onClick={() => window.open('/face-profile', '_blank')}
                style={{
                  background: '#4F46E5',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🪪 Mở trang Khuôn mặt của tôi (Tab mới)
              </button>
            )}
            {(checkResult.retriesRemaining === undefined || checkResult.retriesRemaining > 0) && (
              <button
                type="button"
                onClick={performAttendanceCheck}
                style={{
                  background: '#2563EB',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🔄 Chụp & Thử lại ngay
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 13, color: '#CBD5E1' }}>
            Nhìn thẳng vào camera để hệ thống xác nhận có mặt...
          </span>
          <button
            type="button"
            onClick={performAttendanceCheck}
            style={{
              background: '#2563EB',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            📸 Điểm danh ngay
          </button>
        </div>
      )}
    </div>
  );
}

// ── Lecturer Side Panel for Face Attendance ───────────────────
export function LecturerAttendanceSidePanel({
  classId,
  meetingCode,
  activeSession,
  classProfileSummary,
  onlineUserIds,
  onRefreshOverview,
}: {
  classId: string;
  meetingCode: string;
  activeSession: AttendanceSession | null;
  classProfileSummary: {
    totalStudents: number;
    approvedCount: number;
    pendingCount: number;
    rejectedCount: number;
    unregisteredCount: number;
  } | null;
  onlineUserIds: Set<number>;
  onRefreshOverview: () => Promise<void>;
}) {
  // Start Config State
  const [mode, setMode] = useState<'once' | 'periodic'>('once');
  const [windowSec, setWindowSec] = useState<number>(120);
  const [intervalMin, setIntervalMin] = useState<number>(15);
  const [passRatio, setPassRatio] = useState<number>(0.7);
  const [starting, setStarting] = useState(false);

  const [statusFilter, setStatusFilter] = useState<
    'all' | 'present' | 'mismatch' | 'absent' | 'no_profile'
  >('all');
  const [remainingSec, setRemainingSec] = useState<number>(0);
  const [actionBusy, setActionBusy] = useState(false);

  // Evidence Compare Modal
  const [compareRecord, setCompareRecord] = useState<AttendanceRecord | null>(null);
  const [evidenceUrl, setEvidenceUrl] = useState<string | null>(null);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);

  // Manual Override Modal
  const [overrideTarget, setOverrideTarget] = useState<AttendanceRecord | null>(null);
  const [overrideStatus, setOverrideStatus] = useState<'present' | 'absent'>('present');
  const [overrideReason, setOverrideReason] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  const currentSession = activeSession;

  // Countdown timer for open round
  useEffect(() => {
    if (!currentSession || !currentSession.roundOpen || !currentSession.roundEndsAt) {
      setRemainingSec(0);
      return;
    }
    const tick = () => {
      const diff = Math.max(
        0,
        Math.floor((new Date(currentSession.roundEndsAt).getTime() - Date.now()) / 1000),
      );
      setRemainingSec(diff);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [currentSession?.id, currentSession?.roundOpen, currentSession?.roundEndsAt]);

  const handleStartSession = async () => {
    if (!meetingCode) return;
    setStarting(true);
    try {
      await attendanceApi.start(meetingCode, {
        classId: Number(classId),
        mode,
        windowSec,
        intervalMin: mode === 'periodic' ? intervalMin : undefined,
        passRatio: mode === 'periodic' ? passRatio : undefined,
      });
      await onRefreshOverview();
    } catch (err: any) {
      alert(
        err?.response?.data?.error ||
          err?.response?.data?.message ||
          'Không thể bắt đầu phiên điểm danh.',
      );
    } finally {
      setStarting(false);
    }
  };

  const handleEndSession = async () => {
    if (!currentSession) return;
    setActionBusy(true);
    try {
      await attendanceApi.end(currentSession.id);
      await onRefreshOverview();
    } catch (err: any) {
      alert(
        err?.response?.data?.error ||
          err?.response?.data?.message ||
          'Không thể kết thúc đợt điểm danh.',
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleNextPeriodicRound = async () => {
    if (!currentSession) return;
    setActionBusy(true);
    try {
      await attendanceApi.nextRound(currentSession.id);
      await onRefreshOverview();
    } catch (err: any) {
      alert(
        err?.response?.data?.error ||
          err?.response?.data?.message ||
          'Không thể mở đợt tiếp theo.',
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleRemindMissing = async () => {
    if (!currentSession) return;
    setActionBusy(true);
    try {
      const res = await attendanceApi.remind(currentSession.id);
      alert(
        `Đã gửi tín hiệu nhắc điểm danh tới ${res.data.data.remindedCount} sinh viên chưa có mặt.`,
      );
    } catch (err: any) {
      alert(
        err?.response?.data?.error ||
          err?.response?.data?.message ||
          'Không thể gửi nhắc nhở.',
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleExport = async (format: 'xlsx' | 'csv') => {
    if (!currentSession) return;
    try {
      const res = await attendanceApi.exportFile(currentSession.id, format);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `diem_danh_dot_${currentSession.currentRound}.${format}`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      alert('Không thể xuất file điểm danh.');
    }
  };

  const openEvidenceCompare = async (rec: AttendanceRecord) => {
    if (!currentSession) return;
    setCompareRecord(rec);
    setLoadingCompare(true);
    if (evidenceUrl) URL.revokeObjectURL(evidenceUrl);
    if (profilePhotoUrl) URL.revokeObjectURL(profilePhotoUrl);
    setEvidenceUrl(null);
    setProfilePhotoUrl(null);

    try {
      const [evRes, profRes] = await Promise.all([
        attendanceApi.fetchEvidenceBlob(currentSession.id, rec.studentId, rec.roundNo).catch(() => null),
        faceProfileApi.fetchStudentPhotoBlob(rec.studentId, 1).catch(() => null),
      ]);
      if (evRes?.data) setEvidenceUrl(URL.createObjectURL(evRes.data));
      if (profRes?.data) setProfilePhotoUrl(URL.createObjectURL(profRes.data));
    } finally {
      setLoadingCompare(false);
    }
  };

  const handleSaveOverride = async (
    targetRecord: AttendanceRecord,
    status: 'present' | 'absent',
    reason: string,
  ) => {
    if (!currentSession) return;
    if (!reason.trim()) {
      alert('Vui lòng nhập lý do điểm danh tay / ghi đè.');
      return;
    }
    setSavingOverride(true);
    try {
      await attendanceApi.overrideRecord(
        currentSession.id,
        targetRecord.studentId,
        status,
        reason.trim(),
        targetRecord.roundNo,
      );
      setOverrideTarget(null);
      setCompareRecord(null);
      await onRefreshOverview();
    } catch (err: any) {
      alert(
        err?.response?.data?.error ||
          err?.response?.data?.message ||
          'Không thể cập nhật trạng thái điểm danh.',
      );
    } finally {
      setSavingOverride(false);
    }
  };

  const records = currentSession?.records || [];
  const filteredRecords = records.filter((r) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'present') return r.effectiveStatus === 'present';
    if (statusFilter === 'absent') return r.effectiveStatus === 'absent' || r.effectiveStatus === 'pending';
    return r.effectiveStatus === statusFilter;
  });

  const mm = String(Math.floor(remainingSec / 60)).padStart(2, '0');
  const ss = String(remainingSec % 60).padStart(2, '0');
  const aiState = currentSession?.aiState || 'ready';
  const duplicateWarnings = currentSession?.duplicateWarnings || [];

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px 16px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        fontSize: 13,
      }}
    >
      {/* AI Engine & Pending Face Profiles Notice */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#F8FAFC',
          padding: '8px 12px',
          borderRadius: 10,
          border: '1px solid #E2E8F0',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 12 }}>
          AI Face Engine:{' '}
          <strong
            style={{
              color:
                aiState === 'ready'
                  ? '#059669'
                  : aiState === 'not_ready'
                  ? '#D97706'
                  : '#DC2626',
            }}
          >
            {aiState === 'ready'
              ? '🟢 Sẵn sàng'
              : aiState === 'not_ready'
              ? '🟡 Đang khởi động'
              : '🔴 Tạm ngưng'}
          </strong>
        </span>
        <button
          type="button"
          onClick={() => window.open(`/class/${classId}?tab=face-profiles`, '_blank')}
          style={{
            background: '#EEF2FF',
            color: '#4F46E5',
            border: '1px solid #C7D2FE',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 11.5,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          👤 Duyệt HS ({classProfileSummary?.pendingCount || 0} chờ)
        </button>
      </div>

      {/* Duplicate Face Warning (P6) */}
      {duplicateWarnings.length > 0 && (
        <div
          style={{
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            color: '#991B1B',
            borderRadius: 10,
            padding: '10px 12px',
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            ⚠️ Cảnh báo trùng khuôn mặt đăng ký ({duplicateWarnings.length} cặp)
          </div>
          {duplicateWarnings.map((w, idx) => (
            <div key={idx} style={{ marginTop: 2 }}>
              • <strong>{w.studentAName}</strong> & <strong>{w.studentBName}</strong> — giống nhau{' '}
              <strong>{Math.round(w.similarity * 100)}%</strong>
            </div>
          ))}
        </div>
      )}

      {/* Configuration Card (when no active open session) */}
      {(!currentSession || Boolean(currentSession.endedAt) || (!currentSession.roundOpen && currentSession.mode === 'once')) && (
        <div
          style={{
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: 12,
            padding: 12,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>
            Mở đợt điểm danh khuôn mặt mới
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setMode('once')}
              style={{
                flex: 1,
                padding: '7px 10px',
                borderRadius: 8,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
                border: mode === 'once' ? '2px solid #2563EB' : '1px solid #CBD5E1',
                background: mode === 'once' ? '#EFF6FF' : '#fff',
                color: mode === 'once' ? '#1D4ED8' : '#334155',
              }}
            >
              🎯 Một lần
            </button>
            <button
              type="button"
              onClick={() => setMode('periodic')}
              style={{
                flex: 1,
                padding: '7px 10px',
                borderRadius: 8,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
                border: mode === 'periodic' ? '2px solid #2563EB' : '1px solid #CBD5E1',
                background: mode === 'periodic' ? '#EFF6FF' : '#fff',
                color: mode === 'periodic' ? '#1D4ED8' : '#334155',
              }}
            >
              🔄 Định kỳ tự động
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11.5, color: '#64748B', marginBottom: 4 }}>
                Thời lượng mỗi đợt
              </label>
              <select
                value={windowSec}
                onChange={(e) => setWindowSec(Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid #CBD5E1',
                  fontSize: 12.5,
                }}
              >
                <option value={60}>1 phút</option>
                <option value={120}>2 phút (Khuyên dùng)</option>
                <option value={300}>5 phút</option>
              </select>
            </div>

            {mode === 'periodic' && (
              <div>
                <label style={{ display: 'block', fontSize: 11.5, color: '#64748B', marginBottom: 4 }}>
                  Chu kỳ lặp (±15% ngẫu nhiên)
                </label>
                <select
                  value={intervalMin}
                  onChange={(e) => setIntervalMin(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: '1px solid #CBD5E1',
                    fontSize: 12.5,
                  }}
                >
                  <option value={5}>Mỗi 5 phút</option>
                  <option value={10}>Mỗi 10 phút</option>
                  <option value={15}>Mỗi 15 phút</option>
                  <option value={20}>Mỗi 20 phút</option>
                </select>
              </div>
            )}
          </div>

          {mode === 'periodic' && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 11.5, color: '#64748B', marginBottom: 4 }}>
                Tỷ lệ số đợt đạt để tính Có mặt cuối buổi: <strong>{Math.round(passRatio * 100)}%</strong>
              </label>
              <input
                type="range"
                min={0.5}
                max={1}
                step={0.1}
                value={passRatio}
                onChange={(e) => setPassRatio(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
          )}

          <button
            type="button"
            onClick={handleStartSession}
            disabled={starting}
            style={{
              width: '100%',
              background: '#1A73E8',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '9px 14px',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {starting ? 'Đang khởi tạo...' : '🚀 Bắt đầu điểm danh ngay'}
          </button>
        </div>
      )}

      {/* Session Live Controls */}
      {currentSession && (
        <div
          style={{
            background: currentSession.roundOpen ? '#EFF6FF' : '#F8FAFC',
            border: currentSession.roundOpen ? '1.5px solid #60A5FA' : '1px solid #E2E8F0',
            borderRadius: 12,
            padding: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 13.5 }}>
              Đợt #{currentSession.currentRound} (
              {currentSession.mode === 'periodic' ? 'Định kỳ' : 'Một lần'})
            </span>

            {currentSession.roundOpen ? (
              <span
                style={{
                  background: '#DBEAFE',
                  color: '#1D4ED8',
                  padding: '3px 8px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                ⏱ {mm}:{ss}
              </span>
            ) : (
              <span
                style={{
                  background: '#E2E8F0',
                  color: '#475569',
                  padding: '3px 8px',
                  borderRadius: 999,
                  fontSize: 11.5,
                  fontWeight: 600,
                }}
              >
                {currentSession.endedAt ? 'Đã kết thúc' : 'Đã đóng cửa sổ đợt'}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {currentSession.roundOpen && (
              <button
                type="button"
                onClick={handleRemindMissing}
                disabled={actionBusy}
                style={{
                  background: '#FFFBEB',
                  color: '#B45309',
                  border: '1px solid #FDE68A',
                  borderRadius: 7,
                  padding: '5px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🔔 Nhắc SV chưa ĐD
              </button>
            )}

            {currentSession.mode === 'periodic' && !currentSession.endedAt && (
              <button
                type="button"
                onClick={handleNextPeriodicRound}
                disabled={actionBusy}
                style={{
                  background: '#EEF2FF',
                  color: '#4F46E5',
                  border: '1px solid #C7D2FE',
                  borderRadius: 7,
                  padding: '5px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                title="Mở ngay đợt định kỳ tiếp theo để demo trực tiếp"
              >
                ⏭ Mở đợt tiếp theo ngay
              </button>
            )}

            {!currentSession.endedAt && (
              <button
                type="button"
                onClick={handleEndSession}
                disabled={actionBusy}
                style={{
                  background: '#FEE2E2',
                  color: '#B91C1C',
                  border: '1px solid #FECACA',
                  borderRadius: 7,
                  padding: '5px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ⏹ Kết thúc phiên
              </button>
            )}
          </div>
        </div>
      )}

      {/* Status Filter Chips & Student List */}
      {currentSession && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {[
              { key: 'all', label: `Tất cả (${currentSession.summary.total})` },
              {
                key: 'present',
                label: `✅ Có mặt (${currentSession.summary.present})`,
              },
              { key: 'mismatch', label: `⚠️ Không khớp (${currentSession.summary.mismatch})` },
              {
                key: 'absent',
                label: `⏳ Vắng/Chờ (${currentSession.summary.absent + currentSession.summary.pending})`,
              },
              { key: 'no_profile', label: `🪪 Chưa ĐK (${currentSession.summary.noProfile})` },
            ].map((chip) => {
              const active = statusFilter === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setStatusFilter(chip.key as any)}
                  style={{
                    padding: '4px 9px',
                    borderRadius: 999,
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: active ? '1.5px solid #1A73E8' : '1px solid #CBD5E1',
                    background: active ? '#E8F0FE' : '#fff',
                    color: active ? '#1A73E8' : '#334155',
                  }}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          {/* Student Rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredRecords.map((rec) => {
              const isOnline = onlineUserIds.has(Number(rec.studentId));
              return (
                <div
                  key={rec.id}
                  style={{
                    border:
                      rec.status === 'mismatch'
                        ? '1px solid #FCA5A5'
                        : rec.effectiveStatus === 'present'
                        ? '1px solid #A7F3D0'
                        : '1px solid #E2E8F0',
                    background:
                      rec.status === 'mismatch'
                        ? '#FEF2F2'
                        : rec.effectiveStatus === 'present'
                        ? '#F0FDF4'
                        : '#fff',
                    borderRadius: 10,
                    padding: '9px 11px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          title={isOnline ? 'Đang ở trong phòng họp' : 'Chưa vào phòng họp'}
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: isOnline ? '#10B981' : '#94A3B8',
                            flexShrink: 0,
                          }}
                        />
                        <strong
                          style={{
                            fontSize: 13,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {rec.studentName}
                        </strong>
                        <span style={{ fontSize: 11, color: '#64748B' }}>({rec.loginId})</span>
                      </div>

                      <div style={{ fontSize: 11.5, color: '#475569', marginTop: 3 }}>
                        {rec.status === 'present' && (
                          <span style={{ color: '#059669', fontWeight: 600 }}>
                            ✅ Có mặt{' '}
                            {rec.similarity ? `(${Math.round(rec.similarity * 100)}%)` : ''}
                          </span>
                        )}
                        {rec.status === 'manual' && (
                          <span
                            style={{
                              color: rec.effectiveStatus === 'present' ? '#0284C7' : '#DC2626',
                              fontWeight: 600,
                            }}
                          >
                            ✍️ {rec.effectiveStatus === 'present' ? 'Có mặt (GV)' : 'Vắng (GV)'}:{' '}
                            {rec.overrideReason}
                          </span>
                        )}
                        {rec.status === 'mismatch' && (
                          <span style={{ color: '#DC2626', fontWeight: 600 }}>
                            ⚠️ Không khớp{' '}
                            {rec.similarity ? `(${Math.round(rec.similarity * 100)}%)` : ''} •{' '}
                            {rec.attempts}/3 lần
                          </span>
                        )}
                        {(rec.status === 'absent' || rec.status === 'pending') && (
                          <span style={{ color: '#64748B' }}>
                            ⏳ Chưa điểm danh {isOnline ? '(Đang trong phòng)' : '(Chưa vào phòng)'}
                          </span>
                        )}
                        {rec.status === 'no_profile' && (
                          <span style={{ color: '#D97706', fontWeight: 600 }}>
                            🪪{' '}
                            {rec.subStatus === 'pending_review'
                              ? 'Hồ sơ chờ GV duyệt'
                              : rec.subStatus === 'rejected'
                              ? 'Hồ sơ bị từ chối'
                              : 'Chưa đăng ký khuôn mặt'}
                          </span>
                        )}
                        {rec.totalRounds > 1 && (
                          <span style={{ marginLeft: 6, fontWeight: 600, color: '#334155' }}>
                            • Đạt {rec.roundsPassed}/{rec.totalRounds} đợt
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      {rec.hasEvidence && (
                        <button
                          type="button"
                          onClick={() => openEvidenceCompare(rec)}
                          style={{
                            background: '#FEE2E2',
                            color: '#991B1B',
                            border: '1px solid #FCA5A5',
                            borderRadius: 6,
                            padding: '4px 7px',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                          title="Đối chiếu ảnh mẫu và ảnh chụp lúc điểm danh"
                        >
                          🔍 Đối chiếu
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setOverrideTarget(rec);
                          setOverrideStatus(
                            rec.effectiveStatus === 'present' ? 'absent' : 'present',
                          );
                          setOverrideReason(rec.overrideReason || '');
                        }}
                        style={{
                          background: '#F1F5F9',
                          color: '#334155',
                          border: '1px solid #CBD5E1',
                          borderRadius: 6,
                          padding: '4px 7px',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                        title="Điểm danh tay / Ghi đè trạng thái"
                      >
                        ✏️ Sửa
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Export Buttons */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              paddingTop: 8,
              borderTop: '1px solid #E2E8F0',
              marginTop: 4,
            }}
          >
            <button
              type="button"
              onClick={() => handleExport('xlsx')}
              style={{
                flex: 1,
                background: '#059669',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 10px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              📥 Xuất Excel (.xlsx)
            </button>
            <button
              type="button"
              onClick={() => handleExport('csv')}
              style={{
                flex: 1,
                background: '#475569',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 10px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              📄 Xuất CSV
            </button>
          </div>
        </>
      )}

      {/* Evidence Side-by-Side Comparison Modal */}
      {compareRecord && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.78)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setCompareRecord(null)}
        >
          <div
            style={{
              background: '#fff',
              color: '#1E293B',
              borderRadius: 16,
              maxWidth: 680,
              width: '100%',
              padding: 20,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 14,
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                  Đối chiếu ảnh điểm danh: {compareRecord.studentName} ({compareRecord.loginId})
                </h3>
                <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 2 }}>
                  Độ tương đồng AI:{' '}
                  <strong>
                    {compareRecord.similarity
                      ? `${Math.round(compareRecord.similarity * 100)}%`
                      : 'Không khớp'}
                  </strong>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCompareRecord(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 18,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {loadingCompare ? (
              <div style={{ padding: 30, textAlign: 'center' }}>Đang tải ảnh đối chiếu...</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
                    Ảnh mẫu đã duyệt (Hồ sơ)
                  </div>
                  <div
                    style={{
                      aspectRatio: '4/3',
                      background: '#0F172A',
                      borderRadius: 10,
                      overflow: 'hidden',
                    }}
                  >
                    {profilePhotoUrl ? (
                      <img
                        src={profilePhotoUrl}
                        alt="Hồ sơ mẫu"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          transform: 'scaleX(-1)',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#94A3B8',
                        }}
                      >
                        Không có ảnh mẫu
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
                    Ảnh chụp lúc điểm danh (Bằng chứng)
                  </div>
                  <div
                    style={{
                      aspectRatio: '4/3',
                      background: '#0F172A',
                      borderRadius: 10,
                      overflow: 'hidden',
                    }}
                  >
                    {evidenceUrl ? (
                      <img
                        src={evidenceUrl}
                        alt="Ảnh lúc điểm danh"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          transform: 'scaleX(-1)',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#94A3B8',
                        }}
                      >
                        Không tìm thấy ảnh bằng chứng
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setCompareRecord(null)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid #CBD5E1',
                  background: '#fff',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Đóng
              </button>
              <button
                type="button"
                disabled={savingOverride}
                onClick={() =>
                  handleSaveOverride(
                    compareRecord,
                    'present',
                    'Giảng viên đã đối chiếu ảnh bằng chứng và xác nhận đúng sinh viên',
                  )
                }
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#059669',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                ✅ Xác nhận đúng người (Chuyển sang Có mặt)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Override Modal */}
      {overrideTarget && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.75)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setOverrideTarget(null)}
        >
          <div
            style={{
              background: '#fff',
              color: '#1E293B',
              borderRadius: 16,
              maxWidth: 460,
              width: '100%',
              padding: 20,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700 }}>
              Điểm danh thủ công / Ghi đè
            </h3>
            <div style={{ fontSize: 13, color: '#475569', marginBottom: 12 }}>
              Sinh viên: <strong>{overrideTarget.studentName}</strong> ({overrideTarget.loginId})
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => setOverrideStatus('present')}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border:
                    overrideStatus === 'present' ? '2px solid #059669' : '1px solid #CBD5E1',
                  background: overrideStatus === 'present' ? '#ECFDF5' : '#fff',
                  color: overrideStatus === 'present' ? '#059669' : '#334155',
                }}
              >
                ✅ Ghi nhận Có mặt
              </button>
              <button
                type="button"
                onClick={() => setOverrideStatus('absent')}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: overrideStatus === 'absent' ? '2px solid #DC2626' : '1px solid #CBD5E1',
                  background: overrideStatus === 'absent' ? '#FEF2F2' : '#fff',
                  color: overrideStatus === 'absent' ? '#DC2626' : '#334155',
                }}
              >
                ❌ Đánh dấu Vắng
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              {[
                'Camera thiết bị hỏng, đã gọi xác nhận qua mic',
                'Ánh sáng phòng yếu, giảng viên đã kiểm tra trực tiếp',
                'Sinh viên xin phép hoặc có lý do hợp lệ',
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setOverrideReason(preset)}
                  style={{
                    textAlign: 'left',
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: '1px solid #E2E8F0',
                    background: '#F8FAFC',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {preset}
                </button>
              ))}
            </div>

            <textarea
              rows={3}
              placeholder="Nhập lý do điểm danh thủ công (bắt buộc)..."
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              style={{
                width: '100%',
                padding: 10,
                borderRadius: 8,
                border: '1px solid #CBD5E1',
                fontSize: 13,
                marginBottom: 14,
                boxSizing: 'border-box',
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => setOverrideTarget(null)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid #CBD5E1',
                  background: '#fff',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={savingOverride}
                onClick={() =>
                  handleSaveOverride(overrideTarget, overrideStatus, overrideReason)
                }
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#1A73E8',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                {savingOverride ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
