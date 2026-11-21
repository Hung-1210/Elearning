import { useEffect, useRef, useState } from 'react';
import { classApi, faceProfileApi } from '../../api';
import Sidebar, { MobileMenuButton } from '../../components/layout/Sidebar';
import { useLayoutStore } from '../../store/layoutStore';
import { useAuthStore } from '../../store/authStore';
import type { ClassInfo, FaceProfileMe } from '../../types';

const ENROLLMENT_STEPS = [
  {
    step: 1,
    title: 'Bước 1/4: Nhìn thẳng vào camera',
    subtitle: 'Giữ gương mặt chính diện trong khung elip, ánh sáng rõ ràng, biểu cảm tự nhiên.',
    badge: '1. Chính diện',
  },
  {
    step: 2,
    title: 'Bước 2/4: Nghiêng nhẹ sang trái (~10–15°)',
    subtitle: 'Xoay mặt nhẹ sang bên trái của bạn nhưng mắt vẫn hướng về màn hình.',
    badge: '2. Nghiêng trái nhẹ',
  },
  {
    step: 3,
    title: 'Bước 3/4: Nghiêng nhẹ sang phải (~10–15°)',
    subtitle: 'Xoay mặt nhẹ sang bên phải của bạn nhưng mắt vẫn hướng về màn hình.',
    badge: '3. Nghiêng phải nhẹ',
  },
  {
    step: 4,
    title: 'Bước 4/4: Nhìn thẳng lần 2 (Xác nhận)',
    subtitle: 'Trở lại tư thế nhìn thẳng vào camera để hoàn tất 4 góc mẫu.',
    badge: '4. Chính diện #2',
  },
];

