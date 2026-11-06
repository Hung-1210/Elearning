import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  FiCheckCircle,
  FiClock,
  FiShield,
  FiArrowLeft,
  FiDownload,
  FiTrendingUp,
  FiLock,
  FiInfo,
  FiFileText,
  FiFlag,
  FiBookOpen,
  FiAlertCircle,
} from 'react-icons/fi';
import { studentExamApi } from '../../api';
import './exam.css';

interface ResultState {
  attemptId: number;
  attemptNo: number;
  examId: number;
  classId: number | null;
  className: string;
  title: string;
  studentName: string;
  studentCode: string;
  submittedAt: string | null;
  submitReason: string | null;
  durationMinutes: number;
  resultVisible: boolean;
  resultVisibility: 'immediately' | 'after_close' | 'hidden';
  resultVisibilityReason: string | null;
  allowReview: boolean;
  gradingStatus: 'auto_graded' | 'needs_manual' | 'graded' | string;
  score: number | null;
  maxScore: number;
  correctCount: number | null;
  objectiveCount: number;
  totalQuestions: number;
  answeredCount: number;
  unansweredCount: number;
  flaggedCount: number;
  proctoringEnabled: boolean;
  violationsCount: number | null;
  competencies: Array<{ chapter: string; percentage: number; label: string }>;
  questions: any[];
}

