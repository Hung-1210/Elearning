import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiClock,
  FiCalendar,
  FiShield,
  FiCheckCircle,
  FiAlertCircle,
  FiVideo,
  FiArrowRight,
  FiFileText,
  FiAward,
  FiInfo,
  FiLock,
} from 'react-icons/fi';
import { studentExamApi } from '../../api';
import type { Exam } from '../../types';
import './exam.css';

interface StudentExamListTabProps {
  classId: string;
}

export const StudentExamListTab: React.FC<StudentExamListTabProps> = ({ classId }) => {
  const navigate = useNavigate();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadStudentExams();
  }, [classId]);

  const loadStudentExams = async () => {
    setLoading(true);
    try {
      const res = await studentExamApi.getAvailable(classId);
      const list =
        (res.data as any)?.exams ||
        (res.data as any)?.data?.exams ||
        (res.data as any)?.data ||
        [];
      setExams(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error(err);
      setExams([]);
    } finally {
      setLoading(false);
    }
  };

  // Backend trả myAttempts sắp xếp theo attempt_no DESC => phần tử [0] là lượt thi mới nhất
  const getLatestAttempt = (ex: Exam): any => {
    if (Array.isArray(ex.myAttempts) && ex.myAttempts.length > 0) return ex.myAttempts[0];
    return ex.my_attempt ?? null;
  };

  const getCompletedAttemptsCount = (ex: Exam): number => {
    if (Array.isArray(ex.myAttempts)) {
      return ex.myAttempts.filter((a: any) => a.status !== 'in_progress').length;
    }
    return ex.my_attempt && ex.my_attempt.status !== 'in_progress' ? 1 : 0;
  };

  // Kỳ thi đang mở mà sinh viên đang làm dở hoặc còn lượt làm bài
  const activeExams = exams.filter((ex) => {
    if (ex.display_status !== 'open') return false;
    const latest = getLatestAttempt(ex);
    if (latest?.status === 'in_progress') return true;
    const usedCount = getCompletedAttemptsCount(ex);
    const maxAttempts = Number(ex.max_attempts ?? 1);
    return usedCount < maxAttempts;
  });

  const upcomingExams = exams.filter((ex) => ex.display_status === 'scheduled');

  const completedExams = exams.filter((ex) => {
    if (Array.isArray(ex.myAttempts)) {
      return ex.myAttempts.some((a: any) => a.status !== 'in_progress');
    }
    return Boolean(ex.my_attempt && ex.my_attempt.status !== 'in_progress');
  });

  const closedExams = exams.filter((ex) => {
    const hasCompleted = completedExams.some((c) => c.id === ex.id);
    return !hasCompleted && ex.display_status === 'closed';
  });

  return (
    <div className="student-exam-list-container">
      {/* Guideline Banner (Matching image11.png) */}
      <div className="exam-guideline-banner">
        <div className="banner-left-icon">
          <FiShield size={32} />
        </div>
        <div className="banner-content">
          <h4>Quy chế & Lưu ý đối với Kỳ thi trực tuyến tích hợp AI Giám sát</h4>
          <ul>
            <li>Thí sinh chuẩn bị máy tính có Camera hoạt động ổn định và ngồi nơi đủ ánh sáng.</li>
            <li>
              Với đề thi bật xác thực danh tính, bạn sẽ thực hiện bước{' '}
              <strong>Pre-check căn chỉnh khuôn mặt</strong> trước khi bắt đầu tính giờ.
            </li>
            <li>
              Hệ thống AI phân tích góc quay đầu, hướng nhìn, vật thể cấm (điện thoại, tài liệu) và thao tác chuyển tab theo cấu hình đề thi.
            </li>
            <li>
              Mọi cảnh báo đều cần tích lũy đủ thời lượng và được giảng viên hậu kiểm — sự cố mạng hoặc trễ AI không tự động tính lỗi cho thí sinh.
            </li>
          </ul>
        </div>
      </div>

      {loading ? (
        <div className="exam-loading-state">
          <div className="spinner"></div>
          <p>Đang tải danh sách bài thi của bạn...</p>
        </div>
      ) : (
        <>
          {/* Active Exams Section */}
          <div className="exam-section-block">
            <div className="section-title-row">
              <h3>
                <span className="live-dot-ping"></span>
                Kỳ thi đang mở (Sẵn sàng làm bài)
              </h3>
              <span className="exam-count-tag">{activeExams.length} kỳ thi</span>
            </div>

            {activeExams.length === 0 ? (
              <div className="empty-sub-card">
                <FiInfo size={22} />
                <span>Hiện tại không có kỳ thi nào đang mở cho lượt làm bài mới.</span>
              </div>
            ) : (
              <div className="student-exam-cards-grid">
                {activeExams.map((exam) => {
                  const latest = getLatestAttempt(exam);
                  const isInProgress = latest?.status === 'in_progress';
                  const usedCount = getCompletedAttemptsCount(exam);
                  const maxAttempts = Number(exam.max_attempts ?? 1);
                  const aiEnabled = Boolean(
                    exam.proctoring_settings?.enabled ?? exam.proctoring_enabled,
                  );

                  return (
                    <div key={exam.id} className="student-exam-card active-card">
                      <div className="s-card-top">
                        <div className="s-badge-row">
                          <span className="exam-badge exam-badge-green">
                            {isInProgress ? '● Đang làm dở' : '● Đang mở thi'}
                          </span>
                          {aiEnabled && (
                            <span className="exam-badge exam-badge-ai">
                              <FiShield size={12} /> AI Giám sát
                            </span>
                          )}
                        </div>
                        <span className="s-duration-badge">
                          <FiClock size={14} /> {exam.duration_minutes} phút
                        </span>
                      </div>

                      <h3 className="s-card-title">{exam.title || exam.name}</h3>
                      <p className="s-card-desc">
                        {exam.description || 'Bài thi trực tuyến đánh giá kiến thức học phần'}
                      </p>

                      <div className="s-card-meta">
                        <div className="s-meta-item">
                          <FiFileText size={14} />
                          <span>
                            {exam.total_questions || 0} câu hỏi ({Number(exam.total_points || 0)} điểm) • Lượt thi:{' '}
                            {usedCount}/{maxAttempts}
                          </span>
                        </div>
                        <div className="s-meta-item">
                          <FiCalendar size={14} />
                          <span>
                            Đóng đề lúc:{' '}
                            {new Date(exam.end_time).toLocaleTimeString('vi-VN', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}{' '}
                            - {new Date(exam.end_time).toLocaleDateString('vi-VN')}
                          </span>
                        </div>
                      </div>

                      <div className="s-card-action">
                        <button
                          type="button"
                          className="exam-btn exam-btn-primary btn-full-width"
                          onClick={() =>
                            isInProgress
                              ? navigate(`/exam/${exam.id}/take/${latest.id}`)
                              : navigate(`/exam/${exam.id}/precheck`)
                          }
                        >
                          <FiVideo size={16} />{' '}
                          {isInProgress ? 'Tiếp tục bài đang làm' : 'Vào phòng thi ngay'}{' '}
                          <FiArrowRight size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Completed Exams Section */}
          <div className="exam-section-block">
            <div className="section-title-row">
              <h3>
                <FiAward size={20} className="section-icon" />
                Kết quả các kỳ thi đã hoàn thành
              </h3>
              <span className="exam-count-tag">{completedExams.length} bài</span>
            </div>

            {completedExams.length === 0 ? (
              <div className="empty-sub-card">
                <FiInfo size={22} />
                <span>Bạn chưa có bài thi nào đã hoàn thành trong lớp học này.</span>
              </div>
            ) : (
              <div className="completed-exams-list">
                {completedExams.map((exam) => {
                  const attempt = Array.isArray(exam.myAttempts)
                    ? exam.myAttempts.find((a: any) => a.status !== 'in_progress')
                    : exam.my_attempt;
                  if (!attempt) return null;

                  const resultVisible =
                    attempt.resultVisible !== undefined
                      ? Boolean(attempt.resultVisible)
                      : attempt.total_score !== null && attempt.total_score !== undefined;
                  const needsManual = attempt.grading_status === 'needs_manual';
                  const vCount = Number(
                    attempt.violation_count ?? attempt.proctoring_flags?.total_violations ?? 0,
                  );
                  const aiEnabled = Boolean(
                    exam.proctoring_settings?.enabled ?? exam.proctoring_enabled,
                  );

                  return (
                    <div key={`${exam.id}-${attempt.id}`} className="completed-exam-row">
                      <div className="comp-left">
                        <div className="comp-score-box">
                          {!resultVisible ? (
                            <span className="score-pending" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <FiLock size={12} />
                              {exam.result_visibility === 'hidden' ? 'Bảo mật' : 'Chờ công bố'}
                            </span>
                          ) : needsManual ? (
                            <div style={{ textAlign: 'center', padding: '4px 8px' }}>
                              <span className="score-pending" style={{ color: '#D97706', display: 'block' }}>
                                Chờ chấm TL
                              </span>
                              <small style={{ fontSize: 11, color: '#64748B' }}>
                                TN: {attempt.total_score ?? 0}đ
                              </small>
                            </div>
                          ) : (
                            <div style={{ textAlign: 'center' }}>
                              <span className="score-val">{attempt.total_score ?? 0}</span>
                              <span className="score-denom">
                                /{Number(attempt.max_score ?? exam.total_points ?? 10)}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="comp-info">
                          <h4 className="comp-title">{exam.title || exam.name}</h4>
                          <div className="comp-subtext">
                            <span>
                              Nộp lúc:{' '}
                              {new Date(
                                attempt.submitted_at || attempt.updated_at || Date.now(),
                              ).toLocaleString('vi-VN')}
                            </span>
                            <span>•</span>
                            <span>
                              Thời gian làm:{' '}
                              {Math.max(
                                1,
                                Math.round(
                                  (new Date(attempt.submitted_at || Date.now()).getTime() -
                                    new Date(attempt.started_at).getTime()) /
                                    60000,
                                ),
                              )}{' '}
                              phút
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="comp-right">
                        <div className="comp-proctor-summary">
                          {!aiEnabled ? (
                            <span className="exam-badge exam-badge-blue">Không bật AI</span>
                          ) : vCount > 0 ? (
                            <span className="exam-badge exam-badge-orange">
                              <FiAlertCircle size={12} /> {vCount} cảnh báo AI
                            </span>
                          ) : (
                            <span className="exam-badge exam-badge-green">
                              <FiCheckCircle size={12} /> AI Proctoring: Hợp lệ
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          className="exam-btn exam-btn-outline"
                          onClick={() => navigate(`/exam/${exam.id}/result/${attempt.id}`)}
                        >
                          Xem biên nhận & kết quả
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="exam-section-block">
            <div className="section-title-row">
              <h3>
                <FiCalendar size={20} className="section-icon" /> Kỳ thi sắp diễn ra
              </h3>
              <span className="exam-count-tag">{upcomingExams.length} kỳ thi</span>
            </div>
            {upcomingExams.length === 0 ? (
              <div className="empty-sub-card">
                <FiInfo size={22} />
                <span>Không có kỳ thi sắp diễn ra.</span>
              </div>
            ) : (
              <div className="student-exam-cards-grid">
                {upcomingExams.map((exam) => (
                  <div key={exam.id} className="student-exam-card">
                    <div className="s-card-top">
                      <span className="exam-badge exam-badge-blue">Sắp diễn ra</span>
                      <span className="s-duration-badge">
                        <FiClock size={14} /> {exam.duration_minutes} phút
                      </span>
                    </div>
                    <h3 className="s-card-title">{exam.title || exam.name}</h3>
                    <p className="s-card-desc">{exam.description || 'Bài thi trực tuyến'}</p>
                    <div className="s-card-meta">
                      <div className="s-meta-item">
                        <FiCalendar size={14} />
                        <span>Bắt đầu: {new Date(exam.start_time).toLocaleString('vi-VN')}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {closedExams.length > 0 && (
            <div className="exam-section-block">
              <div className="section-title-row">
                <h3>
                  <FiAlertCircle size={20} className="section-icon" /> Kỳ thi đã đóng (Chưa tham gia)
                </h3>
                <span className="exam-count-tag">{closedExams.length} kỳ thi</span>
              </div>
              <div className="completed-exams-list">
                {closedExams.map((exam) => (
                  <div key={exam.id} className="completed-exam-row">
                    <div className="comp-left">
                      <div className="comp-score-box">
                        <span className="score-pending">Đã đóng</span>
                      </div>
                      <div className="comp-info">
                        <h4 className="comp-title">{exam.title || exam.name}</h4>
                        <div className="comp-subtext">
                          <span>Đã kết thúc: {new Date(exam.end_time).toLocaleString('vi-VN')}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
