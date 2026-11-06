import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  FiVideo,
  FiMic,
  FiWifi,
  FiCheckCircle,
  FiAlertCircle,
  FiShield,
  FiCamera,
  FiArrowRight,
  FiRefreshCw,
} from 'react-icons/fi';
import { studentExamApi } from '../../api';
import type { Exam } from '../../types';
import './exam.css';

type ConnectionInformation = {
  rtt?: number;
};

type PrecheckExamInfo = Exam & {
  verify_identity?: boolean;
  detect_identity_swap?: boolean;
};

export const PrecheckRoomPage: React.FC = () => {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();

  const [step, setStep] = useState<number>(1);
  const [cameraPermission, setCameraPermission] = useState<boolean | null>(null);
  const [micPermission, setMicPermission] = useState<boolean | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [examInfo, setExamInfo] = useState<PrecheckExamInfo | null>(null);
  const [studentInfo, setStudentInfo] = useState<{ name: string; login_id: string } | null>(null);
  const [networkPing, setNetworkPing] = useState<number | null>(null);
  const [cameraResolution, setCameraResolution] = useState<string | null>(null);
  const [faceAligned, setFaceAligned] = useState<boolean>(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [aiLatencyMs, setAiLatencyMs] = useState<number | null>(null);
  const [termsAgreed, setTermsAgreed] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const proctoringEnabled = examInfo ? Boolean(examInfo.proctoring_enabled) : true;
  const requiresFacePrecheck = proctoringEnabled && (
    examInfo?.verify_identity !== false || Boolean(examInfo?.detect_identity_swap)
  );

  useEffect(() => {
    if (examId) {
      studentExamApi.getExam(examId).then((response) => {
        const loadedExam = response.data.data.exam;
        setExamInfo(loadedExam);
        setStudentInfo(response.data.data.student);
        if (loadedExam.proctoring_enabled) {
          void checkHardware();
        } else {
          setStep(3);
        }
      }).catch((err) => {
        console.error('Không thể tải thông tin đề thi:', err);
        setError(err.response?.data?.error || 'Không thể tải thông tin đề thi. Vui lòng quay lại danh sách và thử lại.');
      });
    }
    return () => {
      stopCamera();
    };
  }, [examId]);

  useEffect(() => {
    const video = videoRef.current;
    const stream = mediaStreamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {
      setError('Không thể phát hình ảnh camera. Vui lòng kiểm tra quyền camera rồi thử lại.');
    });
  }, [cameraPermission]);

  const checkHardware = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Trình duyệt không hỗ trợ camera và microphone.');
      }
      stopCamera();
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        // Cho phép fallback video-only nếu máy bàn không gắn micro rời
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      mediaStreamRef.current = stream;
      const videoTrack = stream.getVideoTracks()[0];
      const settings = videoTrack?.getSettings();
      if (settings?.width && settings?.height) {
        setCameraResolution(`${settings.width}x${settings.height}`);
      }
      const rtt = (navigator as Navigator & { connection?: ConnectionInformation }).connection?.rtt;
      setNetworkPing(typeof rtt === 'number' ? rtt : null);
      setCameraPermission(true);
      setMicPermission(stream.getAudioTracks().length > 0);
      setStep(2);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setError(null);
    } catch (err) {
      console.error('Không thể truy cập thiết bị:', err);
      setCameraPermission(false);
      setMicPermission(false);
      setCameraResolution(null);
      setError(err instanceof Error
        ? `${err.message} Hãy cấp quyền cho trình duyệt rồi thử lại.`
        : 'Không thể truy cập camera. Hãy cấp quyền cho trình duyệt rồi thử lại.');
    }
  };

  const stopCamera = () => {
    setCameraReady(false);
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  };

  const handleCaptureFace = async () => {
    const video = videoRef.current;
    if (!video) {
      setError('Không tìm thấy khung camera. Vui lòng tải lại trang và thử lại.');
      return;
    }

    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 1500);
        video.addEventListener('loadedmetadata', () => {
          window.clearTimeout(timeout);
          resolve();
        }, { once: true });
      });
    }

    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        setError('Camera chưa sẵn sàng. Vui lòng chờ hình ảnh hiển thị rồi chụp lại.');
        return;
      }
      ctx.drawImage(video, 0, 0, 640, 480);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      setCapturedPhoto(dataUrl);
      setFaceAligned(true);
      setStep(3);
      setError(null);
    }
  };

  const handleStartExam = async () => {
    if (!termsAgreed) return;
    if (proctoringEnabled && !cameraPermission) {
      setError('Đề thi bật giám sát AI yêu cầu cấp quyền Camera trước khi vào phòng thi.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let precheckId: string | undefined;

      if (requiresFacePrecheck) {
        let photo = capturedPhoto;
        if (!photo) {
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 480;
          const context = canvas.getContext('2d');
          if (!videoRef.current || videoRef.current.videoWidth === 0 || !context) {
            throw new Error('Camera chưa sẵn sàng. Vui lòng chụp ảnh khuôn mặt chuẩn trước khi vào thi.');
          }
          context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          photo = canvas.toDataURL('image/jpeg', 0.85);
          setCapturedPhoto(photo);
          setFaceAligned(true);
        }

        const t0 = performance.now();
        const response = await fetch(photo);
        const imageBlob = await response.blob();
        const precheckRes = await studentExamApi.precheck(examId!, imageBlob);
        setAiLatencyMs(Math.round(performance.now() - t0));
        precheckId = precheckRes.data.data.precheckId;
      }

      const attemptRes = await studentExamApi.startAttempt(examId!, precheckId);
      const attemptData: any = attemptRes.data.data;
      const attemptId = attemptData?.attempt?.id ?? attemptData?.id;
      if (!attemptId) {
        throw new Error('Không nhận được mã phiên làm bài từ máy chủ.');
      }

      stopCamera();
      navigate(`/exam/${examId}/take/${attemptId}`);
    } catch (err: any) {
      setError(
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        'Không thể bắt đầu kỳ thi. Vui lòng thử lại.',
      );
    } finally {
      setLoading(false);
    }
  };

  const canStart = termsAgreed && !loading && (!proctoringEnabled || Boolean(cameraPermission && cameraReady));

  return (
    <div className="precheck-page-container">
      <div className="precheck-topbar">
        <div className="precheck-brand"><FiShield size={22} /><strong>Elearning Exam</strong></div>
        <div className="precheck-exam-heading">
          <strong>{examInfo?.name || examInfo?.title || 'Kiểm tra điều kiện dự thi'}</strong>
          <span className="precheck-student-line">
            {' '}• Thí sinh: {studentInfo?.name || 'Đang tải thông tin'}
            {studentInfo?.login_id ? ` (${studentInfo.login_id})` : ''}
          </span>
        </div>
        <span className="precheck-ready-pill">● Đang chuẩn bị phòng thi</span>
      </div>

      {proctoringEnabled && (
        <div className="permission-banner">
          <div className="permission-icon"><FiVideo size={22} /></div>
          <div className="permission-copy">
            <strong>Hệ thống yêu cầu quyền truy cập Camera & Microphone</strong>
            <span>Trình duyệt cần quyền webcam thời gian thực để phục vụ AI Proctoring giám sát an toàn suốt kỳ thi.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={cameraPermission ? 'permission-ok' : 'permission-error'}>
              {cameraPermission ? '✓ Đã cấp quyền' : 'ⓘ Chưa cấp quyền'}
            </span>
            {!cameraPermission && (
              <button type="button" className="exam-btn exam-btn-primary" onClick={checkHardware}>
                Cho phép (Allow)
              </button>
            )}
          </div>
        </div>
      )}

      <div className="precheck-flow-card">
        <div className="precheck-flow-title">
          <strong>▣ Mục II.2 • Quy trình Sát hạch & Xác thực Thí sinh Trực tuyến</strong>
          <span className={`precheck-ready-pill ${!proctoringEnabled ? 'precheck-pill-muted' : ''}`}>
            ● {!proctoringEnabled ? 'GIÁM SÁT AI ĐANG TẮT' : 'AI SẼ XÁC THỰC KHUÔN MẶT THẬT TRƯỚC KHI VÀO THI'}
          </span>
        </div>
        <div className="precheck-flow-steps">
          <div className={`flow-step ${step > 1 || !proctoringEnabled ? 'complete' : 'current'}`}>
            <b>1</b>
            <span>
              <strong>Bước 1: Phần cứng & Mạng</strong>
              <small>{!proctoringEnabled ? 'Không yêu cầu camera' : cameraPermission ? 'Camera đã sẵn sàng' : 'Đang kiểm tra thiết bị'}</small>
            </span>
          </div>
          <div className={`flow-step ${step > 2 || !requiresFacePrecheck ? 'complete' : step === 2 ? 'current' : ''}`}>
            <b>2</b>
            <span>
              <strong>Bước 2: Đối soát Khuôn mặt</strong>
              <small>{!requiresFacePrecheck ? 'Không yêu cầu đối soát' : faceAligned ? 'Đã chụp ảnh chuẩn' : 'Căn chỉnh khuôn mặt'}</small>
            </span>
          </div>
          <div className={`flow-step ${step === 3 ? 'current' : ''}`}>
            <b>3</b>
            <span>
              <strong>Bước 3: Cam kết Quy chế</strong>
              <small>{termsAgreed ? 'Đã xác nhận cam kết' : 'Xác nhận trước khi vào thi'}</small>
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="exam-error-banner">
          <FiAlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Main Container Grid (Matching image10.png) */}
      <div className="precheck-content-grid">
        {/* Left Column: Webcam & Hardware Summary */}
        <div className="webcam-precheck-panel">
          <div className="precheck-camera-heading">
            <strong>② Đăng ký & Đối soát Khuôn mặt Trực tiếp</strong>
            <span className="camera-live-meta"><i /> {proctoringEnabled ? (cameraResolution || 'Đang chờ camera') : 'Giám sát AI tắt'}</span>
          </div>

          <div className="viewport-circle-frame">
            {proctoringEnabled ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="precheck-video-stream"
                onLoadedMetadata={() => setCameraReady(true)}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', gap: 8 }}>
                <FiShield size={42} />
                <span>Đề thi này không yêu cầu mở Camera giám sát AI</span>
              </div>
            )}

            <div className="camera-hud-top">
              <span>
                {!proctoringEnabled
                  ? '○ AI PROCTORING OFF'
                  : `${cameraReady ? '● REC • CAMERA LIVE' : '○ CAMERA OFFLINE'} • ${capturedPhoto ? 'ẢNH ĐÃ CHỤP' : 'CHỜ CHỤP ẢNH'}`}
              </span>
              <span>
                {aiLatencyMs !== null ? `Độ trễ AI: ${aiLatencyMs} ms` : 'Độ trễ AI: Đo khi xác thực'}
              </span>
            </div>

            {proctoringEnabled && (
              <div className={`circular-alignment-guide ${faceAligned ? 'aligned' : ''}`}>
                <div className="crosshair-center" />
              </div>
            )}

            <div className="viewport-status-tag">
              {!proctoringEnabled ? (
                <span className="tag-aligned">
                  <FiCheckCircle /> Bạn có thể xác nhận quy chế ở cột phải để bắt đầu làm bài
                </span>
              ) : faceAligned ? (
                <span className="tag-aligned">
                  <FiCheckCircle /> Ảnh chuẩn đã chụp • Hệ thống AI sẽ trích xuất embedding 512 chiều khi bấm Bắt đầu
                </span>
              ) : (
                <span className="tag-positioning">
                  Căn chỉnh khuôn mặt rõ nét, đủ ánh sáng vào vòng tròn trung tâm
                </span>
              )}
            </div>
          </div>

          {proctoringEnabled && (
            <div className="camera-controls-bottom">
              <button
                type="button"
                className="exam-btn exam-btn-outline"
                onClick={handleCaptureFace}
                disabled={!cameraPermission || !cameraReady}
                title={!cameraPermission || !cameraReady ? 'Camera chưa sẵn sàng để chụp' : 'Chụp ảnh đối soát'}
              >
                <FiCamera size={16} /> {capturedPhoto ? 'Chụp lại ảnh chuẩn' : 'Chụp ảnh khuôn mặt chuẩn'}
              </button>
              <button
                type="button"
                className="exam-btn exam-btn-secondary"
                onClick={checkHardware}
                title="Khởi động lại camera"
              >
                <FiRefreshCw size={16} />
              </button>
            </div>
          )}

          {proctoringEnabled && !cameraReady && (
            <div className="camera-readiness-message">
              {cameraPermission === false ? 'Chưa cấp quyền camera.' : 'Đang chờ hình ảnh camera sẵn sàng...'}
            </div>
          )}

          <div className="hardware-summary-card">
            <div className="hardware-summary-heading">
              <strong><span className="step-number-pill">1</span> Kiểm tra Phần cứng & Mạng kết nối</strong>
              <span className={!proctoringEnabled || cameraPermission ? 'permission-ok' : 'permission-error'}>
                {!proctoringEnabled ? 'Sẵn sàng' : cameraPermission ? 'Đạt tiêu chuẩn' : 'Chưa sẵn sàng'}
              </span>
            </div>
            <div className="hardware-summary-row">
              <FiVideo />
              <span>
                <strong>Camera {cameraResolution || (proctoringEnabled ? 'chưa xác định' : 'không bắt buộc')}</strong>
                <small>{!proctoringEnabled ? 'Đề thi không bật giám sát hình ảnh' : cameraPermission ? 'Trạng thái: Đã kết nối • Tín hiệu hình ảnh rõ nét' : 'Chưa cấp quyền hoặc chưa kết nối'}</small>
              </span>
              <b>{!proctoringEnabled ? 'Không bắt buộc' : cameraPermission ? '✓ Đạt chuẩn' : 'Chưa sẵn sàng'}</b>
            </div>
            <div className="hardware-summary-row">
              <FiMic />
              <span>
                <strong>Microphone</strong>
                <small>{micPermission ? 'Đã nhận tín hiệu micro' : 'Tùy chọn hỗ trợ kiểm tra môi trường'}</small>
              </span>
              <b>{micPermission ? '✓ Sẵn sàng' : 'Không bắt buộc'}</b>
            </div>
            <div className="hardware-summary-row">
              <FiWifi />
              <span>
                <strong>Kết nối Internet</strong>
                <small>{networkPing === null ? 'Kết nối trực tiếp tới máy chủ khảo thí' : `Độ trễ trình duyệt (RTT): ${networkPing} ms`}</small>
              </span>
              <b>{networkPing !== null ? `${networkPing} ms` : 'Ổn định'}</b>
            </div>
          </div>
        </div>

        {/* Right Column: Candidate Profile & AI Rules Checklist (Matching image10.png) */}
        <div className="precheck-checklist-panel">
          <div className="candidate-profile-card">
            <div className="candidate-profile-heading">
              HỒ SƠ THÍ SINH ĐỐI SOÁT{' '}
              <span className={!requiresFacePrecheck || capturedPhoto ? 'permission-ok' : 'permission-error'}>
                {!requiresFacePrecheck ? '✓ HỢP LỆ' : capturedPhoto ? '✓ ĐÃ CHỤP ẢNH' : 'CHỜ CHỤP ẢNH'}
              </span>
            </div>
            <div className="candidate-profile-body">
              <div className="candidate-avatar"><FiShield size={24} /></div>
              <div>
                <strong>{studentInfo?.name || 'Sinh viên dự thi'}</strong>
                <span>MSSV: {studentInfo?.login_id || 'Chưa cập nhật'} • Lớp: {examInfo?.class_name || 'Đang tải'}</span>
                <small>Dữ liệu khuôn mặt chỉ dùng để đối soát trong ca thi và tự động hủy khi hết hạn lưu trữ</small>
              </div>
            </div>
          </div>

          <div className="ai-checklist-card">
            <div className="candidate-profile-heading">
              <strong>③ Checklist Quy định Phòng Thi {proctoringEnabled ? 'AI' : 'Trực tuyến'}</strong>
              <span className="ai-auto-pill">{proctoringEnabled ? 'Giám sát tự động' : 'Chế độ tiêu chuẩn'}</span>
            </div>
            <div className="ai-rule-item">
              <b>✓</b>
              <span>
                <strong>Hiện diện khuôn mặt 100%</strong>
                <small>Giữ khuôn mặt luôn trong khung hình camera trong suốt quá trình làm bài.</small>
              </span>
            </div>
            <div className="ai-rule-item">
              <b>✓</b>
              <span>
                <strong>Cấm thiết bị thứ hai (Điện thoại, tài liệu)</strong>
                <small>Tuyệt đối không mang và sử dụng điện thoại, màn hình phụ hoặc tài liệu trái phép.</small>
              </span>
            </div>
            <div className="ai-rule-item">
              <b>✓</b>
              <span>
                <strong>Kiểm soát góc nhìn & chuyển đổi cửa sổ</strong>
                <small>Hạn chế quay đầu lệch khỏi màn hình hoặc rời tab trình duyệt trong lúc làm bài.</small>
              </span>
            </div>
            <div className="ai-rule-item">
              <b>✓</b>
              <span>
                <strong>Không gian độc lập, đủ ánh sáng</strong>
                <small>Đảm bảo chỉ có một mình bạn trong khung hình camera, tránh ngược sáng mạnh.</small>
              </span>
            </div>
            <div className="ai-rule-item warning">
              <b>⌁</b>
              <span>
                <strong>Cơ chế cảnh báo & tự động thu bài khi vi phạm nghiêm trọng</strong>
                <small>Mọi vi phạm xác nhận đều kèm ảnh bằng chứng gửi trực tiếp tới giám thị coi thi.</small>
              </span>
            </div>

            <div className="terms-checkbox-wrap precheck-terms">
              <label>
                <input type="checkbox" checked={termsAgreed} onChange={(e) => setTermsAgreed(e.target.checked)} />
                <span>
                  Tôi đã đọc kỹ và cam kết tuân thủ nghiêm túc nội quy phòng thi. Mọi hành vi gian lận sẽ chịu xử lý theo quy chế khảo thí.
                </span>
              </label>
            </div>

            <div className="precheck-action-buttons">
              <button
                type="button"
                className="exam-btn exam-btn-primary btn-start-exam"
                onClick={handleStartExam}
                disabled={!canStart}
              >
                {loading ? 'Đang xác thực AI & khởi tạo đề thi...' : <>Bắt đầu làm bài thi <FiArrowRight size={18} /></>}
              </button>
              <button type="button" className="exam-btn exam-btn-secondary" onClick={() => navigate(-1)}>
                <span>←</span> Quay lại danh sách đề thi
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