export const ExamResultPage: React.FC = () => {
  const { attemptId } = useParams<{ examId: string; attemptId: string }>();
  const navigate = useNavigate();
  const [resultData, setResultData] = useState<ResultState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!attemptId) return;
    studentExamApi
      .getAttempt(attemptId)
      .then((res) => {
        const attempt = res.data.data;
        const questions: any[] = attempt.questions || [];
        const startedAt = new Date(attempt.started_at).getTime();
        const submittedAt = new Date(attempt.submitted_at || Date.now()).getTime();
        const durationMinutes = Math.max(1, Math.round((submittedAt - startedAt) / 60000));

        const answeredCount = questions.filter((q) => {
          const ans = q.answer;
          if (!ans) return false;
          if (Array.isArray(ans.selected_option_ids) && ans.selected_option_ids.length > 0) return true;
          if (typeof ans.text_answer === 'string' && ans.text_answer.trim().length > 0) return true;
          if (ans.file_path) return true;
          return false;
        }).length;
        const flaggedCount = questions.filter((q) => Boolean(q.answer?.is_flagged)).length;
        const objectiveCount = questions.filter(
          (q) => q.question_type === 'single_choice' || q.question_type === 'multiple_choice',
        ).length;

        const resultVisible = Boolean(attempt.resultVisible);
        const rawScore =
          resultVisible && attempt.total_score !== null && attempt.total_score !== undefined
            ? Number(attempt.total_score)
            : null;

        setResultData({
          attemptId: Number(attempt.id),
          attemptNo: Number(attempt.attempt_no ?? 1),
          examId: Number(attempt.exam_id ?? attempt.exam?.id ?? 0),
          classId: attempt.exam?.class_id ? Number(attempt.exam.class_id) : null,
          className: attempt.exam?.class_name || 'Lớp học phần',
          title: attempt.exam?.name || attempt.exam?.title || 'Kỳ thi trực tuyến',
          studentName: attempt.student_name || attempt.exam?.student_name || 'Sinh viên',
          studentCode: attempt.login_id || attempt.exam?.login_id || '',
          submittedAt: attempt.submitted_at || null,
          submitReason: attempt.submit_reason || 'manual',
          durationMinutes,
          resultVisible,
          resultVisibility: attempt.exam?.result_visibility || 'after_close',
          resultVisibilityReason: attempt.resultVisibilityReason || null,
          allowReview: Boolean(attempt.exam?.allow_review),
          gradingStatus: attempt.grading_status || 'graded',
          score: rawScore,
          maxScore: Number(attempt.max_score ?? 10),
          correctCount: typeof attempt.correct_count === 'number' ? attempt.correct_count : null,
          objectiveCount,
          totalQuestions: questions.length,
          answeredCount,
          unansweredCount: Math.max(0, questions.length - answeredCount),
          flaggedCount,
          proctoringEnabled: attempt.proctoringSettings ? Boolean(attempt.proctoringSettings.enabled) : true,
          violationsCount: typeof attempt.violation_count === 'number' ? attempt.violation_count : null,
          competencies: Array.isArray(attempt.competencies) ? attempt.competencies : [],
          questions,
        });
      })
      .catch((err) => {
        setError(err.response?.data?.error || 'Không thể tải kết quả bài thi.');
      });
  }, [attemptId]);

  if (error) {
    return (
      <div className="exam-empty-state" style={{ margin: 40 }}>
        <h3>{error}</h3>
        <button type="button" className="exam-btn exam-btn-secondary" onClick={() => navigate(-1)}>
          Quay lại
        </button>
      </div>
    );
  }

  if (!resultData) {
    return (
      <div className="exam-loading-state" style={{ minHeight: '70vh' }}>
        <div className="spinner" />
        <p>Đang tải biên nhận nộp bài & kết quả...</p>
      </div>
    );
  }

  const isPendingManual = resultData.gradingStatus === 'needs_manual';
  const passed =
    resultData.score !== null && resultData.maxScore > 0
      ? resultData.score >= resultData.maxScore * 0.5
      : false;

  const submitReasonText =
    resultData.submitReason === 'timeout'
      ? 'Tự động nộp khi hết thời gian'
      : resultData.submitReason === 'violation_threshold'
        ? 'Tự động nộp do vượt ngưỡng vi phạm AI'
        : resultData.submitReason === 'lecturer_force'
          ? 'Giảng viên thu bài trực tiếp'
          : 'Thí sinh chủ động nộp bài';

  const handleBackToClass = () => {
    if (resultData.classId) {
      navigate(`/class/${resultData.classId}?tab=exams`);
    } else {
      navigate(-1);
    }
  };

  return (
    <div className="exam-result-page-container">
      {/* Top Green Submission Confirmation Card (Matching image15.png) */}
      <div className="result-submission-banner">
        <div className="sub-banner-left">
          <div className="sub-check-circle">
            <FiCheckCircle size={28} />
          </div>
          <div>
            <span className="sub-pill-tag">BIÊN NHẬN NỘP BÀI HỢP LỆ • LẦN THI #{resultData.attemptNo}</span>
            <h2>Hoàn thành nộp bài thi trực tuyến!</h2>
            <p>
              Đề thi: <strong>{resultData.title}</strong> • Ghi nhận lúc:{' '}
              <strong>
                {resultData.submittedAt
                  ? new Date(resultData.submittedAt).toLocaleString('vi-VN')
                  : 'Vừa xong'}
              </strong>
            </p>
          </div>
        </div>

        <div className="sub-banner-actions">
          <button
            type="button"
            className="exam-btn exam-btn-outline"
            onClick={() => window.print()}
          >
            <FiDownload size={15} /> In biên nhận (PDF)
          </button>
        </div>
      </div>

      {/* Two-Column Result Layout (Matching image15.png) */}
      <div className="result-two-col-grid">
        {/* Left Column: Score + Chapter Competency + Optional Review */}
        <div className="result-left-col">
          <div className="exam-card">
            <h4 className="card-subhead">
              <FiFileText className="subhead-icon" /> Kết quả Điểm số Bài thi
            </h4>

            {!resultData.resultVisible ? (
              <div className="score-hidden-notice">
                <div className="hidden-lock-icon">
                  <FiLock size={26} />
                </div>
                <div>
                  <h4>Chưa công bố điểm số</h4>
                  <p>
                    {resultData.resultVisibilityReason ||
                      'Điểm số sẽ được hiển thị theo chính sách công bố kết quả của giảng viên.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="score-visible-hero">
                <div className="score-ring-circle">
                  <span className="s-num">{resultData.score ?? 0}</span>
                  <span className="s-max">/ {resultData.maxScore}</span>
                </div>
                <div className="score-visible-info">
                  {isPendingManual ? (
                    <span className="exam-badge exam-badge-orange">
                      ⏳ Điểm sơ bộ (Chờ giảng viên chấm phần tự luận)
                    </span>
                  ) : (
                    <span className={`exam-badge ${passed ? 'exam-badge-green' : 'status-pill-badge badge-red'}`}>
                      {passed ? '✓ ĐẠT YÊU CẦU' : '✕ CHƯA ĐẠT NGƯỠNG 50%'}
                    </span>
                  )}
                  <h3>
                    {isPendingManual
                      ? `Điểm trắc nghiệm tạm tính: ${resultData.score ?? 0}/${resultData.maxScore} điểm`
                      : `Tổng điểm đạt được: ${resultData.score ?? 0}/${resultData.maxScore} điểm`}
                  </h3>
                  {resultData.correctCount !== null && resultData.objectiveCount > 0 && (
                    <p>
                      Số câu trắc nghiệm đúng:{' '}
                      <strong>
                        {resultData.correctCount} / {resultData.objectiveCount} câu
                      </strong>
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="visibility-policy-note">
              <FiInfo size={16} />
              <span>
                Chính sách công bố kết quả:{' '}
                <strong>
                  {resultData.resultVisibility === 'immediately'
                    ? 'Hiển thị điểm ngay sau khi nộp bài'
                    : resultData.resultVisibility === 'after_close'
                      ? 'Công bố điểm sau khi ca thi đóng'
                      : 'Chỉ giảng viên xem điểm'}
                </strong>
                {' • '}
                {resultData.allowReview
                  ? 'Cho phép xem lại đáp án khi điểm được mở.'
                  : 'Không mở xem lại đáp án chi tiết để bảo mật ngân hàng đề.'}
              </span>
            </div>
          </div>

          {/* Competency Breakdown by Chapter */}
          <div className="exam-card">
            <h4 className="card-subhead">
              <FiTrendingUp className="subhead-icon" /> Đánh giá Năng lực theo Chương
            </h4>

            {!resultData.resultVisible ? (
              <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
                Biểu đồ năng lực theo chương sẽ được mở cùng thời điểm công bố điểm số.
              </p>
            ) : resultData.competencies.length === 0 ? (
              <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
                Các câu hỏi trong đề thi này chưa gắn nhãn phân chương cụ thể.
              </p>
            ) : (
              <div className="telemetry-category-list">
                {resultData.competencies.map((comp, idx) => (
                  <div key={idx} className="telemetry-row">
                    <div className="t-row-labels">
                      <span>{comp.chapter}</span>
                      <strong>
                        {comp.percentage}% • {comp.label}
                      </strong>
                    </div>
                    <div className="progress-track">
                      <div
                        className={`progress-fill ${
                          comp.percentage >= 80
                            ? 'fill-green'
                            : comp.percentage >= 50
                              ? 'fill-blue'
                              : 'fill-orange'
                        }`}
                        style={{ width: `${comp.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Detailed Question Review when allowed by policy */}
          {resultData.resultVisible && resultData.allowReview && resultData.questions.length > 0 && (
            <div className="exam-card">
              <h4 className="card-subhead">
                <FiBookOpen className="subhead-icon" /> Chi tiết bài làm của bạn
              </h4>
              <div style={{ display: 'grid', gap: 12 }}>
                {resultData.questions.map((q: any, idx: number) => (
                  <div key={q.id || idx} className="review-q-mini-card">
                    <div className="rq-top">
                      <strong>Câu {idx + 1}:</strong>
                      <span className="points-pill-badge">
                        {q.answer?.score ?? 0} / {q.points}đ
                      </span>
                    </div>
                    <p className="rq-text">{q.content}</p>
                    {q.answer?.grader_comment && (
                      <div className="rubric-hint-box">
                        <strong>Nhận xét giảng viên:</strong> {q.answer.grader_comment}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Pre-submit Stats + AI Proctoring Summary + Class Card (image15.png) */}
        <div className="result-right-col">
          <div className="exam-card">
            <h4 className="card-subhead">
              <FiClock className="subhead-icon" /> Thống kê lượt làm bài
            </h4>
            <div className="result-kv-list">
              <div className="kv-row">
                <span>Tổng số câu hỏi</span>
                <strong>{resultData.totalQuestions} câu</strong>
              </div>
              <div className="kv-row">
                <span>Số câu đã trả lời</span>
                <strong style={{ color: '#059669' }}>{resultData.answeredCount} câu</strong>
              </div>
              <div className="kv-row">
                <span>Số câu bỏ trống</span>
                <strong>{resultData.unansweredCount} câu</strong>
              </div>
              <div className="kv-row">
                <span>
                  <FiFlag size={12} style={{ marginRight: 4 }} />
                  Đánh dấu xem lại
                </span>
                <strong>{resultData.flaggedCount} câu</strong>
              </div>
              <div className="kv-row">
                <span>Thời gian làm bài thực tế</span>
                <strong>{resultData.durationMinutes} phút</strong>
              </div>
              <div className="kv-row">
                <span>Hình thức kết thúc</span>
                <strong>{submitReasonText}</strong>
              </div>
            </div>
          </div>

          <div className="exam-card">
            <h4 className="card-subhead">
              <FiShield className="subhead-icon" /> Giám sát AI Proctoring
            </h4>
            {!resultData.proctoringEnabled ? (
              <div className="proctor-summary-pill neutral">
                <FiInfo size={18} />
                <div>
                  <strong>Không bật giám sát Camera AI</strong>
                  <small>Đề thi này được cấu hình làm bài tiêu chuẩn không thu hình.</small>
                </div>
              </div>
            ) : (resultData.violationsCount ?? 0) === 0 ? (
              <div className="proctor-summary-pill safe">
                <FiCheckCircle size={18} />
                <div>
                  <strong>Phiên thi hợp lệ (0 cảnh báo)</strong>
                  <small>Hệ thống AI không ghi nhận hành vi bất thường nào trong suốt ca thi.</small>
                </div>
              </div>
            ) : (
              <div className="proctor-summary-pill warn">
                <FiAlertCircle size={18} />
                <div>
                  <strong>Ghi nhận {resultData.violationsCount} sự kiện cảnh báo</strong>
                  <small>
                    Dữ liệu cảnh báo chỉ mang tính hỗ trợ và sẽ được giảng viên trực tiếp hậu kiểm.
                  </small>
                </div>
              </div>
            )}
          </div>

          <div className="exam-card">
            <h4 className="card-subhead">
              <FiBookOpen className="subhead-icon" /> Thông tin Lớp học phần
            </h4>
            <div className="result-kv-list" style={{ marginBottom: 16 }}>
              <div className="kv-row">
                <span>Lớp học</span>
                <strong>{resultData.className}</strong>
              </div>
              <div className="kv-row">
                <span>Thí sinh</span>
                <strong>{resultData.studentName}</strong>
              </div>
              {resultData.studentCode && (
                <div className="kv-row">
                  <span>Mã định danh</span>
                  <strong>{resultData.studentCode}</strong>
                </div>
              )}
            </div>

            <button
              type="button"
              className="exam-btn exam-btn-primary btn-full-width"
              onClick={handleBackToClass}
            >
              <FiArrowLeft size={16} /> Quay về trang lớp học
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
