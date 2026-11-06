import React, { useState, useEffect, useMemo } from 'react';
import { questionBankApi } from '../../api';
import type { BankQuestion, BankQuestionOption } from '../../types';
import './exam.css';

interface QuestionBankTabProps {
  classId: number | string;
}

export function QuestionBankTab({ classId }: QuestionBankTabProps) {
  const numericClassId = typeof classId === 'string' ? parseInt(classId, 10) : classId;
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterChapter, setFilterChapter] = useState('all');
  const [filterDifficulty, setFilterDifficulty] = useState('all');
  const [filterType, setFilterType] = useState('all');

  // Pagination state (thật, không hardcode 1 2 3 ... 15)
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Modal create/edit question
  const [showModal, setShowModal] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<BankQuestion | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    content: '',
    explanation: '',
    questionType: 'single_choice' as
      | 'single_choice'
      | 'multiple_choice'
      | 'essay'
      | 'file_upload',
    difficulty: 'medium' as 'easy' | 'medium' | 'hard',
    chapter: 'Chương 1: Tổng quan',
    defaultPoints: 1,
    options: [
      { content: '', is_correct: true },
      { content: '', is_correct: false },
      { content: '', is_correct: false },
      { content: '', is_correct: false },
    ] as BankQuestionOption[],
  });

  const loadQuestions = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const res = await questionBankApi.list(numericClassId);
      setQuestions(res.data?.data ?? []);
    } catch (err) {
      console.error('Không thể tải ngân hàng câu hỏi:', err);
      setQuestions([]);
      setLoadError('Không thể tải ngân hàng câu hỏi. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadQuestions();
  }, [classId]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterChapter, filterDifficulty, filterType, pageSize]);

  // Statistics calculation (100% dữ liệu thật từ DB)
  const totalCount = questions.length;
  const mcCount = questions.filter(
    (q) => q.question_type === 'single_choice' || q.question_type === 'multiple_choice',
  ).length;
  const essayCount = questions.filter(
    (q) => q.question_type === 'essay' || q.question_type === 'file_upload',
  ).length;
  const mcPct = totalCount > 0 ? Math.round((mcCount / totalCount) * 100) : 0;
  const essayPct = totalCount > 0 ? Math.round((essayCount / totalCount) * 100) : 0;

  const easyCount = questions.filter((q) => q.difficulty === 'easy').length;
  const medCount = questions.filter((q) => q.difficulty === 'medium').length;
  const hardCount = questions.filter((q) => q.difficulty === 'hard').length;

  const availableChapters = useMemo(() => {
    const set = new Set<string>();
    questions.forEach((q) => {
      if (q.chapter?.trim()) set.add(q.chapter.trim());
    });
    return Array.from(set);
  }, [questions]);

  const filtered = useMemo(() => {
    return questions.filter((q) => {
      const matchSearch =
        !search ||
        q.content.toLowerCase().includes(search.toLowerCase()) ||
        (q.chapter || '').toLowerCase().includes(search.toLowerCase());
      const matchChapter = filterChapter === 'all' || q.chapter === filterChapter;
      const matchDiff = filterDifficulty === 'all' || q.difficulty === filterDifficulty;
      const matchType =
        filterType === 'all' ||
        (filterType === 'mc' &&
          (q.question_type === 'single_choice' ||
            q.question_type === 'multiple_choice')) ||
        (filterType === 'essay' &&
          (q.question_type === 'essay' || q.question_type === 'file_upload'));
      return matchSearch && matchChapter && matchDiff && matchType;
    });
  }, [questions, search, filterChapter, filterDifficulty, filterType]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const paginatedQuestions = filtered.slice(startIndex, startIndex + pageSize);

  const handleOpenCreate = () => {
    setEditingQuestion(null);
    setModalError(null);
    setFormData({
      content: '',
      explanation: '',
      questionType: 'single_choice',
      difficulty: 'medium',
      chapter: availableChapters[0] || 'Chương 1: Tổng quan',
      defaultPoints: 1,
      options: [
        { content: '', is_correct: true },
        { content: '', is_correct: false },
        { content: '', is_correct: false },
        { content: '', is_correct: false },
      ],
    });
    setShowModal(true);
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setModalError(null);

    const trimmedContent = formData.content.trim();
    if (!trimmedContent) {
      setModalError('Vui lòng nhập nội dung câu hỏi.');
      return;
    }

    const points = Number(formData.defaultPoints);
    if (!Number.isFinite(points) || points <= 0) {
      setModalError('Điểm mặc định phải lớn hơn 0.');
      return;
    }

    const isMcq =
      formData.questionType === 'single_choice' ||
      formData.questionType === 'multiple_choice';

    const filledOptions = isMcq
      ? formData.options
          .filter((o) => o.content.trim() !== '')
          .map((o) => ({ content: o.content.trim(), isCorrect: Boolean(o.is_correct) }))
      : [];

    if (isMcq) {
      if (filledOptions.length < 2) {
        setModalError('Câu hỏi trắc nghiệm cần nhập tối thiểu 2 lựa chọn đáp án.');
        return;
      }
      const correctCount = filledOptions.filter((o) => o.isCorrect).length;
      if (correctCount === 0) {
        setModalError('Vui lòng tích chọn ít nhất 1 đáp án đúng trong các lựa chọn đã nhập.');
        return;
      }
      if (formData.questionType === 'single_choice' && correctCount > 1) {
        setModalError('Câu hỏi trắc nghiệm đơn chỉ được có duy nhất 1 đáp án đúng.');
        return;
      }
    }

    try {
      setSaving(true);
      const payload: any = {
        questionType: formData.questionType,
        content: trimmedContent,
        explanation: formData.explanation.trim() || undefined,
        defaultPoints: points,
        difficulty: formData.difficulty,
        chapter: formData.chapter.trim() || undefined,
        options: filledOptions,
      };

      if (editingQuestion) {
        await questionBankApi.update(editingQuestion.id, payload);
      } else {
        await questionBankApi.create(numericClassId, payload);
      }
      setShowModal(false);
      setModalError(null);
      await loadQuestions();
    } catch (err: any) {
      setModalError(
        err.response?.data?.error || 'Không thể lưu câu hỏi. Vui lòng kiểm tra lại thông tin.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa câu hỏi này khỏi ngân hàng?')) return;
    try {
      setActionError(null);
      await questionBankApi.delete(id);
      setQuestions((prev) => prev.filter((q) => q.id !== id));
    } catch (err: any) {
      setActionError(err.response?.data?.error || 'Không thể xóa câu hỏi.');
    }
  };

  const handleDuplicate = async (q: BankQuestion) => {
    try {
      setActionError(null);
      const isMcq =
        q.question_type === 'single_choice' || q.question_type === 'multiple_choice';
      await questionBankApi.create(numericClassId, {
        questionType: q.question_type,
        content: `${q.content} (Bản sao)`,
        explanation: q.explanation || undefined,
        defaultPoints: Number(q.default_points) || 1,
        difficulty: q.difficulty,
        chapter: q.chapter || undefined,
        options: isMcq
          ? ((q.options || []).map((o) => ({
              content: o.content,
              isCorrect: Boolean(o.is_correct),
            })) as any)
          : [],
      });
      await loadQuestions();
    } catch (err: any) {
      setActionError(err.response?.data?.error || 'Không thể nhân bản câu hỏi.');
    }
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(questions, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `question-bank-class-${numericClassId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ marginTop: 16 }}>
      {/* ── Header Title & Actions (image1.png) ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0F172A', margin: 0 }}>
              Ngân hàng câu hỏi
            </h1>
            <span
              style={{
                background: '#EEF2FF',
                color: '#4F46E5',
                padding: '4px 12px',
                borderRadius: 9999,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              • {totalCount} câu hỏi
            </span>
          </div>
          <p style={{ color: '#64748B', fontSize: 14, marginTop: 6, maxWidth: 650 }}>
            Quản lý kho câu hỏi riêng biệt của lớp học. Khi thêm vào đề thi, câu hỏi được tạo bản sao độc lập kèm liên kết chương để thống kê năng lực sinh viên.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={handleExportJson}
            disabled={questions.length === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              background: '#FFFFFF',
              border: '1px solid #CBD5E1',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              color: '#334155',
            }}
          >
            <span>📥</span> Xuất JSON ({totalCount})
          </button>
          <button
            type="button"
            onClick={handleOpenCreate}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 20px',
              background: '#4F46E5',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              color: '#FFFFFF',
              boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)',
            }}
          >
            <span style={{ fontSize: 18 }}>+</span> Thêm câu hỏi mới
          </button>
        </div>
      </div>

      {loadError && (
        <div className="exam-error-banner" role="alert">
          <span>{loadError}</span>
          <button
            type="button"
            className="exam-btn exam-btn-secondary"
            onClick={() => void loadQuestions()}
          >
            Thử lại
          </button>
        </div>
      )}

      {actionError && (
        <div className="exam-error-banner" role="alert">
          <span>{actionError}</span>
          <button
            type="button"
            className="exam-btn exam-btn-secondary"
            onClick={() => setActionError(null)}
          >
            Đóng
          </button>
        </div>
      )}

      {/* ── 4 Stats Summary Cards (image1.png — 100% real percentages) ── */}
      <div className="exam-stats-row">
        <div className="stat-box-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: '#EEF2FF',
                color: '#4F46E5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
              }}
            >
              🗄️
            </div>
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#64748B',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                TỔNG CÂU HỎI
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: '#0F172A' }}>
                  {totalCount}
                </span>
                <span style={{ fontSize: 12, color: '#64748B' }}>
                  {availableChapters.length} chương
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="stat-box-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: '#F5F3FF',
                color: '#7C3AED',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
              }}
            >
              📋
            </div>
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#64748B',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                TRẮC NGHIỆM
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: '#0F172A' }}>
                  {mcCount}
                </span>
                <span style={{ fontSize: 12, color: '#64748B' }}>
                  {mcPct}% ngân hàng
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="stat-box-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: '#EFF6FF',
                color: '#2563EB',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
              }}
            >
              💻
            </div>
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#64748B',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                TỰ LUẬN & TỆP
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: '#0F172A' }}>
                  {essayCount}
                </span>
                <span style={{ fontSize: 12, color: '#64748B' }}>
                  {essayPct}% kho đề
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="stat-box-card">
          <div style={{ width: '100%' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#64748B',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                PHÂN BỔ ĐỘ KHÓ
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 10,
                fontSize: 13,
                fontWeight: 700,
                marginTop: 6,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ color: '#059669', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span
                  style={{ width: 8, height: 8, borderRadius: '50%', background: '#059669' }}
                />{' '}
                {easyCount} Dễ
              </span>
              <span style={{ color: '#D97706', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span
                  style={{ width: 8, height: 8, borderRadius: '50%', background: '#D97706' }}
                />{' '}
                {medCount} TB
              </span>
              <span style={{ color: '#DC2626', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span
                  style={{ width: 8, height: 8, borderRadius: '50%', background: '#DC2626' }}
                />{' '}
                {hardCount} Khó
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Search & Filter Bar (image1.png) ── */}
      <div
        style={{
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: 14,
          padding: '14px 18px',
          display: 'flex',
          gap: 14,
          alignItems: 'center',
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 260, position: 'relative' }}>
          <span
            style={{
              position: 'absolute',
              left: 14,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#94A3B8',
            }}
          >
            🔍
          </span>
          <input
            type="text"
            placeholder="Tìm kiếm theo từ khóa câu hỏi, nội dung, chương..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 14px 10px 40px',
              border: '1px solid #E2E8F0',
              borderRadius: 10,
              fontSize: 14,
              background: '#F8FAFC',
            }}
          />
        </div>

        <select
          value={filterChapter}
          onChange={(e) => setFilterChapter(e.target.value)}
          style={{
            padding: '10px 14px',
            border: '1px solid #E2E8F0',
            borderRadius: 10,
            background: '#F8FAFC',
            fontSize: 14,
            color: '#334155',
          }}
        >
          <option value="all">Tất cả chương ({availableChapters.length})</option>
          {availableChapters.map((chap) => (
            <option key={chap} value={chap}>
              {chap}
            </option>
          ))}
        </select>

        <select
          value={filterDifficulty}
          onChange={(e) => setFilterDifficulty(e.target.value)}
          style={{
            padding: '10px 14px',
            border: '1px solid #E2E8F0',
            borderRadius: 10,
            background: '#F8FAFC',
            fontSize: 14,
            color: '#334155',
          }}
        >
          <option value="all">Tất cả độ khó</option>
          <option value="easy">Dễ</option>
          <option value="medium">Trung bình</option>
          <option value="hard">Khó</option>
        </select>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          style={{
            padding: '10px 14px',
            border: '1px solid #E2E8F0',
            borderRadius: 10,
            background: '#F8FAFC',
            fontSize: 14,
            color: '#334155',
          }}
        >
          <option value="all">Tất cả định dạng</option>
          <option value="mc">Trắc nghiệm</option>
          <option value="essay">Tự luận & Tệp</option>
        </select>
      </div>

      {/* ── Question Cards List ── */}
      {loading ? (
        <div className="exam-loading-state">
          <div className="spinner" />
          <p>Đang tải ngân hàng câu hỏi...</p>
        </div>
      ) : paginatedQuestions.length === 0 ? (
        <div className="exam-empty-state">
          <h3>Chưa có câu hỏi nào khớp bộ lọc</h3>
          <p>Nhấn "+ Thêm câu hỏi mới" để bổ sung câu hỏi cho học phần này.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {paginatedQuestions.map((q) => {
            const timestampStr = q.updated_at || q.created_at;
            const formattedDate = timestampStr
              ? new Date(timestampStr).toLocaleString('vi-VN')
              : '--';
            const usedCount = Number(q.used_in_exams_count ?? 0);

            return (
              <div key={q.id} className="question-card-item">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#2563EB' }}>
                      #Q-{q.id}
                    </span>
                    <span
                      style={{
                        background: '#F1F5F9',
                        color: '#475569',
                        padding: '3px 8px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      {q.chapter || 'Chưa gắn chương'}
                    </span>
                    <span className="exam-badge exam-badge-ai">
                      {q.question_type === 'single_choice'
                        ? 'Trắc nghiệm đơn'
                        : q.question_type === 'multiple_choice'
                          ? 'Trắc nghiệm nhiều lựa chọn'
                          : q.question_type === 'file_upload'
                            ? 'Nộp tập tin / Code'
                            : 'Tự luận'}
                    </span>
                    <span
                      className={`status-pill-badge ${
                        q.difficulty === 'easy'
                          ? 'badge-green'
                          : q.difficulty === 'medium'
                            ? 'badge-orange'
                            : 'badge-red'
                      }`}
                    >
                      •{' '}
                      {q.difficulty === 'easy'
                        ? 'Dễ'
                        : q.difficulty === 'medium'
                          ? 'Trung bình'
                          : 'Khó'}
                    </span>
                    <span
                      style={{
                        background: '#F8FAFC',
                        border: '1px solid #E2E8F0',
                        color: '#0F172A',
                        padding: '2px 8px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {q.default_points} đ
                    </span>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: 8, color: '#64748B' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingQuestion(q);
                        setModalError(null);
                        const paddedOptions: BankQuestionOption[] =
                          q.options && q.options.length > 0
                            ? q.options.map((o) => ({
                                content: o.content,
                                is_correct: Boolean(o.is_correct),
                              }))
                            : [
                                { content: '', is_correct: true },
                                { content: '', is_correct: false },
                                { content: '', is_correct: false },
                                { content: '', is_correct: false },
                              ];
                        setFormData({
                          content: q.content,
                          explanation: q.explanation || '',
                          questionType: q.question_type,
                          difficulty: q.difficulty,
                          chapter: q.chapter || '',
                          defaultPoints: Number(q.default_points),
                          options: paddedOptions,
                        });
                        setShowModal(true);
                      }}
                      title="Sửa câu hỏi"
                      className="btn-icon-square"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDuplicate(q)}
                      title="Nhân bản câu hỏi"
                      className="btn-icon-square"
                    >
                      📋
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(q.id)}
                      title="Xóa câu hỏi"
                      className="btn-icon-square"
                      style={{ color: '#EF4444' }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>

                {/* Question Content */}
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: '#0F172A',
                    lineHeight: 1.5,
                    marginBottom: 12,
                  }}
                >
                  {q.content}
                </div>

                {q.explanation && (
                  <div
                    style={{
                      background: '#0F172A',
                      color: '#E2E8F0',
                      padding: '12px 16px',
                      borderRadius: 8,
                      fontFamily: 'monospace',
                      fontSize: 13,
                      marginBottom: 14,
                    }}
                  >
                    {q.explanation}
                  </div>
                )}

                {q.options && q.options.length > 0 && (
                  <div className="options-grid-2x2">
                    {q.options.map((opt, oIdx) => (
                      <div
                        key={oIdx}
                        className={`option-box-view ${opt.is_correct ? 'correct' : ''}`}
                      >
                        <span className="option-tag">{String.fromCharCode(65 + oIdx)}</span>
                        <span style={{ flex: 1 }}>{opt.content}</span>
                        {opt.is_correct && (
                          <span style={{ color: '#10B981', fontWeight: 700 }}>✓</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Real Footer Meta */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    fontSize: 12,
                    color: '#64748B',
                    marginTop: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <span>
                    🕒 Cập nhật lúc {formattedDate}
                    {q.creator_name ? ` bởi ${q.creator_name}` : ''}
                  </span>
                  <span>•</span>
                  <span>
                    📑{' '}
                    {usedCount > 0
                      ? `Đã đưa vào ${usedCount} đề thi`
                      : 'Chưa dùng trong đề thi nào'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Real Pagination Footer (image1.png) ── */}
      {filtered.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '18px 4px',
            color: '#64748B',
            fontSize: 13,
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            Hiển thị{' '}
            <b>
              {startIndex + 1} - {Math.min(startIndex + pageSize, filtered.length)}
            </b>{' '}
            trên tổng số <b>{filtered.length}</b> câu hỏi (Kho lớp: {totalCount})
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              style={{
                padding: '6px 12px',
                border: '1px solid #E2E8F0',
                borderRadius: 8,
                background: '#FFFFFF',
              }}
            >
              <option value={10}>10 câu / trang</option>
              <option value={20}>20 câu / trang</option>
              <option value={50}>50 câu / trang</option>
            </select>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{
                  width: 32,
                  height: 32,
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  background: '#FFFFFF',
                  opacity: safePage <= 1 ? 0.5 : 1,
                }}
              >
                &lt;
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setCurrentPage(page)}
                  style={{
                    width: 32,
                    height: 32,
                    border: page === safePage ? 'none' : '1px solid #E2E8F0',
                    borderRadius: 8,
                    background: page === safePage ? '#4F46E5' : '#FFFFFF',
                    color: page === safePage ? '#FFFFFF' : '#334155',
                    fontWeight: page === safePage ? 700 : 500,
                  }}
                >
                  {page}
                </button>
              ))}
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  width: 32,
                  height: 32,
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  background: '#FFFFFF',
                  opacity: safePage >= totalPages ? 0.5 : 1,
                }}
              >
                &gt;
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit Question Modal ── */}
      {showModal && (
        <div className="exam-modal-overlay" onClick={() => setShowModal(false)}>
          <div
            className="exam-modal-container"
            style={{ maxWidth: 720, padding: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 20,
              }}
            >
              <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
                {editingQuestion ? 'Chỉnh sửa câu hỏi' : 'Thêm câu hỏi mới vào ngân hàng'}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                style={{ fontSize: 22, color: '#94A3B8' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveQuestion(e)}>
              {modalError && (
                <div
                  role="alert"
                  style={{
                    background: '#FEF2F2',
                    border: '1px solid #FECACA',
                    color: '#DC2626',
                    padding: '10px 14px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 500,
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span>⚠️</span>
                  <span>{modalError}</span>
                </div>
              )}

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 14,
                  marginBottom: 16,
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#475569',
                      marginBottom: 6,
                    }}
                  >
                    Loại câu hỏi
                  </label>
                  <select
                    value={formData.questionType}
                    onChange={(e) => {
                      const nextType = e.target.value as
                        | 'single_choice'
                        | 'multiple_choice'
                        | 'essay'
                        | 'file_upload';
                      setModalError(null);
                      let nextOptions = formData.options;
                      if (nextType === 'single_choice') {
                        const firstCorrectIdx = formData.options.findIndex((o) => o.is_correct);
                        const chosenIdx = firstCorrectIdx >= 0 ? firstCorrectIdx : 0;
                        nextOptions = formData.options.map((o, idx) => ({
                          ...o,
                          is_correct: idx === chosenIdx,
                        }));
                      }
                      setFormData({
                        ...formData,
                        questionType: nextType,
                        options: nextOptions,
                      });
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid #CBD5E1',
                      borderRadius: 8,
                    }}
                  >
                    <option value="single_choice">Trắc nghiệm đơn (1 đáp án đúng)</option>
                    <option value="multiple_choice">Trắc nghiệm nhiều lựa chọn</option>
                    <option value="essay">Tự luận / Trả lời văn bản</option>
                    <option value="file_upload">Nộp tập tin / Mã nguồn</option>
                  </select>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#475569',
                      marginBottom: 6,
                    }}
                  >
                    Độ khó
                  </label>
                  <select
                    value={formData.difficulty}
                    onChange={(e) =>
                      setFormData({ ...formData, difficulty: e.target.value as any })
                    }
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid #CBD5E1',
                      borderRadius: 8,
                    }}
                  >
                    <option value="easy">Dễ</option>
                    <option value="medium">Trung bình</option>
                    <option value="hard">Khó</option>
                  </select>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#475569',
                      marginBottom: 6,
                    }}
                  >
                    Điểm mặc định
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    min="0.25"
                    value={formData.defaultPoints}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        defaultPoints: parseFloat(e.target.value) || 1,
                      })
                    }
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid #CBD5E1',
                      borderRadius: 8,
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#475569',
                    marginBottom: 6,
                  }}
                >
                  Chương / Chủ đề (dùng thống kê năng lực đầu ra)
                </label>
                <input
                  type="text"
                  maxLength={100}
                  placeholder="Ví dụ: Chương 2: Lập trình Socket TCP/UDP"
                  value={formData.chapter}
                  onChange={(e) => setFormData({ ...formData, chapter: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #CBD5E1',
                    borderRadius: 8,
                  }}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#475569',
                    marginBottom: 6,
                  }}
                >
                  Nội dung câu hỏi *
                </label>
                <textarea
                  rows={3}
                  placeholder="Nhập nội dung câu hỏi..."
                  value={formData.content}
                  onChange={(e) => {
                    setModalError(null);
                    setFormData({ ...formData, content: e.target.value });
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #CBD5E1',
                    borderRadius: 8,
                    fontSize: 14,
                  }}
                  required
                />
              </div>

              {(formData.questionType === 'single_choice' ||
                formData.questionType === 'multiple_choice') && (
                <div style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <label
                      style={{
                        display: 'block',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#475569',
                      }}
                    >
                      Các lựa chọn đáp án (Tích chọn đáp án đúng)
                    </label>
                    {formData.options.length < 8 && (
                      <button
                        type="button"
                        onClick={() =>
                          setFormData({
                            ...formData,
                            options: [
                              ...formData.options,
                              { content: '', is_correct: false },
                            ],
                          })
                        }
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#4F46E5',
                          background: '#EEF2FF',
                          border: 'none',
                          borderRadius: 6,
                          padding: '4px 10px',
                          cursor: 'pointer',
                        }}
                      >
                        + Thêm lựa chọn
                      </button>
                    )}
                  </div>
                  {formData.options.map((opt, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        marginBottom: 8,
                      }}
                    >
                      <input
                        type={
                          formData.questionType === 'single_choice' ? 'radio' : 'checkbox'
                        }
                        name="correct_opt"
                        checked={opt.is_correct}
                        onChange={(e) => {
                          setModalError(null);
                          const updated = formData.options.map((o, idx) => ({
                            ...o,
                            is_correct:
                              formData.questionType === 'single_choice'
                                ? idx === i
                                : idx === i
                                  ? e.target.checked
                                  : o.is_correct,
                          }));
                          setFormData({ ...formData, options: updated });
                        }}
                        style={{ width: 18, height: 18 }}
                      />
                      <span style={{ fontWeight: 700, width: 24 }}>
                        {String.fromCharCode(65 + i)}
                      </span>
                      <input
                        type="text"
                        placeholder={`Lựa chọn ${String.fromCharCode(65 + i)}`}
                        value={opt.content}
                        onChange={(e) => {
                          setModalError(null);
                          const updated = formData.options.map((o, idx) =>
                            idx === i ? { ...o, content: e.target.value } : o,
                          );
                          setFormData({ ...formData, options: updated });
                        }}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          border: '1px solid #CBD5E1',
                          borderRadius: 8,
                        }}
                      />
                      {formData.options.length > 2 && (
                        <button
                          type="button"
                          title="Xóa lựa chọn này"
                          onClick={() => {
                            const nextOpts = formData.options.filter((_, idx) => idx !== i);
                            if (
                              formData.questionType === 'single_choice' &&
                              !nextOpts.some((o) => o.is_correct) &&
                              nextOpts.length > 0
                            ) {
                              nextOpts[0] = { ...nextOpts[0], is_correct: true };
                            }
                            setFormData({ ...formData, options: nextOpts });
                          }}
                          style={{
                            color: '#94A3B8',
                            fontSize: 15,
                            padding: '4px 6px',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginBottom: 20 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#475569',
                    marginBottom: 6,
                  }}
                >
                  Giải thích đáp án / Rubric chấm tự luận
                </label>
                <textarea
                  rows={2}
                  placeholder="Gợi ý giải bài hoặc barem chấm tự luận..."
                  value={formData.explanation}
                  onChange={(e) => setFormData({ ...formData, explanation: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #CBD5E1',
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setShowModal(false)}
                  className="exam-btn exam-btn-secondary"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="exam-btn exam-btn-primary"
                >
                  {saving ? 'Đang lưu...' : 'Lưu câu hỏi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
