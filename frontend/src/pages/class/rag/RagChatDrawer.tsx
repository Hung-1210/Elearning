import React, { useState, useEffect, useRef } from 'react';
import { aiApi } from '../../../api';
import type {
  DocIngestionStatus,
  RagConversation,
  RagMessage,
} from '../../../types';
import { CitationChip, RagMarkdownRenderer } from './CitationChip';

interface RagChatDrawerProps {
  open: boolean;
  onClose: () => void;
  classId: number;
  className: string;
  docsStatus: DocIngestionStatus[];
  geminiConfigured: boolean;
}

export const RagChatDrawer: React.FC<RagChatDrawerProps> = ({
  open,
  onClose,
  classId,
  className,
  docsStatus,
  geminiConfigured,
}) => {
  const [conversations, setConversations] = useState<RagConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<RagMessage[]>([]);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [examLock, setExamLock] = useState<{
    locked: boolean;
    examName: string | null;
    deadlineAt: string | null;
  }>({ locked: false, examName: null, deadlineAt: null });

  const [showHistory, setShowHistory] = useState(false);
  const [showScopeDropdown, setShowScopeDropdown] = useState(false);
  const [selectedDocScope, setSelectedDocScope] = useState<number[]>([]); // rỗng = tất cả
  const [editingConvId, setEditingConvId] = useState<number | null>(null);
  const [editTitleVal, setEditTitleVal] = useState('');

  const [inputQuestion, setInputQuestion] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<number | null>(null);
  const [highlightedCitation, setHighlightedCitation] = useState<{
    msgId: number;
    n: number;
  } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const readyDocs = docsStatus.filter((d) => d.status === 'ready');

  useEffect(() => {
    if (!open) return;
    void loadInitialData();
  }, [open, classId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const loadInitialData = async () => {
    setErrorBanner(null);
    try {
      const [convRes, sugRes] = await Promise.all([
        aiApi.listConversations(classId),
        aiApi.getSuggestedQuestions(classId).catch(() => null),
      ]);

      const lockInfo = convRes.data.data.examLock;
      setExamLock(lockInfo);
      const list = convRes.data.data.conversations || [];
      setConversations(list);

      if (sugRes?.data?.data?.questions) {
        setSuggestedQuestions(sugRes.data.data.questions);
      }

      if (list.length > 0) {
        const first = list[0];
        setActiveConvId(first.id);
        setSelectedDocScope(first.docScope ?? []);
        await loadMessages(first.id);
      } else {
        setActiveConvId(null);
        setMessages([]);
        setSelectedDocScope([]);
      }
    } catch (err: any) {
      setErrorBanner(
        err.response?.data?.error || 'Không thể tải dữ liệu Trợ giảng AI.',
      );
    }
  };

  const loadMessages = async (convId: number) => {
    try {
      const res = await aiApi.getConversationMessages(convId);
      setMessages(res.data.data.messages || []);
      setSelectedDocScope(res.data.data.conversation?.docScope ?? []);
    } catch (err: any) {
      setErrorBanner(
        err.response?.data?.error || 'Không thể tải lịch sử tin nhắn.',
      );
    }
  };

  const handleNewConversation = async () => {
    setErrorBanner(null);
    try {
      const res = await aiApi.createConversation(classId, {
        title: 'Cuộc trò chuyện mới',
        docScope: selectedDocScope.length > 0 ? selectedDocScope : null,
      });
      const created = res.data.data;
      setConversations((prev) => [created, ...prev]);
      setActiveConvId(created.id);
      setMessages([]);
      setShowHistory(false);
    } catch (err: any) {
      setErrorBanner(
        err.response?.data?.error || 'Không thể tạo cuộc trò chuyện mới.',
      );
    }
  };

  const handleSelectConversation = async (conv: RagConversation) => {
    if (streaming) handleStopStream();
    setActiveConvId(conv.id);
    setSelectedDocScope(conv.docScope ?? []);
    setShowHistory(false);
    await loadMessages(conv.id);
  };

  const handleDeleteConversation = async (convId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Xóa cuộc trò chuyện này?')) return;
    try {
      await aiApi.deleteConversation(convId);
      const remaining = conversations.filter((c) => c.id !== convId);
      setConversations(remaining);
      if (activeConvId === convId) {
        if (remaining.length > 0) {
          setActiveConvId(remaining[0].id);
          await loadMessages(remaining[0].id);
        } else {
          setActiveConvId(null);
          setMessages([]);
        }
      }
    } catch {
      // ignore
    }
  };

  const handleRenameConversation = async (convId: number) => {
    const trimmed = editTitleVal.trim();
    setEditingConvId(null);
    if (!trimmed) return;
    try {
      const res = await aiApi.updateConversation(convId, { title: trimmed });
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? res.data.data : c)),
      );
    } catch {
      // ignore
    }
  };

  const handleToggleDocInScope = (docId: number) => {
    setSelectedDocScope((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId],
    );
  };

  const handleStopStream = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStreaming(false);
  };

  const handleSendQuestion = async (textOverride?: string) => {
    const questionText = (textOverride ?? inputQuestion).trim();
    if (!questionText || streaming || examLock.locked) return;

    setErrorBanner(null);
    if (!textOverride) setInputQuestion('');

    let convId = activeConvId;
    if (!convId) {
      try {
        const createdRes = await aiApi.createConversation(classId, {
          title: questionText.slice(0, 75),
          docScope: selectedDocScope.length > 0 ? selectedDocScope : null,
        });
        const created = createdRes.data.data;
        setConversations((prev) => [created, ...prev]);
        convId = created.id;
        setActiveConvId(convId);
      } catch (err: any) {
        setErrorBanner(
          err.response?.data?.error || 'Không thể khởi tạo cuộc trò chuyện.',
        );
        return;
      }
    }

    const tempUserId = Date.now();
    const tempAssistantId = tempUserId + 1;
    const nowIso = new Date().toISOString();

    setMessages((prev) => [
      ...prev,
      {
        id: tempUserId,
        conversationId: convId!,
        role: 'user',
        content: questionText,
        citations: [],
        grounded: true,
        createdAt: nowIso,
      },
      {
        id: tempAssistantId,
        conversationId: convId!,
        role: 'assistant',
        content: '',
        citations: [],
        grounded: true,
        createdAt: nowIso,
        streaming: true,
      },
    ]);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setStreaming(true);

    try {
      await aiApi.streamRagChat({
        conversationId: convId,
        question: questionText,
        docScope: selectedDocScope.length > 0 ? selectedDocScope : null,
        signal: controller.signal,
        onMeta: (meta) => {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === meta.conversationId ? { ...c, title: meta.title } : c,
            ),
          );
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempUserId ? { ...m, id: meta.userMessageId } : m,
            ),
          );
        },
        onDelta: (delta) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAssistantId
                ? { ...m, content: m.content + delta }
                : m,
            ),
          );
        },
        onCitations: ({ citations, grounded }) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAssistantId
                ? { ...m, citations, grounded }
                : m,
            ),
          );
        },
        onDone: (done) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAssistantId
                ? {
                    ...m,
                    id: done.assistantMessageId || m.id,
                    grounded: done.grounded,
                    latencyMs: done.latencyMs,
                    streaming: false,
                  }
                : m,
            ),
          );
        },
        onError: (err) => {
          setErrorBanner(err.message);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAssistantId
                ? {
                    ...m,
                    content: `⚠️ Lỗi: ${err.message}`,
                    grounded: false,
                    streaming: false,
                  }
                : m,
            ),
          );
        },
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setErrorBanner(err?.message || 'Kết nối tới Trợ giảng AI bị gián đoạn.');
      }
    } finally {
      setStreaming(false);
      abortControllerRef.current = null;
      setMessages((prev) =>
        prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
      );
    }
  };

  const handleFeedback = async (msg: RagMessage, val: -1 | 1) => {
    const nextVal = msg.feedback === val ? null : val;
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, feedback: nextVal } : m)),
    );
    try {
      await aiApi.setMessageFeedback(msg.id, nextVal);
    } catch {
      // ignore
    }
  };

  const handleCopyMessage = (msg: RagMessage) => {
    navigator.clipboard.writeText(msg.content);
    setCopiedMsgId(msg.id);
    window.setTimeout(() => setCopiedMsgId(null), 1800);
  };

  if (!open) return null;

  const scopeLabel =
    selectedDocScope.length === 0
      ? `Tất cả ${readyDocs.length} tài liệu`
      : `${selectedDocScope.length}/${readyDocs.length} tài liệu đã chọn`;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(460px, 100vw)',
        background: '#FFFFFF',
        borderLeft: '1px solid #E2E8F0',
        boxShadow: '-8px 0 30px rgba(15, 23, 42, 0.12)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ── Top Header ── */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid #E2E8F0',
          background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
            💬
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Trợ giảng AI (RAG)</div>
            <div style={{ fontSize: 11, opacity: 0.9 }}>
              {className} · Gemini 2.5 Flash
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={handleNewConversation}
            title="Cuộc trò chuyện mới"
            style={{
              border: '1px solid rgba(255,255,255,0.35)',
              background: 'rgba(255,255,255,0.15)',
              color: '#FFFFFF',
              borderRadius: 8,
              padding: '5px 10px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Mới
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none',
              background: 'rgba(255,255,255,0.15)',
              color: '#FFFFFF',
              width: 30,
              height: 30,
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 15,
            }}
            title="Đóng"
          >
            ✕
          </button>
        </div>
      </div>

      {/* ── Sub-toolbar: Lịch sử & Phạm vi tài liệu ── */}
      <div
        style={{
          padding: '8px 14px',
          borderBottom: '1px solid #E2E8F0',
          background: '#F8FAFC',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          position: 'relative',
        }}
      >
        <button
          type="button"
          onClick={() => {
            setShowHistory((prev) => !prev);
            setShowScopeDropdown(false);
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid #CBD5E1',
            background: showHistory ? '#EEF2FF' : '#FFFFFF',
            color: showHistory ? '#4F46E5' : '#334155',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          ☰ Lịch sử ({conversations.length})
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
          {selectedDocScope.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedDocScope([])}
              title="Bỏ lọc, tìm kiếm trên toàn bộ tài liệu của lớp"
              style={{
                padding: '5px 8px',
                borderRadius: 8,
                border: '1px solid #C7D2FE',
                background: '#EEF2FF',
                color: '#4F46E5',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Tìm tất cả ({readyDocs.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setShowScopeDropdown((prev) => !prev);
              setShowHistory(false);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid #CBD5E1',
              background: selectedDocScope.length > 0 ? '#EEF2FF' : '#FFFFFF',
              color: selectedDocScope.length > 0 ? '#4F46E5' : '#334155',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            📚 Phạm vi: {scopeLabel} ▾
          </button>

          {showScopeDropdown && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                width: 310,
                maxHeight: 300,
                overflowY: 'auto',
                background: '#FFFFFF',
                border: '1px solid #CBD5E1',
                borderRadius: 12,
                boxShadow: '0 10px 25px rgba(15, 23, 42, 0.14)',
                padding: 10,
                zIndex: 150,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                  paddingBottom: 6,
                  borderBottom: '1px solid #F1F5F9',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>
                  Chọn tài liệu để tra cứu
                </span>
                {selectedDocScope.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedDocScope([])}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: '#4F46E5',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Chọn tất cả
                  </button>
                )}
              </div>

              {docsStatus.map((doc) => {
                const isReady = doc.status === 'ready';
                const checked =
                  selectedDocScope.length === 0
                    ? isReady
                    : selectedDocScope.includes(doc.docId);
                return (
                  <label
                    key={doc.docId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 8px',
                      borderRadius: 8,
                      fontSize: 12,
                      opacity: isReady ? 1 : 0.5,
                      cursor: isReady ? 'pointer' : 'not-allowed',
                    }}
                  >
                    <input
                      type="checkbox"
                      disabled={!isReady}
                      checked={checked}
                      onChange={() => {
                        if (!isReady) return;
                        if (selectedDocScope.length === 0) {
                          // Khi đang ở chế độ "Tất cả", bấm vào 1 tài liệu sẽ chọn riêng tài liệu đó
                          setSelectedDocScope([doc.docId]);
                        } else {
                          handleToggleDocInScope(doc.docId);
                        }
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: '#1E293B',
                      }}
                    >
                      {doc.displayFileName}
                    </span>
                    <span style={{ fontSize: 11, color: '#64748B' }}>
                      {isReady
                        ? doc.pageCount
                          ? `${doc.pageCount} tr.`
                          : 'Sẵn sàng'
                        : doc.status === 'unsupported'
                          ? 'Không hỗ trợ'
                          : 'Chưa sẵn sàng'}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── History Overlay Panel ── */}
      {showHistory && (
        <div
          style={{
            borderBottom: '1px solid #E2E8F0',
            background: '#F8FAFC',
            maxHeight: 240,
            overflowY: 'auto',
            padding: 10,
          }}
        >
          {conversations.length === 0 ? (
            <div style={{ fontSize: 12, color: '#64748B', textAlign: 'center', padding: 12 }}>
              Chưa có cuộc trò chuyện nào trước đây.
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => void handleSelectConversation(conv)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: conv.id === activeConvId ? '#EEF2FF' : 'transparent',
                  cursor: 'pointer',
                  marginBottom: 4,
                }}
              >
                {editingConvId === conv.id ? (
                  <input
                    type="text"
                    value={editTitleVal}
                    onChange={(e) => setEditTitleVal(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleRenameConversation(conv.id);
                      if (e.key === 'Escape') setEditingConvId(null);
                    }}
                    onBlur={() => void handleRenameConversation(conv.id)}
                    autoFocus
                    style={{
                      flex: 1,
                      fontSize: 12,
                      padding: '4px 6px',
                      borderRadius: 6,
                      border: '1px solid #4F46E5',
                    }}
                  />
                ) : (
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      fontWeight: conv.id === activeConvId ? 700 : 500,
                      color: conv.id === activeConvId ? '#4338CA' : '#1E293B',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    💬 {conv.title}
                  </span>
                )}
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingConvId(conv.id);
                      setEditTitleVal(conv.title);
                    }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: '#64748B',
                    }}
                    title="Đổi tên"
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    onClick={(e) => void handleDeleteConversation(conv.id, e)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: '#EF4444',
                    }}
                    title="Xóa"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Warning / Exam Lock / Missing API Key Banners ── */}
      {!geminiConfigured && (
        <div
          style={{
            margin: '10px 14px 0',
            padding: '10px 12px',
            borderRadius: 10,
            background: '#FFFBEB',
            border: '1px solid #FDE68A',
            color: '#92400E',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          ⚠️ Máy chủ chưa cấu hình <code>GEMINI_API_KEY</code> trong <code>backend/.env</code>. Sau khi thêm khóa API và khởi động lại backend, Trợ giảng AI sẽ tự động hoạt động.
        </div>
      )}

      {examLock.locked && (
        <div
          style={{
            margin: '10px 14px 0',
            padding: '12px 14px',
            borderRadius: 10,
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            color: '#991B1B',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          🔒 Tạm khóa Trợ giảng AI trong thời gian bạn đang làm bài thi "{examLock.examName}".
        </div>
      )}

      {errorBanner && (
        <div
          style={{
            margin: '10px 14px 0',
            padding: '10px 12px',
            borderRadius: 10,
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            color: '#B91C1C',
            fontSize: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>⚠️ {errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
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

      {/* ── Messages Body ── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              marginTop: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div
              style={{
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: 14,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                👋 Hỏi bất kỳ điều gì về tài liệu lớp học
              </div>
              <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
                Trợ giảng AI chỉ trả lời dựa trên <strong>{readyDocs.length} tài liệu đã sẵn sàng</strong> của lớp và đính kèm trích dẫn trang cụ thể để bạn đối chiếu.
              </div>
            </div>

            {suggestedQuestions.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: '#64748B',
                    marginBottom: 8,
                  }}
                >
                  💡 GỢI Ý CÂU HỎI ÔN TẬP
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {suggestedQuestions.map((sq, idx) => (
                    <button
                      key={idx}
                      type="button"
                      disabled={examLock.locked || readyDocs.length === 0}
                      onClick={() => void handleSendQuestion(sq)}
                      style={{
                        textAlign: 'left',
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid #E2E8F0',
                        background: '#FFFFFF',
                        color: '#1E293B',
                        fontSize: 13,
                        fontWeight: 500,
                        cursor:
                          examLock.locked || readyDocs.length === 0
                            ? 'not-allowed'
                            : 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      ✨ {sq}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            const isUngrounded = !isUser && msg.grounded === false;

            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isUser ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '90%',
                    padding: '11px 14px',
                    borderRadius: isUser
                      ? '16px 16px 4px 16px'
                      : '16px 16px 16px 4px',
                    background: isUser
                      ? '#4F46E5'
                      : isUngrounded
                        ? '#FFFBEB'
                        : '#F8FAFC',
                    color: isUser ? '#FFFFFF' : '#0F172A',
                    border: isUser
                      ? 'none'
                      : isUngrounded
                        ? '1px solid #F59E0B'
                        : '1px solid #E2E8F0',
                    fontSize: 13.5,
                  }}
                >
                  {isUser ? (
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                      {msg.content}
                    </div>
                  ) : (
                    <>
                      {isUngrounded && (
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#B45309',
                            marginBottom: 6,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          ⚠️ Không tìm thấy trong tài liệu lớp
                        </div>
                      )}

                      {msg.content ? (
                        <RagMarkdownRenderer
                          content={msg.content}
                          citations={msg.citations}
                          onCitationClick={(n) =>
                            setHighlightedCitation({ msgId: msg.id, n })
                          }
                        />
                      ) : (
                        <div style={{ color: '#64748B', fontStyle: 'italic' }}>
                          Đang tra cứu tài liệu và tổng hợp câu trả lời…
                        </div>
                      )}

                      {msg.citations && msg.citations.length > 0 && (
                        <div
                          style={{
                            marginTop: 10,
                            paddingTop: 8,
                            borderTop: '1px dashed #CBD5E1',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 6,
                          }}
                        >
                          {msg.citations.map((cit) => (
                            <CitationChip
                              key={cit.n}
                              citation={cit}
                              active={
                                highlightedCitation?.msgId === msg.id &&
                                highlightedCitation?.n === cit.n
                              }
                            />
                          ))}
                        </div>
                      )}

                      {!msg.streaming && msg.content && (
                        <div
                          style={{
                            marginTop: 8,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            color: '#64748B',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => void handleFeedback(msg, 1)}
                            style={{
                              border: 'none',
                              background:
                                msg.feedback === 1 ? '#DCFCE7' : 'transparent',
                              borderRadius: 6,
                              padding: '2px 6px',
                              cursor: 'pointer',
                              fontSize: 12,
                            }}
                            title="Hữu ích"
                          >
                            👍
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleFeedback(msg, -1)}
                            style={{
                              border: 'none',
                              background:
                                msg.feedback === -1 ? '#FEE2E2' : 'transparent',
                              borderRadius: 6,
                              padding: '2px 6px',
                              cursor: 'pointer',
                              fontSize: 12,
                            }}
                            title="Chưa chính xác"
                          >
                            👎
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyMessage(msg)}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              borderRadius: 6,
                              padding: '2px 6px',
                              cursor: 'pointer',
                              fontSize: 11,
                              color: '#64748B',
                            }}
                            title="Sao chép câu trả lời"
                          >
                            {copiedMsgId === msg.id ? '✓ Đã chép' : '📋 Chép'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input Area ── */}
      <div
        style={{
          padding: '12px 14px',
          borderTop: '1px solid #E2E8F0',
          background: '#FFFFFF',
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            rows={2}
            placeholder={
              examLock.locked
                ? 'Đang khóa trong thời gian thi...'
                : readyDocs.length === 0
                  ? 'Chưa có tài liệu sẵn sàng để hỏi đáp...'
                  : 'Nhập câu hỏi về tài liệu lớp học (Enter để gửi)...'
            }
            disabled={examLock.locked || readyDocs.length === 0}
            value={inputQuestion}
            onChange={(e) => setInputQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSendQuestion();
              }
            }}
            style={{
              flex: 1,
              resize: 'none',
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid #CBD5E1',
              fontSize: 13.5,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          {streaming ? (
            <button
              type="button"
              onClick={handleStopStream}
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid #FCA5A5',
                background: '#FEF2F2',
                color: '#DC2626',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                height: 42,
              }}
            >
              ⏹ Dừng
            </button>
          ) : (
            <button
              type="button"
              disabled={
                !inputQuestion.trim() || examLock.locked || readyDocs.length === 0
              }
              onClick={() => void handleSendQuestion()}
              style={{
                padding: '10px 16px',
                borderRadius: 10,
                border: 'none',
                background:
                  !inputQuestion.trim() || examLock.locked || readyDocs.length === 0
                    ? '#CBD5E1'
                    : '#4F46E5',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: 14,
                cursor:
                  !inputQuestion.trim() || examLock.locked || readyDocs.length === 0
                    ? 'not-allowed'
                    : 'pointer',
                height: 42,
              }}
            >
              ➤
            </button>
          )}
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: '#94A3B8',
            textAlign: 'center',
          }}
        >
          AI có thể mắc sai sót — hãy bấm vào trích dẫn [n] để đối chiếu trực tiếp với giáo trình.
        </div>
      </div>
    </div>
  );
};
