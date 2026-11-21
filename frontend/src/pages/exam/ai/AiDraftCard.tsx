import React, { useState } from 'react';
import type { AiDifficulty, AiDraftOption, AiQuestionDraft } from '../../../types';

interface AiDraftCardProps {
  index: number;
  draft: AiQuestionDraft;
  selected: boolean;
  onToggleSelect: (id: number) => void;
  onUpdateDraft: (
    id: number,
    patch: {
      difficulty: AiDifficulty;
      content: string;
      explanation: string | null;
      chapter: string | null;
      defaultPoints: number;
      options: AiDraftOption[];
    },
  ) => Promise<void>;
  onRegenerateDraft: (id: number) => Promise<void>;
  onDiscardDraft: (id: number) => Promise<void>;
}

export const AiDraftCard: React.FC<AiDraftCardProps> = ({
  index,
  draft,
  selected,
  onToggleSelect,
  onUpdateDraft,
  onRegenerateDraft,
  onDiscardDraft,
}) => {
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showSourceQuote, setShowSourceQuote] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);

  const [form, setForm] = useState({
    content: draft.content,
    difficulty: draft.difficulty,
    chapter: draft.chapter || '',
    defaultPoints: draft.defaultPoints,
    explanation: draft.explanation || '',
    options:
      draft.options.length > 0
        ? draft.options.map((o) => ({ content: o.content, isCorrect: o.isCorrect }))
        : [
            { content: '', isCorrect: true },
            { content: '', isCorrect: false },
            { content: '', isCorrect: false },
            { content: '', isCorrect: false },
          ],
  });

  const hasWarnings = draft.qualityFlags && draft.qualityFlags.length > 0;
  const isAccepted = draft.status === 'accepted';
  const isDiscarded = draft.status === 'discarded';

  const handleStartEdit = () => {
    setForm({
      content: draft.content,
      difficulty: draft.difficulty,
      chapter: draft.chapter || '',
      defaultPoints: draft.defaultPoints,
      explanation: draft.explanation || '',
      options:
        draft.options.length > 0
          ? draft.options.map((o) => ({ content: o.content, isCorrect: o.isCorrect }))
          : [
              { content: '', isCorrect: true },
              { content: '', isCorrect: false },
              { content: '', isCorrect: false },
              { content: '', isCorrect: false },
            ],
    });
    setEditError(null);
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    setEditError(null);
    if (!form.content.trim()) {
      setEditError('Nội dung câu hỏi không được để trống.');
      return;
    }

    const isMcq = draft.questionType !== 'essay';
    const cleanedOpts = isMcq
      ? form.options
          .map((o) => ({ content: o.content.trim(), isCorrect: o.isCorrect }))
          .filter((o) => o.content.length > 0)
      : [];

    if (isMcq) {
      if (cleanedOpts.length < 2) {
        setEditError('Cần ít nhất 2 phương án trả lời.');
        return;
      }
      const correctCount = cleanedOpts.filter((o) => o.isCorrect).length;
      if (correctCount === 0) {
        setEditError('Cần chọn ít nhất 1 phương án đúng.');
        return;
      }
      if (draft.questionType === 'single_choice' && correctCount > 1) {
        setEditError('Câu hỏi 1 đáp án chỉ được chọn duy nhất 1 phương án đúng.');
        return;
      }
    }

    setSavingEdit(true);
    try {
      await onUpdateDraft(draft.id, {
        difficulty: form.difficulty,
        content: form.content.trim(),
        explanation: form.explanation.trim() || null,
        chapter: form.chapter.trim() || null,
        defaultPoints: Number(form.defaultPoints) || 1,
        options: cleanedOpts,
      });
      setEditing(false);
    } catch (err: any) {
      setEditError(err?.response?.data?.error || 'Không thể lưu chỉnh sửa.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRegen = async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      await onRegenerateDraft(draft.id);
    } finally {
      setRegenerating(false);
    }
  };

  const pageLabel =
    draft.sourcePageFrom && draft.sourcePageTo && draft.sourcePageTo > draft.sourcePageFrom
      ? `tr.${draft.sourcePageFrom}-${draft.sourcePageTo}`
      : draft.sourcePageFrom
        ? `tr.${draft.sourcePageFrom}`
        : '';

  return (
    <div
      style={{
        background: isAccepted ? '#F0FDF4' : isDiscarded ? '#F8FAFC' : '#FFFFFF',
        border: selected
          ? '2px solid #4F46E5'
          : hasWarnings
            ? '1px solid #F59E0B'
            : '1px solid #E2E8F0',
        borderRadius: 12,
        padding: 16,
        opacity: isDiscarded ? 0.55 : 1,
        transition: 'all 0.15s ease',
      }}
    >
      {/* ── Top Row: Checkbox + Badges + Actions ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {!isAccepted && !isDiscarded && (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(draft.id)}
              style={{ width: 17, height: 17, cursor: 'pointer' }}
            />
          )}

          <span style={{ fontWeight: 800, fontSize: 13, color: '#1E293B' }}>
            #{index + 1}
          </span>

          <span
            style={{
              padding: '3px 9px',
              borderRadius: 9999,
              fontSize: 12,
              fontWeight: 700,
              background:
                draft.difficulty === 'easy'
                  ? '#DCFCE7'
                  : draft.difficulty === 'medium'
                    ? '#FEF3C7'
                    : '#FEE2E2',
              color:
                draft.difficulty === 'easy'
                  ? '#15803D'
                  : draft.difficulty === 'medium'
                    ? '#B45309'
                    : '#B91C1C',
            }}
          >
            {draft.difficulty === 'easy'
              ? '🟢 Dễ'
              : draft.difficulty === 'medium'
                ? '🟠 Trung bình'
                : '🔴 Khó'}
          </span>

          <span
            style={{
              padding: '3px 9px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              background: '#EEF2FF',
              color: '#4F46E5',
            }}
          >
            {draft.questionType === 'single_choice'
              ? 'Một đáp án'
              : draft.questionType === 'multiple_choice'
                ? 'Nhiều đáp án'
                : 'Tự luận'}
          </span>

          {draft.chapter && (
            <span
              style={{
                padding: '3px 9px',
                borderRadius: 6,
                fontSize: 12,
                background: '#F1F5F9',
                color: '#475569',
              }}
            >
              {draft.chapter}
            </span>
          )}

          <span
            style={{
              padding: '2px 8px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 700,
              border: '1px solid #CBD5E1',
              color: '#0F172A',
            }}
          >
            {draft.defaultPoints} đ
          </span>

          {isAccepted && (
            <span
              style={{
                padding: '3px 9px',
                borderRadius: 9999,
                fontSize: 12,
                fontWeight: 700,
                background: '#16A34A',
                color: '#FFFFFF',
              }}
            >
              ✓ Đã thêm vào ngân hàng (#Q-{draft.bankQuestionId})
            </span>
          )}
        </div>

        {!isAccepted && !isDiscarded && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={handleStartEdit}
              style={{
                padding: '5px 10px',
                borderRadius: 8,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                fontSize: 12,
                fontWeight: 600,
                color: '#334155',
                cursor: 'pointer',
              }}
            >
              ✏️ Sửa
            </button>
            <button
              type="button"
              disabled={regenerating}
              onClick={() => void handleRegen()}
              style={{
                padding: '5px 10px',
                borderRadius: 8,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                fontSize: 12,
                fontWeight: 600,
                color: '#334155',
                cursor: regenerating ? 'not-allowed' : 'pointer',
              }}
              title="Sinh lại câu hỏi này"
            >
              {regenerating ? '⏳ Đang tạo...' : '🔄 Sinh lại'}
            </button>
            <button
              type="button"
              onClick={() => void onDiscardDraft(draft.id)}
              style={{
                padding: '5px 10px',
                borderRadius: 8,
                border: '1px solid #FECACA',
                background: '#FEF2F2',
                fontSize: 12,
                fontWeight: 600,
                color: '#DC2626',
                cursor: 'pointer',
              }}
              title="Loại bỏ bản nháp này"
            >
              🗑️
            </button>
          </div>
        )}
      </div>

      {/* ── Quality Warnings ── */}
      {hasWarnings && (
        <div
          style={{
            marginBottom: 10,
            padding: '8px 12px',
            borderRadius: 8,
            background: '#FFFBEB',
            border: '1px solid #FDE68A',
            color: '#92400E',
            fontSize: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {draft.qualityFlags.includes('duplicate_bank') && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>
                ⚠️ <strong>Có thể trùng câu hỏi #{draft.duplicateOf}</strong> đã có trong ngân hàng của lớp.
              </span>
              {draft.duplicateContent && (
                <button
                  type="button"
                  onClick={() => setShowCompare((prev) => !prev)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#4F46E5',
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  [{showCompare ? 'Ẩn so sánh' : 'So sánh'}]
                </button>
              )}
            </div>
          )}
          {showCompare && draft.duplicateContent && (
            <div
              style={{
                padding: '6px 10px',
                background: '#FFFFFF',
                borderRadius: 6,
                border: '1px solid #E2E8F0',
                color: '#334155',
              }}
            >
              Câu trong ngân hàng (#Q-{draft.duplicateOf}): “{draft.duplicateContent}”
            </div>
          )}
          {draft.qualityFlags.includes('duplicate_batch') && (
            <div>
              ⚠️ <strong>Trùng lặp nội dung</strong> với một câu khác trong cùng lần tạo này.
            </div>
          )}
          {draft.qualityFlags.includes('verify_failed') && (
            <div>
              ⚠️ <strong>Cần xem lại đáp án:</strong>{' '}
              {draft.verifyNote || 'Bước kiểm tra chéo cho kết quả khác.'}
            </div>
          )}
          {draft.qualityFlags.includes('ungrounded') && (
            <div>
              ⚠️ <strong>Trích dẫn nguồn chưa khớp nguyên văn</strong> với tài liệu, vui lòng kiểm tra lại.
            </div>
          )}
        </div>
      )}

      {/* ── Inline Edit Mode vs View Mode ── */}
      {editing ? (
        <div
          style={{
            background: '#F8FAFC',
            border: '1px solid #CBD5E1',
            borderRadius: 10,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {editError && (
            <div style={{ color: '#DC2626', fontSize: 12, fontWeight: 600 }}>
              ⚠️ {editError}
            </div>
          )}

          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>
              Nội dung câu hỏi
            </label>
            <textarea
              rows={3}
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              style={{
                width: '100%',
                marginTop: 4,
                padding: 8,
                borderRadius: 8,
                border: '1px solid #CBD5E1',
                fontSize: 13,
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>
                Độ khó
              </label>
              <select
                value={form.difficulty}
                onChange={(e) =>
                  setForm({ ...form, difficulty: e.target.value as AiDifficulty })
                }
                style={{
                  display: 'block',
                  marginTop: 4,
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid #CBD5E1',
                  fontSize: 13,
                }}
              >
                <option value="easy">Dễ</option>
                <option value="medium">Trung bình</option>
                <option value="hard">Khó</option>
              </select>
            </div>

            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>
                Chương / Chủ đề
              </label>
              <input
                type="text"
                value={form.chapter}
                onChange={(e) => setForm({ ...form, chapter: e.target.value })}
                style={{
                  width: '100%',
                  marginTop: 4,
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid #CBD5E1',
                  fontSize: 13,
                }}
              />
            </div>

            <div style={{ width: 90 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>
                Điểm
              </label>
              <input
                type="number"
                step="0.25"
                min="0.25"
                value={form.defaultPoints}
                onChange={(e) =>
                  setForm({ ...form, defaultPoints: Number(e.target.value) })
                }
                style={{
                  width: '100%',
                  marginTop: 4,
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid #CBD5E1',
                  fontSize: 13,
                }}
              />
            </div>
          </div>

          {draft.questionType !== 'essay' && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>
                Các phương án (tích chọn đáp án đúng)
              </label>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  marginTop: 6,
                }}
              >
                {form.options.map((opt, oIdx) => (
                  <div
                    key={oIdx}
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <input
                      type={
                        draft.questionType === 'single_choice' ? 'radio' : 'checkbox'
                      }
                      name={`draft-opt-${draft.id}`}
                      checked={opt.isCorrect}
                      onChange={() => {
                        if (draft.questionType === 'single_choice') {
                          setForm({
                            ...form,
                            options: form.options.map((item, idx) => ({
                              ...item,
                              isCorrect: idx === oIdx,
                            })),
                          });
                        } else {
                          setForm({
                            ...form,
                            options: form.options.map((item, idx) =>
                              idx === oIdx
                                ? { ...item, isCorrect: !item.isCorrect }
                                : item,
                            ),
                          });
                        }
                      }}
                    />
                    <span style={{ fontWeight: 700, fontSize: 12, width: 18 }}>
                      {String.fromCharCode(65 + oIdx)}.
                    </span>
                    <input
                      type="text"
                      value={opt.content}
                      onChange={(e) => {
                        const val = e.target.value;
                        setForm({
                          ...form,
                          options: form.options.map((item, idx) =>
                            idx === oIdx ? { ...item, content: val } : item,
                          ),
                        });
                      }}
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #CBD5E1',
                        fontSize: 13,
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>
              {draft.questionType === 'essay'
                ? 'Đáp án mẫu & Hướng dẫn chấm điểm (Rubric)'
                : 'Giải thích đáp án'}
            </label>
            <textarea
              rows={2}
              value={form.explanation}
              onChange={(e) => setForm({ ...form, explanation: e.target.value })}
              style={{
                width: '100%',
                marginTop: 4,
                padding: 8,
                borderRadius: 8,
                border: '1px solid #CBD5E1',
                fontSize: 13,
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              onClick={() => setEditing(false)}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={savingEdit}
              onClick={() => void handleSaveEdit()}
              style={{
                padding: '6px 16px',
                borderRadius: 8,
                border: 'none',
                background: '#4F46E5',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {savingEdit ? 'Đang lưu...' : 'Lưu chỉnh sửa'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              fontSize: 14.5,
              fontWeight: 600,
              color: '#0F172A',
              lineHeight: 1.5,
              marginBottom: 10,
              whiteSpace: 'pre-wrap',
            }}
          >
            {draft.content}
          </div>

          {draft.questionType !== 'essay' && draft.options.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
                gap: 8,
                marginBottom: 10,
              }}
            >
              {draft.options.map((opt, oIdx) => (
                <div
                  key={oIdx}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: opt.isCorrect
                      ? '1.5px solid #16A34A'
                      : '1px solid #E2E8F0',
                    background: opt.isCorrect ? '#F0FDF4' : '#F8FAFC',
                    color: opt.isCorrect ? '#14532D' : '#334155',
                    fontSize: 13,
                    fontWeight: opt.isCorrect ? 700 : 500,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 6,
                  }}
                >
                  <span>
                    {opt.isCorrect ? '✔' : `${String.fromCharCode(65 + oIdx)}.`}
                  </span>
                  <span style={{ flex: 1 }}>{opt.content}</span>
                </div>
              ))}
            </div>
          )}

          {draft.explanation && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                background: '#F1F5F9',
                color: '#334155',
                fontSize: 12.5,
                lineHeight: 1.5,
                marginBottom: 8,
                whiteSpace: 'pre-wrap',
              }}
            >
              <strong>
                {draft.questionType === 'essay'
                  ? '💡 Đáp án mẫu & Rubric chấm: '
                  : '💡 Giải thích: '}
              </strong>
              {draft.explanation}
            </div>
          )}

          {(draft.sourceFileName || draft.sourceQuote) && (
            <div
              style={{
                fontSize: 12,
                color: '#475569',
                background: '#F8FAFC',
                border: '1px dashed #CBD5E1',
                borderRadius: 8,
                padding: '6px 10px',
              }}
            >
              <div
                onClick={() => setShowSourceQuote((prev) => !prev)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                <span>
                  📎 Nguồn: {draft.sourceFileName || 'Tài liệu lớp'}
                  {pageLabel ? ` · ${pageLabel}` : ''}
                </span>
                <span style={{ color: '#4F46E5', fontSize: 11 }}>
                  {showSourceQuote ? '▾ Thu gọn' : '▸ Xem trích dẫn'}
                </span>
              </div>
              {showSourceQuote && draft.sourceQuote && (
                <div
                  style={{
                    marginTop: 4,
                    fontStyle: 'italic',
                    color: '#64748B',
                  }}
                >
                  “{draft.sourceQuote}”
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