export default function FaceProfilePage() {
  const { user } = useAuthStore();
  const { sidebarCollapsed } = useLayoutStore();

  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [profile, setProfile] = useState<FaceProfileMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedPhotoUrls, setSavedPhotoUrls] = useState<Record<number, string>>({});

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [activeStep, setActiveStep] = useState<number>(1); // 1..4 or 5 (review)
  const [capturedBlobs, setCapturedBlobs] = useState<Record<number, Blob>>({});
  const [capturedPreviews, setCapturedPreviews] = useState<Record<number, string>>({});
  const [validatingStep, setValidatingStep] = useState(false);
  const [submittingEnroll, setSubmittingEnroll] = useState(false);
  const [deletingProfile, setDeletingProfile] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Camera state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    loadInitialData();
    return () => {
      stopCamera();
    };
  }, []);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(savedPhotoUrls).forEach((u) => URL.revokeObjectURL(u));
      Object.values(capturedPreviews).forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [clsRes, profRes] = await Promise.all([
        classApi.getAll().catch(() => ({ data: { data: [] } })),
        faceProfileApi.getMe(),
      ]);
      setClasses(clsRes.data.data || []);
      const prof = profRes.data.data;
      setProfile(prof);
      if (prof?.enrolled && prof.photos?.length) {
        await loadSavedPhotos(prof.photos.map((p) => p.stepNo));
      }
    } catch (err) {
      console.error('Failed to load face profile:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSavedPhotos = async (steps: number[]) => {
    const nextUrls: Record<number, string> = {};
    await Promise.all(
      steps.map(async (step) => {
        try {
          const res = await faceProfileApi.fetchMyPhotoBlob(step);
          nextUrls[step] = URL.createObjectURL(res.data);
        } catch {
          // ignore missing photo
        }
      }),
    );
    setSavedPhotoUrls((prev) => {
      Object.values(prev).forEach((u) => URL.revokeObjectURL(u));
      return nextUrls;
    });
  };

  const startCamera = async () => {
    setCameraError(null);
    try {
      if (streamRef.current) {
        stopCamera();
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      setCameraError(
        'Không thể truy cập camera. Vui lòng cấp quyền sử dụng Webcam trên trình duyệt và đóng các ứng dụng khác đang chiếm camera.',
      );
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    if (wizardOpen && activeStep >= 1 && activeStep <= 4) {
      startCamera();
    } else {
      stopCamera();
    }
  }, [wizardOpen, activeStep]);

  const handleOpenWizard = () => {
    setStepError(null);
    setSuccessMsg(null);
    setCapturedBlobs({});
    Object.values(capturedPreviews).forEach((u) => URL.revokeObjectURL(u));
    setCapturedPreviews({});
    setActiveStep(1);
    setWizardOpen(true);
  };

  const handleCancelWizard = () => {
    stopCamera();
    setWizardOpen(false);
    setStepError(null);
  };

  const captureFrameBlob = async (): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.88);
    });
  };

  const handleCaptureStep = async () => {
    setStepError(null);
    const blob = await captureFrameBlob();
    if (!blob) {
      setStepError('Chưa lấy được khung hình từ camera. Vui lòng đợi camera hiển thị rõ rồi thử lại.');
      return;
    }

    setValidatingStep(true);
    try {
      const res = await faceProfileApi.validateStep(blob, activeStep);
      const result = res.data.data;
      if (!result.valid) {
        setStepError('Ảnh chưa đạt yêu cầu, vui lòng chụp lại.');
        return;
      }

      const previewUrl = URL.createObjectURL(blob);
      const nextBlobs = { ...capturedBlobs, [activeStep]: blob };
      const nextPreviews = { ...capturedPreviews, [activeStep]: previewUrl };
      if (capturedPreviews[activeStep]) {
        URL.revokeObjectURL(capturedPreviews[activeStep]);
      }
      setCapturedBlobs(nextBlobs);
      setCapturedPreviews(nextPreviews);

      // Move to next uncaptured step or review (step 5)
      let nextStep = 5;
      for (let s = 1; s <= 4; s++) {
        if (!nextBlobs[s]) {
          nextStep = s;
          break;
        }
      }
      setActiveStep(nextStep);
    } catch (err: any) {
      setStepError(
        err?.response?.data?.message || 'Không thể kiểm tra ảnh với dịch vụ AI. Vui lòng thử lại.',
      );
    } finally {
      setValidatingStep(false);
    }
  };

  const handleRetakeSingleStep = (step: number) => {
    setStepError(null);
    setActiveStep(step);
  };

  const handleSubmitEnrollment = async () => {
    setStepError(null);
    const orderedBlobs = [1, 2, 3, 4].map((s) => capturedBlobs[s]).filter(Boolean);
    if (orderedBlobs.length !== 4) {
      setStepError('Vui lòng chụp đủ 4 ảnh trước khi gửi.');
      return;
    }

    setSubmittingEnroll(true);
    try {
      const res = await faceProfileApi.enroll(orderedBlobs, true);
      const updatedProfile = res.data.data;
      setProfile(updatedProfile);
      setWizardOpen(false);
      stopCamera();
      setSuccessMsg(
        'Đã đăng ký đủ 4 ảnh khuôn mặt thành công! Hồ sơ của bạn đang ở trạng thái chờ giảng viên duyệt.',
      );
      if (updatedProfile.photos?.length) {
        await loadSavedPhotos(updatedProfile.photos.map((p) => p.stepNo));
      }
      window.dispatchEvent(new CustomEvent('face-profile-updated'));
    } catch (err: any) {
      setStepError(
        err?.response?.data?.error ||
          err?.response?.data?.message ||
          'Gửi hồ sơ khuôn mặt thất bại. Vui lòng kiểm tra lại 4 ảnh và thử lại.',
      );
    } finally {
      setSubmittingEnroll(false);
    }
  };

  const handleDeleteProfile = async () => {
    if (
      !window.confirm(
        'Bạn có chắc chắn muốn xóa hồ sơ khuôn mặt hiện tại? Sau khi xóa, bạn sẽ cần đăng ký và chờ giảng viên duyệt lại để điểm danh tự động.',
      )
    ) {
      return;
    }
    setDeletingProfile(true);
    setStepError(null);
    setSuccessMsg(null);
    try {
      await faceProfileApi.deleteMe();
      const profRes = await faceProfileApi.getMe();
      setProfile(profRes.data.data);
      setSavedPhotoUrls((prev) => {
        Object.values(prev).forEach((u) => URL.revokeObjectURL(u));
        return {};
      });
      setSuccessMsg('Đã xóa hồ sơ khuôn mặt của bạn.');
      window.dispatchEvent(new CustomEvent('face-profile-updated'));
    } catch (err: any) {
      setStepError(err?.response?.data?.message || 'Không thể xóa hồ sơ khuôn mặt.');
    } finally {
      setDeletingProfile(false);
    }
  };

  const renderStatusBadge = () => {
    if (!profile || !profile.enrolled || profile.reviewStatus === 'unregistered') {
      return (
        <span
          className="badge"
          style={{
            background: '#FEF2F2',
            color: '#DC2626',
            border: '1px solid #FECACA',
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          🔴 Chưa đăng ký
        </span>
      );
    }
    if (profile.reviewStatus === 'approved') {
      return (
        <span
          className="badge"
          style={{
            background: '#ECFDF5',
            color: '#059669',
            border: '1px solid #A7F3D0',
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          🟢 Đã được duyệt (Sẵn sàng điểm danh & thi)
        </span>
      );
    }
    if (profile.reviewStatus === 'pending') {
      return (
        <span
          className="badge"
          style={{
            background: '#FFFBEB',
            color: '#D97706',
            border: '1px solid #FDE68A',
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          🟡 Đang chờ giảng viên duyệt
        </span>
      );
    }
    return (
      <span
        className="badge"
        style={{
          background: '#FEF2F2',
          color: '#DC2626',
          border: '1px solid #FECACA',
          padding: '6px 12px',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        🔴 Bị từ chối — Cần chụp lại
      </span>
    );
  };

  const currentStepMeta = ENROLLMENT_STEPS.find((s) => s.step === activeStep);

  return (
    <div className="app-layout">
      <Sidebar classes={classes} />
      <div className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <header className="page-header">
          <div className="page-header-left">
            <MobileMenuButton />
            <div className="page-header-breadcrumb">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>Hồ sơ sinh trắc học</span>
            </div>
            <h1 className="page-header-title">Khuôn mặt của tôi</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {profile?.aiState && (
              <span
                style={{
                  fontSize: 12,
                  padding: '5px 10px',
                  borderRadius: 999,
                  fontWeight: 600,
                  background:
                    profile.aiState === 'ready'
                      ? '#ECFDF5'
                      : profile.aiState === 'not_ready'
                      ? '#FFFBEB'
                      : '#FEF2F2',
                  color:
                    profile.aiState === 'ready'
                      ? '#059669'
                      : profile.aiState === 'not_ready'
                      ? '#D97706'
                      : '#DC2626',
                }}
              >
                AI Face Engine:{' '}
                {profile.aiState === 'ready'
                  ? 'Sẵn sàng'
                  : profile.aiState === 'not_ready'
                  ? 'Đang khởi động...'
                  : 'Tạm ngưng'}
              </span>
            )}
          </div>
        </header>

        <main className="page-content" style={{ maxWidth: 960, margin: '0 auto' }}>
          {loading ? (
            <div className="page-loading">
              <div className="spinner" />
            </div>
          ) : (
            <>
              {successMsg && (
                <div
                  style={{
                    background: '#ECFDF5',
                    border: '1px solid #A7F3D0',
                    color: '#065F46',
                    borderRadius: 12,
                    padding: '14px 18px',
                    marginBottom: 20,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontWeight: 500,
                  }}
                >
                  <span>✅ {successMsg}</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setSuccessMsg(null)}
                    style={{ color: '#065F46' }}
                  >
                    Đóng
                  </button>
                </div>
              )}

              {stepError && !wizardOpen && (
                <div
                  style={{
                    background: '#FEF2F2',
                    border: '1px solid #FECACA',
                    color: '#991B1B',
                    borderRadius: 12,
                    padding: '14px 18px',
                    marginBottom: 20,
                  }}
                >
                  ⚠️ {stepError}
                </div>
              )}

              {/* Overview Card */}
              <div className="card" style={{ padding: 24, marginBottom: 24 }}>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 16,
                    marginBottom: 20,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                      Sinh viên: <strong>{user?.name}</strong> (ID: {user?.userId})
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>Trạng thái hồ sơ:</span>
                      {renderStatusBadge()}
                    </div>
                    {profile?.updatedAt && (
                      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 8 }}>
                        Cập nhật lần cuối:{' '}
                        <strong>{new Date(profile.updatedAt).toLocaleString('vi-VN')}</strong>
                        {profile.reviewerName && (
                          <>
                            {' '}
                            • Người duyệt: <strong>{profile.reviewerName}</strong>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {!wizardOpen && (
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {profile?.enrolled && (
                        <>
                          <button className="btn btn-primary" onClick={handleOpenWizard}>
                            📸 Cập nhật lại khuôn mặt (4 ảnh)
                          </button>
                          <button
                            className="btn btn-outline"
                            style={{ color: '#DC2626', borderColor: '#FECACA' }}
                            onClick={handleDeleteProfile}
                            disabled={deletingProfile}
                          >
                            {deletingProfile ? 'Đang xóa...' : '🗑 Xóa hồ sơ'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Rejected Banner */}
                {profile?.reviewStatus === 'rejected' && (
                  <div
                    style={{
                      background: '#FEF2F2',
                      border: '1px solid #FECACA',
                      borderRadius: 12,
                      padding: 16,
                      marginBottom: 20,
                      color: '#991B1B',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      ❌ Hồ sơ khuôn mặt bị giảng viên từ chối
                    </div>
                    <div style={{ fontSize: 14 }}>
                      Lý do: <strong>{profile.rejectReason || 'Ảnh không hợp lệ hoặc không rõ mặt'}</strong>
                    </div>
                    <div style={{ fontSize: 13, marginTop: 6 }}>
                      Vui lòng nhấn <strong>"Cập nhật lại khuôn mặt (4 ảnh)"</strong> và chụp lại ở nơi đủ ánh sáng, chính diện, không đeo khẩu trang hoặc kính râm.
                    </div>
                  </div>
                )}

                {/* Pending Banner */}
                {profile?.reviewStatus === 'pending' && (
                  <div
                    style={{
                      background: '#FFFBEB',
                      border: '1px solid #FDE68A',
                      borderRadius: 12,
                      padding: 16,
                      marginBottom: 20,
                      color: '#92400E',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      ⏳ Hồ sơ của bạn đang chờ giảng viên duyệt
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                      Giảng viên phụ trách lớp học sẽ kiểm tra 4 ảnh mẫu của bạn trong mục <strong>"Khuôn mặt SV"</strong>.
                      {profile.usingPreviousApproved ? (
                        <div style={{ marginTop: 6, color: '#065F46', fontWeight: 600 }}>
                          ✓ Trong thời gian chờ duyệt bản cập nhật mới, hệ thống vẫn bảo lưu bản khuôn mặt đã duyệt trước đó để bạn điểm danh và vào phòng thi bình thường.
                        </div>
                      ) : (
                        <div style={{ marginTop: 4 }}>
                          Sau khi giảng viên nhấn Duyệt, bạn sẽ có thể điểm danh tự động bằng khuôn mặt trong phòng học trực tuyến và xác thực vào phòng thi.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Saved 4 Photos Preview */}
                {profile?.enrolled && !wizardOpen && (
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
                      4 ảnh mẫu đã đăng ký của bạn
                    </h3>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: 16,
                      }}
                    >
                      {ENROLLMENT_STEPS.map((st) => {
                        const url = savedPhotoUrls[st.step];
                        return (
                          <div
                            key={st.step}
                            style={{
                              border: '1px solid var(--color-border)',
                              borderRadius: 12,
                              overflow: 'hidden',
                              background: '#0F172A',
                            }}
                          >
                            <div style={{ aspectRatio: '4/3', position: 'relative', background: '#1E293B' }}>
                              {url ? (
                                <img
                                  src={url}
                                  alt={st.badge}
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
                                    width: '100%',
                                    height: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#94A3B8',
                                    fontSize: 12,
                                  }}
                                >
                                  Đang tải ảnh...
                                </div>
                              )}
                              <span
                                style={{
                                  position: 'absolute',
                                  bottom: 8,
                                  left: 8,
                                  background: 'rgba(15, 23, 42, 0.8)',
                                  color: '#F8FAFC',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  padding: '3px 8px',
                                  borderRadius: 6,
                                }}
                              >
                                {st.badge}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Unregistered Call-to-Action & Consent */}
                {!profile?.enrolled && !wizardOpen && (
                  <div
                    style={{
                      background: '#F8FAFC',
                      border: '1px solid var(--color-border)',
                      borderRadius: 14,
                      padding: 20,
                    }}
                  >
                    <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>
                      Hướng dẫn đăng ký khuôn mặt mẫu (4 ảnh)
                    </h3>
                    <ul
                      style={{
                        margin: '0 0 16px 20px',
                        fontSize: 14,
                        color: 'var(--color-text-secondary)',
                        lineHeight: 1.7,
                      }}
                    >
                      <li>
                        Hệ thống sử dụng mô hình AI <strong>InsightFace ArcFace (512 chiều)</strong> để trích xuất đặc trưng khuôn mặt từ 4 góc chụp trực tiếp qua Webcam.
                      </li>
                      <li>
                        Hồ sơ khuôn mặt này được dùng chung cho cả <strong>Điểm danh tự động trong phòng học trực tuyến (Meeting)</strong> và <strong>Kiểm tra danh tính trước khi vào phòng thi (Exam Pre-check)</strong>.
                      </li>
                      <li>
                        Yêu cầu khi chụp: <strong>Ngồi nơi đủ sáng, không đeo khẩu trang, không đeo kính râm, chỉ có 1 người trong khung hình</strong>.
                      </li>
                    </ul>

                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        padding: '12px 14px',
                        background: '#EEF2FF',
                        borderRadius: 10,
                        cursor: 'pointer',
                        marginBottom: 16,
                        fontSize: 13.5,
                        color: '#1E1B4B',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={consentChecked}
                        onChange={(e) => setConsentChecked(e.target.checked)}
                        style={{ marginTop: 3, width: 16, height: 16 }}
                      />
                      <span>
                        Tôi đồng ý cung cấp 4 ảnh mẫu và vector đặc trưng khuôn mặt phục vụ cho việc <strong>xác thực điểm danh lớp học trực tuyến và giám sát thi</strong> trong học kỳ. Tôi hiểu rằng mình có thể cập nhật hoặc xóa hồ sơ bất cứ lúc nào.
                      </span>
                    </label>

                    <button
                      id="btn-start-face-enrollment"
                      className="btn btn-primary"
                      disabled={!consentChecked}
                      onClick={handleOpenWizard}
                    >
                      📸 Bắt đầu chụp 4 ảnh khuôn mặt
                    </button>
                  </div>
                )}
              </div>

              {/* 4-Step Live Webcam Wizard */}
              {wizardOpen && (
                <div className="card" style={{ padding: 24 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 18,
                      flexWrap: 'wrap',
                      gap: 12,
                    }}
                  >
                    <div>
                      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
                        {activeStep <= 4
                          ? currentStepMeta?.title
                          : 'Bước hoàn tất: Kiểm tra lại 4 ảnh trước khi gửi'}
                      </h2>
                      <p style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', margin: 0 }}>
                        {activeStep <= 4
                          ? currentStepMeta?.subtitle
                          : 'Hãy kiểm tra cả 4 ảnh bên dưới. Nếu ảnh nào bị mờ hoặc khuất mặt, bạn có thể nhấn "Chụp lại" từng bước.'}
                      </p>
                    </div>
                    <button className="btn btn-outline btn-sm" onClick={handleCancelWizard}>
                      Hủy bỏ
                    </button>
                  </div>

                  {/* Stepper Pills */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: 10,
                      marginBottom: 20,
                    }}
                  >
                    {ENROLLMENT_STEPS.map((st) => {
                      const done = Boolean(capturedBlobs[st.step]);
                      const isCurrent = activeStep === st.step;
                      return (
                        <div
                          key={st.step}
                          onClick={() => handleRetakeSingleStep(st.step)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            cursor: 'pointer',
                            border: isCurrent
                              ? '2px solid #4F46E5'
                              : done
                              ? '1px solid #10B981'
                              : '1px solid var(--color-border)',
                            background: isCurrent ? '#EEF2FF' : done ? '#ECFDF5' : '#F8FAFC',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: 13,
                            fontWeight: 600,
                          }}
                        >
                          <span>{st.badge}</span>
                          <span>{done ? '✅' : isCurrent ? '📷' : '⏳'}</span>
                        </div>
                      );
                    })}
                  </div>

                  {stepError && (
                    <div
                      style={{
                        background: '#FEF2F2',
                        border: '1px solid #FECACA',
                        color: '#991B1B',
                        borderRadius: 10,
                        padding: '12px 16px',
                        marginBottom: 16,
                        fontSize: 14,
                        fontWeight: 500,
                      }}
                    >
                      ⚠️ {stepError}
                    </div>
                  )}

                  {activeStep <= 4 ? (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(300px, 520px) 1fr',
                        gap: 24,
                        alignItems: 'start',
                      }}
                    >
                      {/* Live Webcam Box with Oval Guide */}
                      <div>
                        <div
                          style={{
                            position: 'relative',
                            width: '100%',
                            aspectRatio: '4/3',
                            background: '#0F172A',
                            borderRadius: 16,
                            overflow: 'hidden',
                            boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
                          }}
                        >
                          {cameraError ? (
                            <div
                              style={{
                                position: 'absolute',
                                inset: 0,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 24,
                                color: '#FCA5A5',
                                textAlign: 'center',
                              }}
                            >
                              <p style={{ marginBottom: 12 }}>{cameraError}</p>
                              <button className="btn btn-primary btn-sm" onClick={startCamera}>
                                Thử kết nối lại Camera
                              </button>
                            </div>
                          ) : (
                            <>
                              <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  objectFit: 'cover',
                                  transform: 'scaleX(-1)',
                                }}
                              />
                              {/* Oval Guide Overlay */}
                              <svg
                                viewBox="0 0 400 300"
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  width: '100%',
                                  height: '100%',
                                  pointerEvents: 'none',
                                }}
                              >
                                <defs>
                                  <mask id="face-oval-mask">
                                    <rect width="400" height="300" fill="white" />
                                    <ellipse cx="200" cy="145" rx="88" ry="112" fill="black" />
                                  </mask>
                                </defs>
                                <rect
                                  width="400"
                                  height="300"
                                  fill="rgba(15, 23, 42, 0.42)"
                                  mask="url(#face-oval-mask)"
                                />
                                <ellipse
                                  cx="200"
                                  cy="145"
                                  rx="88"
                                  ry="112"
                                  fill="none"
                                  stroke="#38BDF8"
                                  strokeWidth="3"
                                  strokeDasharray="8 6"
                                />
                              </svg>
                              <div
                                style={{
                                  position: 'absolute',
                                  bottom: 12,
                                  left: '50%',
                                  transform: 'translateX(-50%)',
                                  background: 'rgba(15, 23, 42, 0.82)',
                                  color: '#F8FAFC',
                                  padding: '6px 14px',
                                  borderRadius: 999,
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                Đặt gương mặt vào trong khung elip
                              </div>
                            </>
                          )}
                        </div>

                        <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                          <button
                            id="btn-capture-face-step"
                            className="btn btn-primary"
                            style={{ flex: 1, padding: '12px 20px', fontSize: 15, fontWeight: 700 }}
                            onClick={handleCaptureStep}
                            disabled={validatingStep || Boolean(cameraError)}
                          >
                            {validatingStep
                              ? '⏳ AI đang kiểm tra khuôn mặt...'
                              : `📸 Chụp ${currentStepMeta?.badge}`}
                          </button>
                          {Object.keys(capturedBlobs).length === 4 && (
                            <button
                              className="btn btn-outline"
                              onClick={() => setActiveStep(5)}
                              disabled={validatingStep}
                            >
                              Xem lại 4 ảnh →
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Captured Thumbnails Sidebar */}
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
                          Ảnh đã chụp ({Object.keys(capturedBlobs).length}/4)
                        </div>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, 1fr)',
                            gap: 12,
                          }}
                        >
                          {ENROLLMENT_STEPS.map((st) => {
                            const url = capturedPreviews[st.step];
                            return (
                              <div
                                key={st.step}
                                onClick={() => handleRetakeSingleStep(st.step)}
                                style={{
                                  border:
                                    activeStep === st.step
                                      ? '2px solid #4F46E5'
                                      : '1px solid var(--color-border)',
                                  borderRadius: 10,
                                  overflow: 'hidden',
                                  cursor: 'pointer',
                                  background: '#0F172A',
                                }}
                              >
                                <div style={{ aspectRatio: '4/3', position: 'relative' }}>
                                  {url ? (
                                    <img
                                      src={url}
                                      alt={st.badge}
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
                                        width: '100%',
                                        height: '100%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: '#64748B',
                                        fontSize: 12,
                                      }}
                                    >
                                      Chưa chụp
                                    </div>
                                  )}
                                  <span
                                    style={{
                                      position: 'absolute',
                                      bottom: 6,
                                      left: 6,
                                      background: 'rgba(15, 23, 42, 0.8)',
                                      color: '#fff',
                                      fontSize: 10.5,
                                      padding: '2px 6px',
                                      borderRadius: 4,
                                    }}
                                  >
                                    {st.badge}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Step 5: Review all 4 photos & Submit */
                    <div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                          gap: 16,
                          marginBottom: 24,
                        }}
                      >
                        {ENROLLMENT_STEPS.map((st) => (
                          <div
                            key={st.step}
                            style={{
                              border: '1px solid var(--color-border)',
                              borderRadius: 12,
                              overflow: 'hidden',
                              background: '#fff',
                            }}
                          >
                            <div style={{ aspectRatio: '4/3', background: '#0F172A' }}>
                              {capturedPreviews[st.step] && (
                                <img
                                  src={capturedPreviews[st.step]}
                                  alt={st.badge}
                                  style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                    transform: 'scaleX(-1)',
                                  }}
                                />
                              )}
                            </div>
                            <div
                              style={{
                                padding: '10px 12px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                              }}
                            >
                              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{st.badge}</span>
                              <button
                                className="btn btn-outline btn-sm"
                                style={{ fontSize: 11.5, padding: '4px 8px' }}
                                onClick={() => handleRetakeSingleStep(st.step)}
                                disabled={submittingEnroll}
                              >
                                Chụp lại
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                        <button
                          className="btn btn-outline"
                          onClick={() => handleRetakeSingleStep(1)}
                          disabled={submittingEnroll}
                        >
                          Chụp lại từ đầu
                        </button>
                        <button
                          id="btn-submit-face-enrollment"
                          className="btn btn-primary"
                          onClick={handleSubmitEnrollment}
                          disabled={submittingEnroll}
                          style={{ padding: '10px 24px', fontWeight: 700 }}
                        >
                          {submittingEnroll
                            ? '⏳ Đang trích xuất & lưu hồ sơ...'
                            : '✅ Xác nhận & Gửi hồ sơ (4 ảnh)'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
