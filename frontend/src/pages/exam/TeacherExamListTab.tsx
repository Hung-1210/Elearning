import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiPlus,
  FiClock,
  FiCalendar,
  FiShield,
  FiVideo,
  FiAlertTriangle,
  FiTrash2,
  FiFileText,
  FiBarChart2,
  FiSearch,
  FiCheckCircle,
  FiMoreVertical,
  FiExternalLink,
  FiPlay,
  FiCopy,
  FiEdit,
  FiLayers,
  FiLock,
} from 'react-icons/fi';
import { examApi } from '../../api';
import type { Exam } from '../../types';
import { toLocalDatetimeInputValue } from './examUtils';
import './exam.css';

interface TeacherExamListTabProps {
  classId: string;
}

export const TeacherExamListTab: React.FC<TeacherExamListTabProps> = ({ classId }) => {
  const navigate = useNavigate();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [openMenuId, setOpenMenuId] = useState<string | number | null>(null);
  const [noticeBanner, setNoticeBanner] = useState<{
    text: string;
    tone: 'success' | 'error';
  } | null>(null);
  const [reopenTarget, setReopenTarget] = useState<Exam | null>(null);
  const [reopenEndTime, setReopenEndTime] = useState<string>('');
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [reopenSaving, setReopenSaving] = useState<boolean>(false);
  const [aiGuardStatus, setAiGuardStatus] = useState<{
    ready: boolean;
    p50Ms: number | null;
    reason?: string;
  }>({ ready: false, p50Ms: null });

  useEffect(() => {
    void loadExams();
    examApi
      .getAiStatus()
      .then((res) => {
        const d = res.data?.data;
        const ready = Boolean(d?.readiness?.ready);
        const p50 = d?.readiness?.payload?.latency_ms?.p50;
        setAiGuardStatus({
          ready,
          p50Ms: typeof p50 === 'number' ? Math.round(p50) : null,
          reason: d?.readiness?.reason,
        });
      })
      .catch(() => {
        setAiGuardStatus({ ready: false, p50Ms: null, reason: 'Không kết nối được AI Service' });
      });
  }, [classId]);

  const loadExams = async () => {
    setLoading(true);
    try {
      const res = await examApi.getByClass(classId);
      const payload = res.data.data;
      const list = Array.isArray(payload) ? payload : payload?.exams ?? res.data.exams ?? [];
      setExams(list);
    } catch (error) {
      console.error(error);
      setExams([]);
    } finally {
      setLoading(false);
    }
  };

  const showNotice = (text: string, tone: 'success' | 'error' = 'success') => {
    setNoticeBanner({ text, tone });
    window.setTimeout(() => {
      setNoticeBanner((cur) => (cur?.text === text ? null : cur));
    }, 4500);
  };

  const handleDelete = async (id: string | number, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenMenuId(null);
    if (window.confirm('Bạn có chắc chắn muốn xóa kỳ thi này không?')) {
      try {
        await examApi.delete(id);
        setExams((current) => current.filter((ex) => String(ex.id) !== String(id)));
        showNotice('Đã xóa đề thi khỏi danh sách lớp.', 'success');
      } catch (err: any) {
        showNotice(
          err.response?.data?.error || err.response?.data?.message || 'Không thể xóa kỳ thi.',
          'error',
        );
      }
    }
  };

  const handleClose = async (exam: Exam, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenMenuId(null);
    if (!window.confirm('Đóng đề thi ngay? Học viên sẽ không thể bắt đầu lượt làm mới.')) return;
    try {
      const res = await examApi.close(exam.id);
      setExams((current) =>
        current.map((item) => (String(item.id) === String(exam.id) ? res.data.data : item)),
      );
      showNotice('Đã đóng đề thi thành công.', 'success');
    } catch (err: any) {
      showNotice(
        err.response?.data?.error || err.response?.data?.message || 'Không thể đóng đề thi.',
        'error',
      );
    }
  };

  const handleReopen = (exam: Exam, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenMenuId(null);
    setReopenTarget(exam);
    setReopenError(null);
    setReopenEndTime(toLocalDatetimeInputValue(new Date(Date.now() + 60 * 60 * 1000)));
  };

  const handleConfirmReopen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenTarget || reopenSaving) return;
    setReopenError(null);

    const endTime = new Date(reopenEndTime);
    if (!reopenEndTime || Number.isNaN(endTime.getTime()) || endTime <= new Date()) {
      setReopenError('Thời gian kết thúc mới phải là một thời điểm hợp lệ trong tương lai.');
      return;
    }
    const startTime = new Date(reopenTarget.start_time);
    if (endTime <= startTime) {
      setReopenError('Thời gian kết thúc mới phải sau thời gian bắt đầu của đề thi.');
      return;
    }

    setReopenSaving(true);
    try {
      const res = await examApi.update(reopenTarget.id, {
        endTime: endTime.toISOString(),
      } as Partial<Exam>);
      setExams((current) =>
        current.map((item) => (String(item.id) === String(reopenTarget.id) ? res.data.data : item)),
      );
      setReopenTarget(null);
      showNotice(`Đã mở lại đề thi "${reopenTarget.title || reopenTarget.name}".`, 'success');
    } catch (err: any) {
      setReopenError(
        err.response?.data?.error || err.response?.data?.message || 'Không thể mở lại đề thi.',
      );
    } finally {
      setReopenSaving(false);
    }
  };

  const now = new Date();
  const getExamDisplayStatus = (exam: Exam) => {
    if (exam.status === 'draft') return 'draft';
    const s = new Date(exam.start_time);
    const e = new Date(exam.end_time);
    if (now < s) return 'upcoming';
    if (now > e) return 'ended';
    return 'in_progress';
  };

  const renderExamMenu = (exam: Exam) => (
    <div className="exam-actions-menu-wrap">
      <button
        type="button"
        className="btn-icon-square"
        title="Tùy chọn đề thi"
        aria-label={`Tùy chọn đề thi ${exam.title || exam.name || exam.id}`}
        aria-expanded={openMenuId === exam.id}
        onClick={(e) => {
          e.stopPropagation();
          setOpenMenuId((current) => (current === exam.id ? null : exam.id));
        }}
      >
        <FiMoreVertical size={16} />
      </button>
      {openMenuId === exam.id && (
        <div className="exam-actions-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="exam-actions-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              setOpenMenuId(null);
              navigate(`/class/${classId}/exam/create?duplicateFrom=${exam.id}`);
            }}
          >
            <FiCopy size={15} /> Nhân bản đề thi
          </button>
          {getExamDisplayStatus(exam) === 'ended' && (
            <button
              type="button"
              role="menuitem"
              className="exam-actions-menu-item"
              onClick={(e) => void handleReopen(exam, e)}
            >
              <FiPlay size={15} /> Mở lại đề thi
            </button>
          )}
          {exam.status !== 'draft' && getExamDisplayStatus(exam) !== 'ended' && (
            <button
              type="button"
              role="menuitem"
              className="exam-actions-menu-item"
              onClick={(e) => void handleClose(exam, e)}
            >
              <FiLock size={15} /> Đóng đề thi
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="exam-actions-menu-item danger"
            onClick={(e) => void handleDelete(exam.id, e)}
          >
            <FiTrash2 size={15} /> Xóa đề thi
          </button>
        </div>
      )}
    </div>
  );

  const filteredExams = exams.filter((ex) => {
    const statusKey = getExamDisplayStatus(ex);
    if (filterStatus === 'in_progress' && statusKey !== 'in_progress') return false;
    if (filterStatus === 'upcoming' && statusKey !== 'upcoming') return false;
    if (filterStatus === 'ended' && statusKey !== 'ended') return false;
    if (filterStatus === 'draft' && statusKey !== 'draft') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const title = (ex.title || ex.name || '').toLowerCase();
      const desc = (ex.description || '').toLowerCase();
      return title.includes(q) || desc.includes(q) || String(ex.id).includes(q);
    }
    return true;
  });

  const openCount = exams.filter((ex) => getExamDisplayStatus(ex) === 'in_progress').length;
  const upcomingCount = exams.filter((ex) => getExamDisplayStatus(ex) === 'upcoming').length;
  const endedCount = exams.filter((ex) => getExamDisplayStatus(ex) === 'ended').length;
  const draftCount = exams.filter((ex) => getExamDisplayStatus(ex) === 'draft').length;
  const publishedExams = exams.filter((ex) => ex.status !== 'draft');
  const totalExpectedSubmissions = publishedExams.reduce(
    (sum, exam) => sum + Number(exam.total_students || 0),
    0,
  );
  const submittedCount = publishedExams.reduce(
    (sum, exam) => sum + Number(exam.submitted_count || 0),
    0,
  );
  const violationCount = exams.reduce(
    (sum, exam) => sum + Number(exam.violation_count || 0),
    0,
  );
  const completionRate =
    totalExpectedSubmissions > 0
      ? Math.min(100, Math.round((submittedCount / totalExpectedSubmissions) * 100))
      : 0;

  return (
    <div className="exam-page-content" style={{ padding: '16px 0 36px' }}>
      {noticeBanner && (
        <div
          className={noticeBanner.tone === 'error' ? 'exam-error-banner' : 'monitor-toast-banner'}
          role="status"
          style={{ marginBottom: 16 }}
        >
          {noticeBanner.tone === 'error' ? (
            <FiAlertTriangle size={16} />
          ) : (
            <FiCheckCircle size={16} />
          )}
          <span>{noticeBanner.text}</span>
        </div>
      )}

      {/* ── Top Header Row (Matching image6.png) ── */}
      <div className="exam-header-row">
        <div className="exam-header-titles">
          <h2>
            Đề thi & Đánh giá
            <span className="term-badge">Dữ liệu thời gian thực</span>
          </h2>
          <p>
            Quản trị bài kiểm tra định kỳ, đề thi trực tuyến có giám sát thông minh AI cho lớp học
          </p>
        </div>

        <div className="header-action-group">
          <button
            type="button"
            className="btn-secondary-exam"
            onClick={() => navigate(`/class/${classId}?tab=question-bank`)}
          >
            <FiLayers size={16} /> Ngân hàng đề
          </button>
          <button
            type="button"
            className="btn-primary-exam"
            onClick={() => navigate(`/class/${classId}/exam/create`)}
          >
            <FiPlus size={16} /> Tạo đề thi mới
          </button>
        </div>
      </div>

      {/* ── 4 Top Stat Cards (Matching image6.png) ── */}
      <div className="exam-stats-row">
        <div className="stat-box-card">
          <div className="stat-box-left">
            <span className="stat-box-label">Tổng số đề thi</span>
            <div className="stat-box-val-row">
              <span className="stat-box-number">{exams.length}</span>
              <span className="stat-sub-badge">đề trong lớp</span>
            </div>
          </div>
          <div className="stat-icon-wrapper purple-bg">
            <FiFileText size={22} />
          </div>
        </div>

        <div className="stat-box-card">
          <div className="stat-box-left">
            <span className="stat-box-label">Đang diễn ra</span>
            <div className="stat-box-val-row">
              <span className="stat-box-number text-blue">{openCount}</span>
              {openCount > 0 && <span className="green-dot-online" />}
            </div>
          </div>
          <div className="stat-icon-wrapper green-bg">
            <FiPlay size={20} />
          </div>
        </div>

        <div className="stat-box-card">
          <div className="stat-box-left">
            <span className="stat-box-label">Cảnh báo vi phạm AI</span>
            <div className="stat-box-val-row">
              <span className="stat-box-number text-red">{violationCount}</span>
              <span className="stat-alert-tag">
                {violationCount > 0 ? 'Cần hậu kiểm' : 'Không có'}
              </span>
            </div>
          </div>
          <div className="stat-icon-wrapper red-bg">
            <FiAlertTriangle size={22} />
          </div>
        </div>

        <div className="stat-box-card">
          <div className="stat-box-left">
            <span className="stat-box-label">Tỉ lệ hoàn thành</span>
            <div className="stat-box-val-row">
              <span className="stat-box-number">{completionRate}%</span>
              <span className="stat-sub-text">
                {submittedCount}/{totalExpectedSubmissions} lượt nộp
              </span>
            </div>
          </div>
          <div className="stat-icon-wrapper blue-ring">
            <FiCheckCircle size={22} />
          </div>
        </div>
      </div>

      {/* ── Filter & Search Toolbar (Matching image6.png) ── */}
      <div className="exam-filter-toolbar">
        <div className="exam-search-input-wrap">
          <FiSearch size={16} />
          <input
            type="text"
            placeholder="Tìm kiếm theo tên đề thi, mã đề hoặc mô tả..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="filter-pills-list">
          <button
            type="button"
            className={`filter-pill-item ${filterStatus === 'all' ? 'active' : ''}`}
            onClick={() => setFilterStatus('all')}
          >
            Tất cả ({exams.length})
          </button>
          <button
            type="button"
            className={`filter-pill-item ${filterStatus === 'in_progress' ? 'active' : ''}`}
            onClick={() => setFilterStatus('in_progress')}
          >
            Đang mở ({openCount})
          </button>
          <button
            type="button"
            className={`filter-pill-item ${filterStatus === 'upcoming' ? 'active' : ''}`}
            onClick={() => setFilterStatus('upcoming')}
          >
            Sắp diễn ra ({upcomingCount})
          </button>
          <button
            type="button"
            className={`filter-pill-item ${filterStatus === 'ended' ? 'active' : ''}`}
            onClick={() => setFilterStatus('ended')}
          >
            Đã kết thúc ({endedCount})
          </button>
          <button
            type="button"
            className={`filter-pill-item ${filterStatus === 'draft' ? 'active' : ''}`}
            onClick={() => setFilterStatus('draft')}
          >
            Nháp ({draftCount})
          </button>
        </div>
      </div>

      {/* ── Exam Cards Stack (Matching image6.png) ── */}
      {loading ? (
        <div className="exam-loading-state">
          <div className="spinner" />
          <p>Đang tải danh sách đề thi...</p>
        </div>
      ) : filteredExams.length === 0 ? (
        <div className="exam-empty-state" style={{ marginBottom: 24 }}>
          <FiFileText size={30} />
          <h3>Chưa có đề thi nào khớp bộ lọc</h3>
          <p>Nhấn "Tạo đề thi mới" để thiết lập bài kiểm tra và cấu hình giám sát AI.</p>
        </div>
      ) : (
        <div className="exam-cards-stack">
          {filteredExams.map((exam) => {
            let cardType: 'open' | 'scheduled' | 'closed' | 'draft' = 'open';
            const dStatus = (exam.display_status || '') as string;
            if (dStatus === 'draft' || exam.status === 'draft') {
              cardType = 'draft';
            } else if (dStatus === 'closed' || dStatus === 'ended') {
              cardType = 'closed';
            } else if (dStatus === 'scheduled' || dStatus === 'upcoming') {
              cardType = 'scheduled';
            } else if (dStatus === 'open' || dStatus === 'in_progress') {
              cardType = 'open';
            } else {
              const key = getExamDisplayStatus(exam);
              cardType =
                key === 'in_progress'
                  ? 'open'
                  : key === 'upcoming'
                    ? 'scheduled'
                    : key === 'ended'
                      ? 'closed'
                      : 'draft';
            }

            const isOpen = cardType === 'open';
            const isScheduled = cardType === 'scheduled';
            const isClosed = cardType === 'closed';
            const isDraft = cardType === 'draft';
            const aiOn = exam.proctoring_enabled !== false;
            const subCnt = Number(exam.submitted_count || 0);
            const totStu = Number(exam.total_students || 0);
            const subPct = totStu > 0 ? Math.min(100, Math.round((subCnt / totStu) * 100)) : 0;

            return (
              <div key={exam.id} className="exam-item-card">
                <div className="exam-card-main-content">
                  <div className="exam-card-left-info">
                    <div className="exam-type-icon-box">
                      {isOpen && <FiShield size={22} />}
                      {isScheduled && <FiFileText size={22} />}
                      {isClosed && <FiCheckCircle size={22} />}
                      {isDraft && <FiEdit size={22} />}
                    </div>

                    <div className="exam-card-details">
                      <div className="exam-card-title-row">
                        <h3 className="exam-name-text">{exam.title || exam.name}</h3>
                      </div>

                      <div className="exam-badges-row">
                        {isOpen && (
                          <>
                            <span className="status-badge-green">● Đang mở</span>
                            {aiOn ? (
                              <span className="ai-active-badge">
                                <FiShield size={12} /> AI Giám sát đang bật
                              </span>
                            ) : (
                              <span className="status-badge-gray">Không bật Camera AI</span>
                            )}
                            {Number(exam.violation_count || 0) > 0 && (
                              <span className="warning-anomaly-badge">
                                ⚠ {exam.violation_count} cảnh báo AI
                              </span>
                            )}
                          </>
                        )}
                        {isScheduled && (
                          <>
                            <span className="status-badge-blue">Sắp diễn ra</span>
                            {aiOn ? (
                              <span className="ai-active-badge">
                                <FiShield size={12} /> AI Giám sát đang bật
                              </span>
                            ) : (
                              <span className="status-badge-gray">Không bật Camera AI</span>
                            )}
                          </>
                        )}
                        {isClosed && (
                          <>
                            <span className="status-badge-gray">Đã đóng</span>
                            <span className="status-badge-green">
                              {subCnt}/{totStu} đã nộp bài ({subPct}%)
                            </span>
                            {Number(exam.violation_count || 0) > 0 && (
                              <span className="warning-anomaly-badge">
                                ⚠ {exam.violation_count} cảnh báo AI
                              </span>
                            )}
                          </>
                        )}
                        {isDraft && <span className="status-badge-gray">Bản nháp</span>}
                      </div>

                      <div className="exam-meta-specs">
                        <div className="meta-spec-item">
                          <FiCalendar size={13} />
                          <span>
                            {isDraft
                              ? `Cập nhật: ${
                                  exam.updated_at
                                    ? new Date(exam.updated_at).toLocaleString('vi-VN')
                                    : 'Vừa tạo'
                                }`
                              : `${new Date(exam.start_time).toLocaleString('vi-VN')} - ${new Date(
                                  exam.end_time,
                                ).toLocaleString('vi-VN')}`}
                          </span>
                        </div>
                        <div className="meta-spec-item">
                          <FiClock size={13} />
                          <span>Thời lượng: {exam.duration_minutes || 60} phút</span>
                        </div>
                        <div className="meta-spec-item">
                          <FiFileText size={13} />
                          <span>
                            {exam.total_questions ?? exam.questions?.length ?? 0} câu hỏi (
                            {Number(exam.total_points ?? 0)} điểm)
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right actions */}
                  <div className="exam-card-right-actions">
                    {isOpen && (
                      <>
                        <div className="progress-students-info">
                          <span className="progress-text-label">
                            Tiến độ nộp bài: {subCnt} / {totStu} học viên
                          </span>
                          <div className="progress-bar-track">
                            <div
                              className="progress-bar-fill-green"
                              style={{ width: `${subPct}%` }}
                            />
                          </div>
                          <span className="live-students-count">
                            ● {exam.in_progress_count || 0} đang làm bài trực tuyến
                          </span>
                        </div>

                        <div className="action-buttons-strip">
                          <button
                            type="button"
                            className="btn-red-action"
                            onClick={() => navigate(`/exam/${exam.id}/monitor`)}
                          >
                            <FiVideo size={14} /> Giám sát trực tiếp
                          </button>
                          <button
                            type="button"
                            className="btn-icon-square"
                            title="Kết quả & Chấm thi"
                            onClick={() => navigate(`/exam/${exam.id}/grading`)}
                          >
                            <FiBarChart2 size={16} />
                          </button>
                          {renderExamMenu(exam)}
                        </div>
                      </>
                    )}

                    {isScheduled && (
                      <div className="action-buttons-strip">
                        <button
                          type="button"
                          className="btn-secondary-exam"
                          onClick={() => navigate(`/exam/${exam.id}/monitor`)}
                        >
                          Phòng Giám sát
                        </button>
                        <button
                          type="button"
                          className="btn-secondary-exam"
                          onClick={() =>
                            navigate(`/class/${classId}/exam/create?examId=${exam.id}`)
                          }
                        >
                          <FiEdit size={14} /> Sửa
                        </button>
                        <button
                          type="button"
                          className="btn-secondary-exam"
                          onClick={() =>
                            navigate(`/class/${classId}/exam/create?duplicateFrom=${exam.id}`)
                          }
                        >
                          <FiCopy size={14} /> Nhân bản
                        </button>
                        {renderExamMenu(exam)}
                      </div>
                    )}

                    {isClosed && (
                      <div className="action-buttons-strip">
                        <button
                          type="button"
                          className="btn-secondary-exam"
                          onClick={() => navigate(`/exam/${exam.id}/grading`)}
                        >
                          <FiBarChart2 size={14} /> Xem kết quả & Chấm điểm
                        </button>
                        <button
                          type="button"
                          className="btn-secondary-exam"
                          onClick={() => navigate(`/exam/${exam.id}/violations`)}
                        >
                          <FiShield size={14} /> Nhật ký vi phạm AI
                        </button>
                        {renderExamMenu(exam)}
                      </div>
                    )}

                    {isDraft && (
                      <div className="action-buttons-strip">
                        <button
                          type="button"
                          className="btn-primary-exam"
                          onClick={() =>
                            navigate(`/class/${classId}/exam/create?examId=${exam.id}`)
                          }
                        >
                          <FiEdit size={14} /> Tiếp tục chỉnh sửa
                        </button>
                        {renderExamMenu(exam)}
                      </div>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="exam-card-sub-footer">
                    <div className="footer-config-info">
                      <span className="green-dot-online" />
                      <span>
                        Mã đề: <strong className="room-id-strong">EXAM-{exam.id}</strong>
                      </span>
                      <span>•</span>
                      <span>
                        Chế độ:{' '}
                        {aiOn
                          ? 'Giám sát AI đa mô hình (ArcFace + HopeNet + YOLOv8) & Chống rời tab'
                          : 'Làm bài tiêu chuẩn không thu camera'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="link-open-waiting-room"
                      onClick={() => navigate(`/exam/${exam.id}/violations`)}
                    >
                      Mở nhật ký hậu kiểm AI <FiExternalLink size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Bottom Dark AI Guard Banner (Matching image6.png with REAL AI Telemetry) ── */}
      <div className="ai-guard-footer-banner">
        <div className="banner-left-group">
          <div className="banner-bot-icon">
            <FiShield size={24} />
          </div>
          <div className="banner-text-info">
            <h4>
              {aiGuardStatus.ready
                ? 'Dịch vụ AI Proctoring đang sẵn sàng phục vụ'
                : 'Dịch vụ AI Proctoring hiện đang chờ kết nối'}
            </h4>
            <p>
              {aiGuardStatus.ready
                ? 'Đã nạp đầy đủ InsightFace buffalo_l, HopeNet, L2CS-Net và YOLOv8 Exam Proctor.'
                : `${
                    aiGuardStatus.reason || 'Chưa kết nối tới tiến trình Python FastAPI'
                  } — Nếu AI offline, hệ thống không bao giờ tính nhầm thành lỗi vi phạm của sinh viên.`}
            </p>
          </div>
        </div>

        <div className="banner-right-group">
          <div
            className="telemetry-latency-tag"
            style={{ color: aiGuardStatus.ready ? '#34D399' : '#FBBF24' }}
          >
            <span
              className="green-dot-online"
              style={{ background: aiGuardStatus.ready ? '#10B981' : '#F59E0B' }}
            />
            {aiGuardStatus.ready
              ? aiGuardStatus.p50Ms !== null
                ? `AI Latency p50: ${aiGuardStatus.p50Ms} ms`
                : 'AI Ready (0 mẫu)'
              : 'AI Offline'}
          </div>
          <button
            type="button"
            className="btn-ai-guard-config"
            onClick={() => navigate(`/class/${classId}/exam/create`)}
          >
            Thiết lập đề thi AI
          </button>
        </div>
      </div>

      {/* ── Modal Mở lại / Gia hạn thời gian đóng đề thi ── */}
      {reopenTarget && (
        <div className="exam-modal-overlay" onClick={() => !reopenSaving && setReopenTarget(null)}>
          <div
            className="exam-modal-container"
            style={{ maxWidth: 480, padding: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', margin: '0 0 8px' }}>
              Mở lại / Gia hạn đề thi
            </h3>
            <p style={{ fontSize: 13, color: '#64748B', margin: '0 0 16px', lineHeight: 1.5 }}>
              Chọn thời điểm đóng đề mới cho <strong>{reopenTarget.title || reopenTarget.name}</strong>. Sinh viên còn lượt thi sẽ có thể tiếp tục vào làm bài.
            </p>

            <form onSubmit={(e) => void handleConfirmReopen(e)}>
              {reopenError && (
                <div
                  role="alert"
                  style={{
                    background: '#FEF2F2',
                    border: '1px solid #FECACA',
                    color: '#DC2626',
                    padding: '10px 12px',
                    borderRadius: 8,
                    fontSize: 13,
                    marginBottom: 14,
                  }}
                >
                  {reopenError}
                </div>
              )}

              <label
                style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#334155',
                  marginBottom: 6,
                }}
              >
                Thời điểm đóng đề mới
              </label>
              <input
                type="datetime-local"
                value={reopenEndTime}
                onChange={(e) => {
                  setReopenError(null);
                  setReopenEndTime(e.target.value);
                }}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #CBD5E1',
                  borderRadius: 8,
                  fontSize: 14,
                  marginBottom: 10,
                }}
                required
              />

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                {[
                  { label: '+30 phút', mins: 30 },
                  { label: '+1 giờ', mins: 60 },
                  { label: '+2 giờ', mins: 120 },
                  { label: '+1 ngày', mins: 24 * 60 },
                ].map((preset) => (
                  <button
                    key={preset.mins}
                    type="button"
                    onClick={() => {
                      setReopenError(null);
                      setReopenEndTime(
                        toLocalDatetimeInputValue(new Date(Date.now() + preset.mins * 60 * 1000)),
                      );
                    }}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: '1px solid #E2E8F0',
                      background: '#F8FAFC',
                      color: '#334155',
                      cursor: 'pointer',
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="exam-btn exam-btn-secondary"
                  disabled={reopenSaving}
                  onClick={() => setReopenTarget(null)}
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="exam-btn exam-btn-primary"
                  disabled={reopenSaving}
                >
                  {reopenSaving ? 'Đang cập nhật...' : 'Xác nhận mở lại'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
