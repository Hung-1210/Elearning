import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  FiArrowLeft,
  FiSearch,
  FiCheckCircle,
  FiXCircle,
  FiSave,
  FiShield,
  FiAlertTriangle,
  FiCode,
  FiFileText,
  FiUser,
  FiUsers,
  FiClock,
  FiAward,
  FiActivity,
} from 'react-icons/fi';
import { examApi, classApi } from '../../api';
import type { ClassInfo } from '../../types';
import Sidebar from '../../components/layout/Sidebar';
import { useLayoutStore } from '../../store/layoutStore';
import './exam.css';

interface GradingExamMeta {
  id: number;
  class_id: number;
  class_name: string;
  name: string;
  duration_minutes: number;
  result_visibility: string;
  allow_review: boolean;
  total_enrolled: number;
  max_score: number;
}

interface StudentSubmission {
  attempt_id: string;
  student_id: string;
  student_name: string;
  student_code: string;
  submitted_at: string;
  started_at?: string;
  submit_reason?: string;
  objective_score: number;
  essay_score: number;
  total_score: number;
  max_score: number;
  final_score: number | null;
  grading_status: 'auto_graded' | 'needs_manual' | 'graded';
  status: 'submitted' | 'graded';
  violations_count: number;
  review_verdict?: string | null;
  needs_manual_grading: boolean;
}

interface QuestionAnswerReview {
  question_id: string;
  question_content: string;
  explanation?: string | null;
  type: 'single_choice' | 'multiple_choice' | 'essay' | 'file_upload' | 'code';
  max_points: number;
  earned_points: number;
  is_graded?: boolean;
  student_answer_text?: string;
  file_path?: string | null;
  student_selected_options?: string[];
  options?: { id: string; content: string; is_correct: boolean }[];
  is_correct?: boolean | null;
  teacher_feedback?: string;
}

interface GradeAuditItem {
  id: number;
  exam_question_id: number;
  old_score: number | null;
  new_score: number;
  old_comment?: string | null;
  new_comment?: string | null;
  created_at: string;
  grader_name: string;
}

