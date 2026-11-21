import React, { useState, useEffect, useMemo } from 'react';
import { aiApi } from '../../../api';
import type {
  AiDifficulty,
  AiDraftOption,
  AiGenerationJob,
  AiQuestionDraft,
  AiQuestionType,
  DocIngestionStatus,
} from '../../../types';
import { AiDraftCard } from './AiDraftCard';

interface AiQuestionWizardProps {
  open: boolean;
  onClose: () => void;
  classId: number;
  availableChapters: string[];
  initialDocIds?: number[];
  initialJobId?: number | null;
  onAcceptedSuccess: (acceptedCount: number) => void;
}

interface DocScopeState {
  mode: 'all' | 'heading' | 'pages';
  headings: string[];
  pageFrom: number;
  pageTo: number;
}

export const AiQuestionWizard: React.FC<AiQuestionWizardProps> = ({
  open,
  onClose,
  classId,
  availableChapters,
  initialDocIds,
  initialJobId,
  onAcceptedSuccess,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [docsStatus, setDocsStatus] = useState<DocIngestionStatus[]>([]);
  const [geminiConfigured, setGeminiConfigured] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // Step 1: Nguồn tài liệu
  const [selectedDocIds, setSelectedDocIds] = useState<number[]>([]);
  const [docScopes, setDocScopes] = useState<Record<number, DocScopeState>>({});

  // Step 2: Cấu hình ma trận 3x3 (Loại câu hỏi × Độ khó)
  const [enabledTypes, setEnabledTypes] = useState<Record<AiQuestionType, boolean>>({
    single_choice: true,
    multiple_choice: false,
    essay: false,
  });
  const [matrix, setMatrix] = useState<
    Record<AiQuestionType, { easy: number; medium: number; hard: number }>
  >({
    single_choice: { easy: 3, medium: 3, hard: 2 },
    multiple_choice: { easy: 1, medium: 1, hard: 1 },
    essay: { easy: 1, medium: 1, hard: 0 },
  });
  const [optionCount, setOptionCount] = useState<4 | 5>(4);
  const [chapter, setChapter] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [pointsByDiff, setPointsByDiff] = useState({
    easy: 1,
    medium: 1.5,
    hard: 2,
  });
  const [language, setLanguage] = useState<'vi' | 'en'>('vi');
  const [extraInstruction, setExtraInstruction] = useState('');
  const [verifyCrossCheck, setVerifyCrossCheck] = useState(false);

  // Step 3: Tiến trình & Duyệt bản nháp
  const [activeJob, setActiveJob] = useState<AiGenerationJob | null>(null);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<number>>(new Set());
  const [filterDiff, setFilterDiff] = useState<'all' | AiDifficulty>('all');
  const [filterType, setFilterType] = useState<'all' | AiQuestionType>('all');
  const [submittingJob, setSubmittingJob] = useState(false);
  const [acceptingDrafts, setAcceptingDrafts] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setWizardError(null);
    if (initialJobId) {
      setStep(3);
      void fetchJobDetails(initialJobId, true);
    } else {
      setStep(1);
      setActiveJob(null);
      void loadClassDocs();
    }
  }, [open, classId, initialJobId]);

  const loadClassDocs = async () => {
    setLoadingDocs(true);
    try {
      const res = await aiApi.getDocsStatus(classId);
      const list = res.data.data.docs || [];
      setDocsStatus(list);
      setGeminiConfigured(res.data.data.geminiConfigured);

      const readyIds = list.filter((d) => d.status === 'ready').map((d) => d.docId);
      if (initialDocIds && initialDocIds.length > 0) {
        const validInit = initialDocIds.filter((id) => readyIds.includes(id));
        setSelectedDocIds(validInit.length > 0 ? validInit : readyIds.slice(0, 1));
      } else if (selectedDocIds.length === 0 && readyIds.length > 0) {
        setSelectedDocIds(readyIds.slice(0, 1));
      }
    } catch (err: any) {
      setWizardError(
        err.response?.data?.error || 'Không thể tải danh sách tài liệu của lớp.',
      );
    } finally {
      setLoadingDocs(false);
    }
  };

  // Polling job mỗi 2 giây khi đang queued hoặc running
  useEffect(() => {
    if (!open || step !== 3 || !activeJob) return;
    if (activeJob.status !== 'queued' && activeJob.status !== 'running') return;

    const timer = window.setInterval(() => {
      void fetchJobDetails(activeJob.id, false);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [open, step, activeJob?.id, activeJob?.status]);

  const fetchJobDetails = async (jobId: number, autoSelectClean: boolean) => {
    try {
      const res = await aiApi.getQuestionJob(jobId);
      const jobData = res.data.data;
      setActiveJob(jobData);

      const drafts = jobData.drafts || [];
      if (autoSelectClean || jobData.status === 'done') {
        setSelectedDraftIds((prev) => {
          if (prev.size > 0 && !autoSelectClean) return prev;
          const cleanIds = drafts
            .filter(
              (d) =>
                d.status === 'draft' &&
                (!d.qualityFlags || d.qualityFlags.length === 0),
            )
            .map((d) => d.id);
          return new Set(cleanIds);
        });
      }
    } catch (err: any) {
      setWizardError(
        err.response?.data?.error || 'Không thể tải tiến độ tạo câu hỏi AI.',
      );
    }
  };

  const totalQuestionsRequested = useMemo(() => {
    let sum = 0;
    for (const qt of ['single_choice', 'multiple_choice', 'essay'] as AiQuestionType[]) {
      if (enabledTypes[qt]) {
        sum +=
          (matrix[qt].easy || 0) +
          (matrix[qt].medium || 0) +
          (matrix[qt].hard || 0);
      }
    }
    return sum;
  }, [enabledTypes, matrix]);

  const adjustMatrixCount = (
    qt: AiQuestionType,
    diff: AiDifficulty,
    delta: number,
  ) => {
    setMatrix((prev) => {
      const cur = prev[qt][diff] || 0;
      const next = Math.max(0, Math.min(50, cur + delta));
      return {
        ...prev,
        [qt]: {
          ...prev[qt],
          [diff]: next,
        },
      };
    });
  };

  const handleStartGeneration = async () => {
    if (submittingJob) return;
    setWizardError(null);

    if (totalQuestionsRequested <= 0) {
      setWizardError('Vui lòng chọn ít nhất 1 câu hỏi cần tạo.');
      return;
    }
    if (totalQuestionsRequested > 50) {
      setWizardError('Tổng số câu hỏi mỗi lần tạo tối đa là 50 câu.');
      return;
    }

    const effectiveMatrix = {
      single_choice: enabledTypes.single_choice
        ? matrix.single_choice
        : { easy: 0, medium: 0, hard: 0 },
      multiple_choice: enabledTypes.multiple_choice
        ? matrix.multiple_choice
        : { easy: 0, medium: 0, hard: 0 },
      essay: enabledTypes.essay
        ? matrix.essay
        : { easy: 0, medium: 0, hard: 0 },
    };

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    setSubmittingJob(true);
    try {
      const res = await aiApi.createQuestionJob(classId, {
        docIds: selectedDocIds,
        config: {
          matrix: effectiveMatrix,
          optionCount,
          chapter: chapter.trim() || null,
          tags,
          pointsByDifficulty: pointsByDiff,
          language,
          extraInstruction: extraInstruction.trim() || null,
          verify: verifyCrossCheck,
          docScopes,
        },
      });
      setActiveJob(res.data.data);
      setSelectedDraftIds(new Set());
      setStep(3);
    } catch (err: any) {
      setWizardError(
        err.response?.data?.error || 'Không thể bắt đầu tiến trình tạo câu hỏi bằng AI.',
      );
    } finally {
      setSubmittingJob(false);
    }
  };

  const handleCancelJob = async () => {
    if (!activeJob) return;
    try {
      const res = await aiApi.cancelQuestionJob(activeJob.id);
      setActiveJob(res.data.data);
    } catch {
      // ignore
    }
  };

  const handleUpdateDraft = async (
    draftId: number,
    patch: {
      difficulty: AiDifficulty;
      content: string;
      explanation: string | null;
      chapter: string | null;
      defaultPoints: number;
      options: AiDraftOption[];
    },
  ) => {
    const res = await aiApi.updateDraft(draftId, patch);
    const updated = res.data.data;
    setActiveJob((prev) =>
      prev
        ? {
            ...prev,
            drafts: (prev.drafts || []).map((d) =>
              d.id === draftId ? updated : d,
            ),
          }
        : null,
    );
  };

  const handleRegenerateDraft = async (draftId: number) => {
    setWizardError(null);
    try {
      const res = await aiApi.regenerateDraft(draftId);
      const updated = res.data.data;
      setActiveJob((prev) =>
        prev
          ? {
              ...prev,
              drafts: (prev.drafts || []).map((d) =>
                d.id === draftId ? updated : d,
              ),
            }
          : null,
      );
    } catch (err: any) {
      setWizardError(
        err.response?.data?.error || 'Không thể sinh lại câu hỏi này.',
      );
    }
  };

  const handleDiscardDraft = async (draftId: number) => {
    try {
      await aiApi.discardDrafts([draftId]);
      setSelectedDraftIds((prev) => {
        const next = new Set(prev);
        next.delete(draftId);
        return next;
      });
      setActiveJob((prev) =>
        prev
          ? {
              ...prev,
              drafts: (prev.drafts || []).map((d) =>
                d.id === draftId ? { ...d, status: 'discarded' } : d,
              ),
            }
          : null,
      );
    } catch (err: any) {
      setWizardError(err.response?.data?.error || 'Không thể loại bỏ bản nháp.');
    }
  };

  const handleAcceptSelected = async () => {
    const ids = Array.from(selectedDraftIds);
    if (ids.length === 0 || acceptingDrafts) return;

    setAcceptingDrafts(true);
    setWizardError(null);
    try {
      const res = await aiApi.acceptDrafts(ids);
      const count = res.data.data.acceptedCount;
      onAcceptedSuccess(count);
      onClose();
    } catch (err: any) {
      setWizardError(
        err.response?.data?.error || 'Không thể thêm các câu hỏi đã chọn vào ngân hàng.',
      );
    } finally {
      setAcceptingDrafts(false);
    }
  };

  if (!open) return null;

  const readyDocs = docsStatus.filter((d) => d.status === 'ready');
  const allDrafts: AiQuestionDraft[] = (activeJob?.drafts || []).filter(
    (d) => d.status !== 'discarded',
  );
  const filteredDrafts = allDrafts.filter((d) => {
    const matchDiff = filterDiff === 'all' || d.difficulty === filterDiff;
    const matchType = filterType === 'all' || d.questionType === filterType;
    return matchDiff && matchType;
  });

  const cleanDraftIds = allDrafts
    .filter(
      (d) =>
        d.status === 'draft' &&
        (!d.qualityFlags || d.qualityFlags.length === 0),
    )
    .map((d) => d.id);

  const allCleanSelected =
    cleanDraftIds.length > 0 &&
    cleanDraftIds.every((id) => selectedDraftIds.has(id));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: 16,
      }}
    >
      <div
        style={{
          background: '#FFFFFF',
          width: 'min(920px, 100%)',
          maxHeight: '90vh',
          borderRadius: 16,
          boxShadow: '0 20px 50px rgba(15, 23, 42, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ── Modal Header & Stepper ── */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
            background: '#F8FAFC',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>✨</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0F172A' }}>
                Tạo câu hỏi bằng AI (Gemini 2.5 Flash)
              </h2>
              <div style={{ fontSize: 12, color: '#64748B' }}>
                Biên soạn câu hỏi theo thang nhận thức Bloom kèm trích dẫn tài liệu lớp
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {[
              { n: 1, label: '① Nguồn tài liệu' },
              { n: 2, label: '② Cấu hình' },
              { n: 3, label: '③ Duyệt & Thêm' },
            ].map((s) => (
              <div
                key={s.n}
                style={{
                  padding: '5px 12px',
                  borderRadius: 9999,
                  fontSize: 12,
                  fontWeight: 700,
                  background:
                    step === s.n
                      ? '#4F46E5'
                      : step > s.n
                        ? '#DCFCE7'
                        : '#E2E8F0',
                  color:
                    step === s.n
                      ? '#FFFFFF'
                      : step > s.n
                        ? '#15803D'
                        : '#64748B',
                }}
              >
                {s.label}
              </div>
            ))}
            <button
              type="button"
              onClick={onClose}
              style={{
                marginLeft: 8,
                border: 'none',
                background: 'transparent',
                fontSize: 18,
                color: '#64748B',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {wizardError && (
          <div
            style={{
              margin: '12px 24px 0',
              padding: '10px 14px',
              borderRadius: 10,
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              color: '#B91C1C',
              fontSize: 13,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>⚠️ {wizardError}</span>
            <button
              type="button"
              onClick={() => setWizardError(null)}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#B91C1C',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {!geminiConfigured && (
          <div
            style={{
              margin: '12px 24px 0',
              padding: '10px 14px',
              borderRadius: 10,
              background: '#FFFBEB',
              border: '1px solid #FDE68A',
              color: '#92400E',
              fontSize: 13,
            }}
          >
            ⚠️ Máy chủ chưa có <code>GEMINI_API_KEY</code> trong <code>backend/.env</code>. Vui lòng thêm khóa API trước khi chạy tạo câu hỏi.
          </div>
        )}

        {/* ── Body Content ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {/* ================= STEP 1: CHỌN NGUỒN ================= */}
          {step === 1 && (
            <div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: '#0F172A',
                  marginBottom: 12,
                }}
              >
                Chọn tài liệu nguồn của lớp ({selectedDocIds.length}/{readyDocs.length} tài liệu sẵn sàng)
              </div>

              {loadingDocs ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#64748B' }}>
                  Đang kiểm tra trạng thái tài liệu...
                </div>
              ) : docsStatus.length === 0 ? (
                <div
                  style={{
                    padding: 28,
                    textAlign: 'center',
                    background: '#F8FAFC',
                    borderRadius: 12,
                    border: '1px dashed #CBD5E1',
                    color: '#64748B',
                  }}
                >
                  Lớp học chưa có tài liệu đính kèm nào. Hãy sang tab "Tài liệu lớp học" để đính kèm giáo trình trước.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {docsStatus.map((doc) => {
                    const isReady = doc.status === 'ready';
                    const isSelected = selectedDocIds.includes(doc.docId);
                    const scope = docScopes[doc.docId] || {
                      mode: 'all',
                      headings: [],
                      pageFrom: 1,
                      pageTo: doc.pageCount || 10,
                    };

                    return (
                      <div
                        key={doc.docId}
                        style={{
                          padding: '12px 14px',
                          borderRadius: 12,
                          border: isSelected
                            ? '2px solid #4F46E5'
                            : '1px solid #E2E8F0',
                          background: isSelected ? '#F5F3FF' : '#FFFFFF',
                          opacity: isReady ? 1 : 0.65,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                            flexWrap: 'wrap',
                          }}
                        >
                          <label
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              cursor: isReady ? 'pointer' : 'not-allowed',
                              flex: 1,
                            }}
                          >
                            <input
                              type="checkbox"
                              disabled={!isReady}
                              checked={isSelected}
                              onChange={() => {
                                if (!isReady) return;
                                setSelectedDocIds((prev) =>
                                  prev.includes(doc.docId)
                                    ? prev.filter((id) => id !== doc.docId)
                                    : [...prev, doc.docId],
                                );
                              }}
                              style={{ width: 17, height: 17 }}
                            />
                            <div>
                              <div
                                style={{
                                  fontSize: 14,
                                  fontWeight: 700,
                                  color: '#0F172A',
                                }}
                              >
                                📄 {doc.displayFileName}
                              </div>
                              <div style={{ fontSize: 12, color: '#64748B' }}>
                                Danh mục: {doc.categoryName}
                                {doc.pageCount ? ` · ${doc.pageCount} trang` : ''}
                                {doc.chunkCount ? ` · ${doc.chunkCount} đoạn` : ''}
                              </div>
                            </div>
                          </label>

                          <span
                            style={{
                              padding: '3px 10px',
                              borderRadius: 9999,
                              fontSize: 12,
                              fontWeight: 700,
                              background:
                                doc.status === 'ready'
                                  ? '#DCFCE7'
                                  : doc.status === 'failed'
                                    ? '#FEE2E2'
                                    : doc.status === 'unsupported'
                                      ? '#F1F5F9'
                                      : '#FEF3C7',
                              color:
                                doc.status === 'ready'
                                  ? '#15803D'
                                  : doc.status === 'failed'
                                    ? '#B91C1C'
                                    : doc.status === 'unsupported'
                                      ? '#475569'
                                      : '#B45309',
                            }}
                          >
                            {doc.status === 'ready'
                              ? '✅ Sẵn sàng'
                              : doc.status === 'failed'
                                ? `⚠️ ${doc.errorCode === 'scanned_pdf' ? 'PDF ảnh scan' : 'Lỗi xử lý'}`
                                : doc.status === 'unsupported'
                                  ? '⚪ Không hỗ trợ'
                                  : '⏳ Đang xử lý'}
                          </span>
                        </div>

                        {doc.errorMessage && doc.status !== 'ready' && (
                          <div
                            style={{
                              marginTop: 6,
                              fontSize: 12,
                              color: '#B91C1C',
                            }}
                          >
                            {doc.errorMessage}
                          </div>
                        )}

                        {isReady && isSelected && (
                          <div
                            style={{
                              marginTop: 10,
                              paddingTop: 10,
                              borderTop: '1px dashed #CBD5E1',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              flexWrap: 'wrap',
                              fontSize: 12.5,
                            }}
                          >
                            <span style={{ fontWeight: 700, color: '#334155' }}>
                              Phạm vi trích xuất:
                            </span>
                            <select
                              value={scope.mode}
                              onChange={(e) =>
                                setDocScopes({
                                  ...docScopes,
                                  [doc.docId]: {
                                    ...scope,
                                    mode: e.target.value as DocScopeState['mode'],
                                  },
                                })
                              }
                              style={{
                                padding: '5px 10px',
                                borderRadius: 8,
                                border: '1px solid #CBD5E1',
                                fontSize: 12.5,
                              }}
                            >
                              <option value="all">Toàn bộ tài liệu</option>
                              <option value="pages">Khoảng trang cụ thể</option>
                              {doc.headings.length > 0 && (
                                <option value="heading">Theo mục / chương</option>
                              )}
                            </select>

                            {scope.mode === 'pages' && (
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                }}
                              >
                                <span>Từ trang</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={doc.pageCount || 999}
                                  value={scope.pageFrom}
                                  onChange={(e) =>
                                    setDocScopes({
                                      ...docScopes,
                                      [doc.docId]: {
                                        ...scope,
                                        pageFrom: Number(e.target.value) || 1,
                                      },
                                    })
                                  }
                                  style={{
                                    width: 65,
                                    padding: '4px 8px',
                                    borderRadius: 6,
                                    border: '1px solid #CBD5E1',
                                  }}
                                />
                                <span>đến</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={doc.pageCount || 999}
                                  value={scope.pageTo}
                                  onChange={(e) =>
                                    setDocScopes({
                                      ...docScopes,
                                      [doc.docId]: {
                                        ...scope,
                                        pageTo: Number(e.target.value) || 1,
                                      },
                                    })
                                  }
                                  style={{
                                    width: 65,
                                    padding: '4px 8px',
                                    borderRadius: 6,
                                    border: '1px solid #CBD5E1',
                                  }}
                                />
                              </div>
                            )}

                            {scope.mode === 'heading' && doc.headings.length > 0 && (
                              <select
                                value={scope.headings[0] || ''}
                                onChange={(e) =>
                                  setDocScopes({
                                    ...docScopes,
                                    [doc.docId]: {
                                      ...scope,
                                      headings: e.target.value
                                        ? [e.target.value]
                                        : [],
                                    },
                                  })
                                }
                                style={{
                                  padding: '5px 10px',
                                  borderRadius: 8,
                                  border: '1px solid #CBD5E1',
                                  maxWidth: 320,
                                }}
                              >
                                <option value="">-- Chọn mục/chương --</option>
                                {doc.headings.map((h) => (
                                  <option key={h} value={h}>
                                    {h}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ================= STEP 2: CẤU HÌNH MA TRẬN ================= */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div
                style={{
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12,
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>
                    Loại câu hỏi & Số lượng theo mức độ (Thang Bloom)
                  </div>
                  <span
                    style={{
                      padding: '4px 12px',
                      borderRadius: 9999,
                      fontSize: 13,
                      fontWeight: 800,
                      background:
                        totalQuestionsRequested > 50 ? '#FEE2E2' : '#EEF2FF',
                      color:
                        totalQuestionsRequested > 50 ? '#DC2626' : '#4F46E5',
                    }}
                  >
                    Tổng: {totalQuestionsRequested}/50 câu
                  </span>
                </div>

                {(
                  [
                    {
                      key: 'single_choice' as AiQuestionType,
                      label: 'Trắc nghiệm 1 đáp án đúng',
                    },
                    {
                      key: 'multiple_choice' as AiQuestionType,
                      label: 'Trắc nghiệm nhiều đáp án đúng',
                    },
                    {
                      key: 'essay' as AiQuestionType,
                      label: 'Tự luận (kèm đáp án mẫu & rubric chấm)',
                    },
                  ] as const
                ).map((row) => {
                  const enabled = enabledTypes[row.key];
                  return (
                    <div
                      key={row.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: enabled ? '#FFFFFF' : 'transparent',
                        border: enabled
                          ? '1px solid #CBD5E1'
                          : '1px solid transparent',
                        marginBottom: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontWeight: 700,
                          fontSize: 13.5,
                          color: '#0F172A',
                          cursor: 'pointer',
                          minWidth: 230,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) =>
                            setEnabledTypes({
                              ...enabledTypes,
                              [row.key]: e.target.checked,
                            })
                          }
                          style={{ width: 16, height: 16 }}
                        />
                        {row.label}
                      </label>

                      {enabled && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 16,
                            flexWrap: 'wrap',
                          }}
                        >
                          {(
                            [
                              { d: 'easy' as AiDifficulty, label: '🟢 Dễ' },
                              { d: 'medium' as AiDifficulty, label: '🟠 TB' },
                              { d: 'hard' as AiDifficulty, label: '🔴 Khó' },
                            ] as const
                          ).map((item) => (
                            <div
                              key={item.d}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  color: '#475569',
                                }}
                              >
                                {item.label}:
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  adjustMatrixCount(row.key, item.d, -1)
                                }
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: 6,
                                  border: '1px solid #CBD5E1',
                                  background: '#F8FAFC',
                                  cursor: 'pointer',
                                  fontWeight: 700,
                                }}
                              >
                                −
                              </button>
                              <input
                                type="number"
                                min={0}
                                max={50}
                                value={matrix[row.key][item.d]}
                                onChange={(e) =>
                                  setMatrix({
                                    ...matrix,
                                    [row.key]: {
                                      ...matrix[row.key],
                                      [item.d]: Math.max(
                                        0,
                                        Math.min(50, Number(e.target.value) || 0),
                                      ),
                                    },
                                  })
                                }
                                style={{
                                  width: 46,
                                  textAlign: 'center',
                                  padding: '4px',
                                  borderRadius: 6,
                                  border: '1px solid #CBD5E1',
                                  fontWeight: 700,
                                  fontSize: 13,
                                }}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  adjustMatrixCount(row.key, item.d, 1)
                                }
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: 6,
                                  border: '1px solid #CBD5E1',
                                  background: '#F8FAFC',
                                  cursor: 'pointer',
                                  fontWeight: 700,
                                }}
                              >
                                +
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Cài đặt phương án, điểm, chương, ngôn ngữ */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: 14,
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#334155',
                      marginBottom: 6,
                    }}
                  >
                    Số phương án (câu trắc nghiệm)
                  </label>
                  <div style={{ display: 'flex', gap: 14 }}>
                    {[4, 5].map((n) => (
                      <label
                        key={n}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 13.5,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="radio"
                          checked={optionCount === n}
                          onChange={() => setOptionCount(n as 4 | 5)}
                        />
                        {n} phương án (A–{n === 4 ? 'D' : 'E'})
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#334155',
                      marginBottom: 6,
                    }}
                  >
                    Ngôn ngữ câu hỏi
                  </label>
                  <div style={{ display: 'flex', gap: 14 }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 13.5,
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="radio"
                        checked={language === 'vi'}
                        onChange={() => setLanguage('vi')}
                      />
                      Tiếng Việt
                    </label>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 13.5,
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="radio"
                        checked={language === 'en'}
                        onChange={() => setLanguage('en')}
                      />
                      English
                    </label>
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 14,
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#334155',
                      marginBottom: 6,
                    }}
                  >
                    Chương / Chủ đề gán vào câu hỏi
                  </label>
                  <input
                    type="text"
                    list="ai-wizard-chapters"
                    placeholder="Để trống để AI tự lấy theo mục tài liệu..."
                    value={chapter}
                    onChange={(e) => setChapter(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: 8,
                      border: '1px solid #CBD5E1',
                      fontSize: 13.5,
                    }}
                  />
                  <datalist id="ai-wizard-chapters">
                    {availableChapters.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#334155',
                      marginBottom: 6,
                    }}
                  >
                    Điểm mặc định (Dễ / TB / Khó)
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['easy', 'medium', 'hard'] as AiDifficulty[]).map((d) => (
                      <input
                        key={d}
                        type="number"
                        step="0.25"
                        min="0.25"
                        value={pointsByDiff[d]}
                        onChange={(e) =>
                          setPointsByDiff({
                            ...pointsByDiff,
                            [d]: Number(e.target.value) || 1,
                          })
                        }
                        style={{
                          flex: 1,
                          padding: '9px 8px',
                          borderRadius: 8,
                          border: '1px solid #CBD5E1',
                          fontSize: 13,
                          textAlign: 'center',
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#334155',
                      marginBottom: 6,
                    }}
                  >
                    Thẻ (Tags, cách nhau bởi dấu phẩy)
                  </label>
                  <input
                    type="text"
                    placeholder="VD: giữa kỳ, chương 1, socket"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: 8,
                      border: '1px solid #CBD5E1',
                      fontSize: 13.5,
                    }}
                  />
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#334155',
                    marginBottom: 6,
                  }}
                >
                  Yêu cầu bổ sung cho AI (tùy chọn)
                </label>
                <textarea
                  rows={2}
                  placeholder="VD: Tập trung vào bài toán phân tích tình huống thực tế và giao thức TCP/UDP, tránh hỏi các thông tin lịch sử..."
                  value={extraInstruction}
                  onChange={(e) => setExtraInstruction(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: 13.5,
                  }}
                />
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  fontSize: 13,
                  color: '#334155',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={verifyCrossCheck}
                  onChange={(e) => setVerifyCrossCheck(e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                <span>
                  <strong>Kiểm tra chéo đáp án bằng lượt gọi AI thứ hai</strong>{' '}
                  (mặc định tắt; bật sẽ chậm hơn ~30% nhưng giúp phát hiện câu hỏi mơ hồ)
                </span>
              </label>
            </div>
          )}

          {/* ================= STEP 3: DUYỆT BẢN NHÁP ================= */}
          {step === 3 && activeJob && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Thanh tiến độ */}
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: 12,
                  background:
                    activeJob.status === 'failed' ? '#FEF2F2' : '#EEF2FF',
                  border:
                    activeJob.status === 'failed'
                      ? '1px solid #FECACA'
                      : '1px solid #C7D2FE',
                }}
              >
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
                      fontSize: 13.5,
                      fontWeight: 700,
                      color:
                        activeJob.status === 'failed' ? '#B91C1C' : '#3730A3',
                    }}
                  >
                    {activeJob.status === 'running' ||
                    activeJob.status === 'queued'
                      ? `⏳ Đang biên soạn câu hỏi từ tài liệu... (${activeJob.progress}%) — Bạn có thể đóng cửa sổ, kết quả vẫn được lưu lại.`
                      : activeJob.status === 'done'
                        ? `✅ Đã tạo xong ${allDrafts.length} bản nháp câu hỏi`
                        : activeJob.status === 'cancelled'
                          ? '⏹ Đã hủy tiến trình'
                          : `⚠️ Lỗi: ${activeJob.errorMessage || 'Không thể hoàn tất'}`}
                  </span>

                  {(activeJob.status === 'queued' ||
                    activeJob.status === 'running') && (
                    <button
                      type="button"
                      onClick={() => void handleCancelJob()}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        border: '1px solid #FCA5A5',
                        background: '#FFFFFF',
                        color: '#DC2626',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Hủy
                    </button>
                  )}
                </div>

                <div
                  style={{
                    height: 8,
                    borderRadius: 9999,
                    background: '#E0E7FF',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${activeJob.progress}%`,
                      height: '100%',
                      background:
                        activeJob.status === 'failed' ? '#EF4444' : '#4F46E5',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>

              {/* Thanh lọc & Chọn tất cả câu hợp lệ */}
              {allDrafts.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                    padding: '8px 12px',
                    background: '#F8FAFC',
                    borderRadius: 10,
                    border: '1px solid #E2E8F0',
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(
                      [
                        { k: 'all', label: `Tất cả (${allDrafts.length})` },
                        {
                          k: 'easy',
                          label: `🟢 Dễ (${allDrafts.filter((d) => d.difficulty === 'easy').length})`,
                        },
                        {
                          k: 'medium',
                          label: `🟠 TB (${allDrafts.filter((d) => d.difficulty === 'medium').length})`,
                        },
                        {
                          k: 'hard',
                          label: `🔴 Khó (${allDrafts.filter((d) => d.difficulty === 'hard').length})`,
                        },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.k}
                        type="button"
                        onClick={() => setFilterDiff(tab.k)}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 8,
                          border:
                            filterDiff === tab.k
                              ? '1px solid #4F46E5'
                              : '1px solid #CBD5E1',
                          background:
                            filterDiff === tab.k ? '#EEF2FF' : '#FFFFFF',
                          color: filterDiff === tab.k ? '#4F46E5' : '#334155',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}

                    <select
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value as any)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 8,
                        border: '1px solid #CBD5E1',
                        fontSize: 12,
                      }}
                    >
                      <option value="all">Mọi loại câu hỏi</option>
                      <option value="single_choice">Một đáp án</option>
                      <option value="multiple_choice">Nhiều đáp án</option>
                      <option value="essay">Tự luận</option>
                    </select>
                  </div>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: '#1E293B',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={allCleanSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedDraftIds(new Set(cleanDraftIds));
                        } else {
                          setSelectedDraftIds(new Set());
                        }
                      }}
                    />
                    Chọn tất cả câu hợp lệ ({cleanDraftIds.length})
                  </label>
                </div>
              )}

              {/* Danh sách thẻ bản nháp */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {filteredDrafts.map((draft, idx) => (
                  <AiDraftCard
                    key={draft.id}
                    index={idx}
                    draft={draft}
                    selected={selectedDraftIds.has(draft.id)}
                    onToggleSelect={(id) => {
                      setSelectedDraftIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      });
                    }}
                    onUpdateDraft={handleUpdateDraft}
                    onRegenerateDraft={handleRegenerateDraft}
                    onDiscardDraft={handleDiscardDraft}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Modal Footer ── */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid #E2E8F0',
            background: '#F8FAFC',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            {step === 2 && (
              <button
                type="button"
                onClick={() => setStep(1)}
                style={{
                  padding: '9px 16px',
                  borderRadius: 10,
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#334155',
                  fontWeight: 600,
                  fontSize: 13.5,
                  cursor: 'pointer',
                }}
              >
                ← Quay lại chọn nguồn
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                onClick={() => {
                  setStep(2);
                }}
                style={{
                  padding: '9px 16px',
                  borderRadius: 10,
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#334155',
                  fontWeight: 600,
                  fontSize: 13.5,
                  cursor: 'pointer',
                }}
              >
                + Tạo lượt mới
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '9px 16px',
                borderRadius: 10,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#334155',
                fontWeight: 600,
                fontSize: 13.5,
                cursor: 'pointer',
              }}
            >
              {step === 3 ? 'Lưu nháp & Đóng' : 'Đóng'}
            </button>

            {step === 1 && (
              <button
                type="button"
                disabled={selectedDocIds.length === 0}
                onClick={() => setStep(2)}
                style={{
                  padding: '9px 20px',
                  borderRadius: 10,
                  border: 'none',
                  background:
                    selectedDocIds.length === 0 ? '#CBD5E1' : '#4F46E5',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: 13.5,
                  cursor:
                    selectedDocIds.length === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                Tiếp tục cấu hình →
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                disabled={submittingJob || totalQuestionsRequested <= 0}
                onClick={() => void handleStartGeneration()}
                style={{
                  padding: '9px 22px',
                  borderRadius: 10,
                  border: 'none',
                  background:
                    submittingJob || totalQuestionsRequested <= 0
                      ? '#CBD5E1'
                      : 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: 13.5,
                  cursor:
                    submittingJob || totalQuestionsRequested <= 0
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                {submittingJob
                  ? 'Đang khởi tạo...'
                  : `✨ Bắt đầu tạo ${totalQuestionsRequested} câu hỏi`}
              </button>
            )}

            {step === 3 && (
              <button
                type="button"
                disabled={selectedDraftIds.size === 0 || acceptingDrafts}
                onClick={() => void handleAcceptSelected()}
                style={{
                  padding: '9px 22px',
                  borderRadius: 10,
                  border: 'none',
                  background:
                    selectedDraftIds.size === 0 || acceptingDrafts
                      ? '#CBD5E1'
                      : '#16A34A',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: 13.5,
                  cursor:
                    selectedDraftIds.size === 0 || acceptingDrafts
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                {acceptingDrafts
                  ? 'Đang thêm vào ngân hàng...'
                  : `➕ Thêm ${selectedDraftIds.size} câu vào ngân hàng`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