export const GradingResultsPage: React.FC = () => {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const { sidebarCollapsed } = useLayoutStore();

  const [allClasses, setAllClasses] = useState<ClassInfo[]>([]);
  const [examMeta, setExamMeta] = useState<GradingExamMeta | null>(null);
  const [submissions, setSubmissions] = useState<StudentSubmission[]>([]);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<QuestionAnswerReview[]>([]);
  const [auditLogs, setAuditLogs] = useState<GradeAuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'graded'>('all');
  const [savingGrade, setSavingGrade] = useState(false);
  const [saveBanner, setSaveBanner] = useState<string | null>(null);

  useEffect(() => {
    classApi.getAll().then((res) => setAllClasses(res.data.data || [])).catch(() => {});
  }, []);

  const loadAttemptReview = useCallback(async (attemptId: string) => {
    setLoadingDetail(true);
    try {
      const res = await examApi.getAttemptReview(attemptId);
      const data = res.data?.data;
      setAnswers(data?.answers || []);
      setAuditLogs(data?.audit_logs || []);
    } catch (err) {
      console.error('Lỗi tải bài làm sinh viên:', err);
      setAnswers([]);
      setAuditLogs([]);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const loadSubmissions = useCallback(
    async (keepAttemptId?: string | null) => {
      if (!examId) return;
      setLoading(true);
      try {
        const res = await examApi.getSubmissions(examId);
        const data = res.data?.data;
        const list: StudentSubmission[] = data?.submissions || [];
        setExamMeta(data?.exam || null);
        setSubmissions(list);

        const nextSelected =
          keepAttemptId && list.some((s) => s.attempt_id === keepAttemptId)
            ? keepAttemptId
            : list[0]?.attempt_id ?? null;

        setSelectedAttemptId(nextSelected);
        if (nextSelected) {
          await loadAttemptReview(nextSelected);
        } else {
          setAnswers([]);
          setAuditLogs([]);
        }
      } catch (err) {
        console.error('Lỗi tải danh sách bài nộp:', err);
        setSubmissions([]);
        setSelectedAttemptId(null);
      } finally {
        setLoading(false);
      }
    },
    [examId, loadAttemptReview],
  );

  useEffect(() => {
    void loadSubmissions(null);
  }, [loadSubmissions]);

  const handleSelectSubmission = (attId: string) => {
    setSelectedAttemptId(attId);
    void loadAttemptReview(attId);
  };

  const handleSaveGrade = async () => {
    if (!selectedAttemptId) return;
    for (let i = 0; i < answers.length; i += 1) {
      const ans = answers[i];
      if (!Number.isFinite(ans.earned_points) || ans.earned_points < 0 || ans.earned_points > ans.max_points) {
        alert(`Điểm Câu ${i + 1} phải nằm trong khoảng 0 đến ${ans.max_points} điểm.`);
        return;
      }
    }
    setSavingGrade(true);
    try {
      await examApi.gradeAttempt(selectedAttemptId, {
        grades: answers.map((a) => ({
          question_id: a.question_id,
          points: Number(a.earned_points),
          feedback: a.teacher_feedback,
        })),
      });
      setSaveBanner('Đã lưu điểm chấm bài và ghi nhật ký kiểm toán thành công.');
      window.setTimeout(() => setSaveBanner(null), 3500);
      await loadSubmissions(selectedAttemptId);
    } catch (err: any) {
      alert(err.response?.data?.error || err.response?.data?.message || 'Không thể lưu điểm.');
    } finally {
      setSavingGrade(false);
    }
  };

  const selectedSubmission = submissions.find((s) => s.attempt_id === selectedAttemptId) ?? null;

  const filteredSubmissions = useMemo(() => {
    return submissions.filter((s) => {
      if (statusFilter === 'pending' && !s.needs_manual_grading) return false;
      if (statusFilter === 'graded' && s.needs_manual_grading) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          s.student_name.toLowerCase().includes(q) ||
          (s.student_code || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [submissions, statusFilter, searchQuery]);

  // 4 chỉ số thống kê thật đầu trang (image8.png)
  const pendingManualCount = submissions.filter((s) => s.needs_manual_grading).length;
  const gradedDoneCount = submissions.length - pendingManualCount;
  const averageScore =
    submissions.length > 0
      ? (
          submissions.reduce((acc, s) => acc + Number(s.total_score ?? 0), 0) / submissions.length
        ).toFixed(2)
      : '--';

  // Điểm nháp tức thời khi giảng viên đang gõ điểm trên form
  const liveObjectiveScore = useMemo(
    () =>
      answers
        .filter((a) => a.type === 'single_choice' || a.type === 'multiple_choice')
        .reduce((acc, a) => acc + Number(a.earned_points || 0), 0),
    [answers],
  );
  const liveManualScore = useMemo(
    () =>
      answers
        .filter((a) => a.type !== 'single_choice' && a.type !== 'multiple_choice')
        .reduce((acc, a) => acc + Number(a.earned_points || 0), 0),
    [answers],
  );
  const liveTotalScore = Math.round((liveObjectiveScore + liveManualScore) * 100) / 100;

  return (
    <div className="exam-layout-wrapper">
      <Sidebar classes={allClasses} currentClassId={examMeta?.class_id ? Number(examMeta.class_id) : undefined} />
      <div className={`exam-main-panel ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        {/* Top Breadcrumb Bar */}
        <header className="page-header" style={{ padding: '16px 32px' }}>
          <div className="page-header-left">
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => navigate(-1)}>
              <FiArrowLeft size={16} />
            </button>
            <div className="page-header-breadcrumb">
              <span className="breadcrumb-link" onClick={() => navigate('/')}>Tổng quan</span>
              <span style={{ color: '#94A3B8' }}>/</span>
              <span
                className="breadcrumb-link"
                onClick={() => examMeta?.class_id && navigate(`/class/${examMeta.class_id}?tab=exams`)}
              >
                {examMeta?.class_name || 'Lớp học'}
              </span>
              <span style={{ color: '#94A3B8' }}>/</span>
              <span>Chấm thi & Kết quả</span>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <span className="badge badge-neutral">● {examMeta?.total_enrolled ?? 0} học viên</span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => navigate(`/exam/${examId}/violations`)}
            >
              <FiShield size={14} /> Nhật ký AI
            </button>
          </div>
        </header>

        <div className="exam-page-content" style={{ maxWidth: '100%' }}>
          {saveBanner && (
            <div className="monitor-toast-banner">
              <FiCheckCircle size={16} />
              <span>{saveBanner}</span>
            </div>
          )}

          {/* Top Header */}
          <div className="grading-top-bar">
            <div className="grading-top-left">
              <div>
                <h2>Chấm thi & Đánh giá bài làm: {examMeta?.name || 'Đề thi'}</h2>
                <span className="sub-title-text">
                  Tự động chấm câu hỏi trắc nghiệm • Hỗ trợ chấm tự luận / tệp đính kèm có lưu vết kiểm toán (Audit Log)
                </span>
              </div>
            </div>

            <div className="grading-top-actions">
              <button
                type="button"
                className="exam-btn exam-btn-primary"
                onClick={() => void handleSaveGrade()}
                disabled={savingGrade || !selectedSubmission}
              >
                <FiSave size={16} /> {savingGrade ? 'Đang lưu...' : 'Lưu kết quả chấm thi'}
              </button>
            </div>
          </div>

          {/* 4 Top Stat Cards (Matching image8.png) */}
          <div className="exam-stats-row">
            <div className="stat-box-card">
              <div className="stat-box-left">
                <span className="stat-box-label">ĐÃ NỘP BÀI</span>
                <div className="stat-box-val-row">
                  <span className="stat-box-number">{submissions.length}</span>
                  <span className="stat-sub-text">/ {examMeta?.total_enrolled ?? 0} sĩ số</span>
                </div>
              </div>
              <div className="stat-icon-wrapper purple-bg">
                <FiUsers size={22} />
              </div>
            </div>

            <div className="stat-box-card">
              <div className="stat-box-left">
                <span className="stat-box-label">ĐÃ CHẤM XONG</span>
                <div className="stat-box-val-row">
                  <span className="stat-box-number" style={{ color: '#059669' }}>
                    {gradedDoneCount}
                  </span>
                  <span className="stat-sub-badge">Hoàn tất</span>
                </div>
              </div>
              <div className="stat-icon-wrapper green-bg">
                <FiCheckCircle size={22} />
              </div>
            </div>

            <div className="stat-box-card">
              <div className="stat-box-left">
                <span className="stat-box-label">CHỜ CHẤM TỰ LUẬN</span>
                <div className="stat-box-val-row">
                  <span className="stat-box-number text-red">{pendingManualCount}</span>
                  <span className="stat-sub-text">bài cần duyệt</span>
                </div>
              </div>
              <div className="stat-icon-wrapper red-bg">
                <FiClock size={22} />
              </div>
            </div>

            <div className="stat-box-card">
              <div className="stat-box-left">
                <span className="stat-box-label">ĐIỂM TRUNG BÌNH</span>
                <div className="stat-box-val-row">
                  <span className="stat-box-number text-blue">{averageScore}</span>
                  <span className="stat-sub-text">/ {Number(examMeta?.max_score ?? 10)}đ</span>
                </div>
              </div>
              <div className="stat-icon-wrapper blue-ring">
                <FiAward size={22} />
              </div>
            </div>
          </div>

          {/* Main Split View: Left Submissions List + Right Grading Canvas */}
          <div className="grading-split-container">
            {/* Left Submissions List (Matching image8.png left pane) */}
            <div className="submissions-sidebar">
              <div className="sidebar-search-box">
                <FiSearch />
                <input
                  type="text"
                  placeholder="Tìm tên hoặc mã SV..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: 4, padding: '8px 10px', borderBottom: '1px solid #E2E8F0' }}>
                <button
                  type="button"
                  className={`filter-btn ${statusFilter === 'all' ? 'active' : ''}`}
                  style={{ padding: '4px 10px', fontSize: 12 }}
                  onClick={() => setStatusFilter('all')}
                >
                  Tất cả ({submissions.length})
                </button>
                <button
                  type="button"
                  className={`filter-btn ${statusFilter === 'pending' ? 'active' : ''}`}
                  style={{ padding: '4px 10px', fontSize: 12 }}
                  onClick={() => setStatusFilter('pending')}
                >
                  Chờ chấm ({pendingManualCount})
                </button>
                <button
                  type="button"
                  className={`filter-btn ${statusFilter === 'graded' ? 'active' : ''}`}
                  style={{ padding: '4px 10px', fontSize: 12 }}
                  onClick={() => setStatusFilter('graded')}
                >
                  Đã chấm ({gradedDoneCount})
                </button>
              </div>

              <div className="submissions-list-scroll">
                {loading ? (
                  <div className="exam-loading-state" style={{ minHeight: 180 }}>
                    <div className="spinner" />
                    <p>Đang tải bài nộp...</p>
                  </div>
                ) : filteredSubmissions.length === 0 ? (
                  <div className="exam-empty-state" style={{ minHeight: 200, border: 'none' }}>
                    <FiFileText size={24} />
                    <span>Chưa có bài nộp nào trong mục này.</span>
                  </div>
                ) : (
                  filteredSubmissions.map((sub) => {
                    const isSelected = sub.attempt_id === selectedAttemptId;
                    return (
                      <div
                        key={sub.attempt_id}
                        className={`submission-card-item ${isSelected ? 'active' : ''}`}
                        onClick={() => handleSelectSubmission(sub.attempt_id)}
                      >
                        <div className="sub-card-top">
                          <div className="student-basic-info">
                            <span className="student-name">{sub.student_name}</span>
                            <span className="student-code">
                              {sub.student_code || `SV #${sub.student_id}`}
                            </span>
                          </div>

                          <div className="sub-score-pill">
                            <span className="score-main">
                              {sub.total_score}/{sub.max_score}đ
                            </span>
                          </div>
                        </div>

                        <div className="sub-card-bottom">
                          {sub.needs_manual_grading ? (
                            <span className="tag-warning">● Chờ chấm tự luận</span>
                          ) : (
                            <span className="tag-success">✓ Đã chấm xong</span>
                          )}

                          {sub.violations_count > 0 && (
                            <span className="tag-ai-violation">
                              <FiAlertTriangle size={12} /> {sub.violations_count} cảnh báo AI
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Grading Details Canvas (Matching image8.png right pane) */}
            <div className="grading-details-canvas">
              {!selectedSubmission ? (
                <div className="exam-empty-state">
                  <FiFileText size={32} />
                  <h3>Chọn một bài nộp ở danh sách bên trái</h3>
                  <p>Chi tiết đáp án của sinh viên và khung chấm tự luận sẽ hiển thị tại đây.</p>
                </div>
              ) : loadingDetail ? (
                <div className="exam-loading-state">
                  <div className="spinner" />
                  <p>Đang tải chi tiết bài làm...</p>
                </div>
              ) : (
                <>
                  {/* Student Summary Banner */}
                  <div className="candidate-review-header-card" style={{ flexWrap: 'wrap', gap: 14 }}>
                    <div className="c-info-col">
                      <div className="c-avatar-wrap">
                        <FiUser size={24} />
                      </div>
                      <div>
                        <h3>{selectedSubmission.student_name}</h3>
                        <p className="c-meta-line">
                          Mã SV: <strong>{selectedSubmission.student_code || '--'}</strong> • Nộp lúc:{' '}
                          {selectedSubmission.submitted_at
                            ? new Date(selectedSubmission.submitted_at).toLocaleString('vi-VN')
                            : '--'}
                          {selectedSubmission.submit_reason && selectedSubmission.submit_reason !== 'manual' && (
                            <> • Hình thức nộp: <strong>{selectedSubmission.submit_reason}</strong></>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="c-score-summary-col" style={{ flexWrap: 'wrap' }}>
                      <div className="score-summary-pill">
                        <span className="lbl">Trắc nghiệm</span>
                        <span className="val">{Math.round(liveObjectiveScore * 100) / 100}đ</span>
                      </div>
                      <div className="score-summary-pill">
                        <span className="lbl">Tự luận / Tệp</span>
                        <span className="val">{Math.round(liveManualScore * 100) / 100}đ</span>
                      </div>
                      <div className="score-summary-pill total">
                        <span className="lbl">Tổng điểm</span>
                        <span className="val">
                          {liveTotalScore}/{selectedSubmission.max_score}đ
                        </span>
                      </div>

                      {selectedSubmission.violations_count > 0 && (
                        <button
                          type="button"
                          className="exam-btn exam-btn-danger"
                          onClick={() => navigate(`/exam/${examId}/violations`)}
                        >
                          <FiShield size={15} /> {selectedSubmission.violations_count} cảnh báo AI
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Questions List Review */}
                  <div className="questions-grading-list">
                    {answers.map((ans, idx) => {
                      const isObjective =
                        ans.type === 'single_choice' || ans.type === 'multiple_choice';
                      const typeLabel =
                        ans.type === 'single_choice'
                          ? 'Trắc nghiệm 1 đáp án'
                          : ans.type === 'multiple_choice'
                            ? 'Trắc nghiệm nhiều đáp án'
                            : ans.type === 'file_upload'
                              ? 'Nộp tệp / Bài tập'
                              : ans.type === 'code'
                                ? 'Lập trình'
                                : 'Tự luận';

                      return (
                        <div key={ans.question_id} className="grading-question-item">
                          <div className="g-item-header">
                            <div className="g-left-title">
                              <span className="g-q-num">Câu {idx + 1}</span>
                              <span className="exam-badge exam-badge-blue">{typeLabel}</span>
                              {!isObjective && !ans.is_graded && (
                                <span className="status-pill-badge badge-orange">Chưa chấm</span>
                              )}
                            </div>

                            <div className="g-right-score">
                              <label>Điểm đạt được:</label>
                              <input
                                type="number"
                                step="0.25"
                                min={0}
                                max={ans.max_points}
                                value={ans.earned_points}
                                onChange={(e) => {
                                  const raw = Number(e.target.value);
                                  const clamped = Number.isFinite(raw)
                                    ? Math.min(ans.max_points, Math.max(0, raw))
                                    : 0;
                                  setAnswers((prev) =>
                                    prev.map((item, i) =>
                                      i === idx ? { ...item, earned_points: clamped } : item,
                                    ),
                                  );
                                }}
                              />
                              <span className="max-pts">/ {ans.max_points}đ</span>
                            </div>
                          </div>

                          <div className="g-item-content">
                            <p className="q-content-text" style={{ fontWeight: 600, color: '#0F172A' }}>
                              {ans.question_content}
                            </p>
                          </div>

                          {/* Choices Review */}
                          {ans.options && ans.options.length > 0 && (
                            <div className="g-options-list">
                              {ans.options.map((opt) => {
                                const isStudentSelected = ans.student_selected_options?.includes(opt.id);
                                const isCorrect = opt.is_correct;

                                let optClass = 'opt-row';
                                if (isCorrect) optClass += ' correct-opt';
                                if (isStudentSelected && !isCorrect) optClass += ' student-wrong-opt';

                                return (
                                  <div key={opt.id} className={optClass}>
                                    <div className="opt-marker">
                                      {isCorrect ? (
                                        <FiCheckCircle color="#059669" />
                                      ) : isStudentSelected ? (
                                        <FiXCircle color="#DC2626" />
                                      ) : (
                                        <div className="circle-dot" />
                                      )}
                                    </div>
                                    <span className="opt-text">{opt.content}</span>
                                    {isStudentSelected && (
                                      <span className="student-picked-tag">Sinh viên chọn</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Essay / File / Code Answer Preview */}
                          {!isObjective && (
                            <div className="g-essay-block">
                              <label className="block-label">
                                {ans.type === 'code' ? (
                                  <>
                                    <FiCode /> Bài lập trình của sinh viên:
                                  </>
                                ) : (
                                  <>
                                    <FiFileText /> Nội dung trả lời của sinh viên:
                                  </>
                                )}
                              </label>
                              <div
                                className={`student-submission-box ${
                                  ans.type === 'code' ? 'code-font' : ''
                                }`}
                              >
                                <pre>
                                  {ans.student_answer_text?.trim()
                                    ? ans.student_answer_text
                                    : ans.file_path
                                      ? `Tệp đính kèm: ${ans.file_path}`
                                      : '(Sinh viên bỏ trống câu hỏi này)'}
                                </pre>
                              </div>

                              {ans.explanation && (
                                <div className="rubric-hint-box">
                                  <strong>Đáp án mẫu / Rubric chấm điểm:</strong> {ans.explanation}
                                </div>
                              )}
                            </div>
                          )}

                          <div className="teacher-grading-controls" style={{ marginTop: 12 }}>
                            <label className="block-label">Nhận xét của giảng viên:</label>
                            <textarea
                              rows={2}
                              placeholder="Nhập ghi chú hoặc giải thích điểm số cho sinh viên..."
                              value={ans.teacher_feedback || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setAnswers((prev) =>
                                  prev.map((item, i) =>
                                    i === idx ? { ...item, teacher_feedback: val } : item,
                                  ),
                                );
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Audit Log Card */}
                  {auditLogs.length > 0 && (
                    <div className="exam-card">
                      <h4 className="card-subhead">
                        <FiActivity className="subhead-icon" /> Lịch sử chấm & điều chỉnh điểm (Audit Log)
                      </h4>
                      <div className="audit-log-list">
                        {auditLogs.map((log) => (
                          <div key={log.id} className="audit-log-row">
                            <div>
                              <strong>{log.grader_name}</strong> đã cập nhật Câu #{log.exam_question_id}:{' '}
                              <span className="audit-diff">
                                {log.old_score !== null ? `${log.old_score}đ` : 'Chưa chấm'} →{' '}
                                <strong>{log.new_score}đ</strong>
                              </span>
                              {log.new_comment && (
                                <span className="audit-comment"> • “{log.new_comment}”</span>
                              )}
                            </div>
                            <small>{new Date(log.created_at).toLocaleString('vi-VN')}</small>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="exam-btn exam-btn-primary"
                      onClick={() => void handleSaveGrade()}
                      disabled={savingGrade}
                    >
                      <FiSave size={16} /> {savingGrade ? 'Đang lưu...' : 'Lưu toàn bộ kết quả chấm'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
