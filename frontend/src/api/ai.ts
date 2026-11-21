import api from './axios';
import { useAuthStore } from '../store/authStore';
import type {
  AiGenerationJob,
  AiQuestionDraft,
  DocIngestionStatus,
  RagCitation,
  RagConversation,
  RagMessage,
} from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export const aiApi = {
  // 1. Trạng thái tài liệu & gợi ý câu hỏi
  getDocsStatus: (classId: number | string) =>
    api.get<{
      success: boolean;
      data: { geminiConfigured: boolean; docs: DocIngestionStatus[] };
    }>(`/classes/${classId}/ai/docs-status`),

  reindexDoc: (docId: number | string) =>
    api.post<{ success: boolean; data: { docId: number; status: string } }>(
      `/ai/docs/${docId}/reindex`,
    ),

  getSuggestedQuestions: (classId: number | string) =>
    api.get<{ success: boolean; data: { questions: string[] } }>(
      `/classes/${classId}/ai/suggested-questions`,
    ),

  // 2. Hội thoại RAG Chat
  listConversations: (classId: number | string) =>
    api.get<{
      success: boolean;
      data: {
        examLock: { locked: boolean; examName: string | null; deadlineAt: string | null };
        conversations: RagConversation[];
      };
    }>(`/classes/${classId}/rag/conversations`),

  createConversation: (
    classId: number | string,
    payload?: { title?: string; docScope?: number[] | null },
  ) =>
    api.post<{ success: boolean; data: RagConversation }>(
      `/classes/${classId}/rag/conversations`,
      payload ?? {},
    ),

  updateConversation: (
    conversationId: number | string,
    payload: { title?: string; docScope?: number[] | null },
  ) =>
    api.patch<{ success: boolean; data: RagConversation }>(
      `/rag/conversations/${conversationId}`,
      payload,
    ),

  deleteConversation: (conversationId: number | string) =>
    api.delete<{ success: boolean; data: { deleted: boolean } }>(
      `/rag/conversations/${conversationId}`,
    ),

  getConversationMessages: (conversationId: number | string) =>
    api.get<{
      success: boolean;
      data: { conversation: RagConversation; messages: RagMessage[] };
    }>(`/rag/conversations/${conversationId}/messages`),

  setMessageFeedback: (messageId: number | string, feedback: -1 | 1 | null) =>
    api.patch<{ success: boolean; data: { id: number; feedback: -1 | 1 | null } }>(
      `/rag/messages/${messageId}/feedback`,
      { feedback },
    ),

  // 3. Stream RAG Chat qua fetch + ReadableStream (SSE)
  streamRagChat: async (opts: {
    conversationId: number;
    question: string;
    docScope?: number[] | null;
    signal?: AbortSignal;
    onMeta?: (meta: { conversationId: number; title: string; userMessageId: number }) => void;
    onDelta?: (deltaText: string) => void;
    onCitations?: (data: { citations: RagCitation[]; grounded: boolean }) => void;
    onDone?: (done: {
      assistantMessageId: number;
      grounded: boolean;
      latencyMs: number;
    }) => void;
    onError?: (err: { status?: number; message: string }) => void;
  }): Promise<void> => {
    const token = useAuthStore.getState().accessToken;
    const res = await fetch(`${API_BASE}/rag/conversations/${opts.conversationId}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({
        question: opts.question,
        docScope: opts.docScope,
      }),
      signal: opts.signal,
    });

    if (!res.ok) {
      let errMsg = `Lỗi HTTP ${res.status}`;
      try {
        const json = await res.json();
        if (json?.error) errMsg = json.error;
      } catch {
        // ignore
      }
      opts.onError?.({ status: res.status, message: errMsg });
      return;
    }

    if (!res.body) {
      opts.onError?.({ message: 'Không nhận được luồng phản hồi từ máy chủ' });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        const lines = block.split('\n');
        let eventType = 'message';
        let dataStr = '';
        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataStr += line.slice(5).trim();
          }
        }
        if (!dataStr) continue;
        try {
          const parsed = JSON.parse(dataStr);
          if (eventType === 'meta') {
            opts.onMeta?.(parsed);
          } else if (eventType === 'delta') {
            if (typeof parsed?.text === 'string') {
              opts.onDelta?.(parsed.text);
            }
          } else if (eventType === 'citations') {
            opts.onCitations?.({
              citations: Array.isArray(parsed?.citations) ? parsed.citations : [],
              grounded: parsed?.grounded !== false,
            });
          } else if (eventType === 'done') {
            opts.onDone?.(parsed);
          } else if (eventType === 'error') {
            opts.onError?.({
              status: parsed?.status,
              message: parsed?.message || 'Đã xảy ra lỗi khi xử lý câu hỏi.',
            });
          }
        } catch {
          // ignore malformed SSE chunk
        }
      }
    }
  },

  // 4. Tạo câu hỏi bằng AI & quản lý bản nháp (Giảng viên)
  createQuestionJob: (classId: number | string, payload: any) =>
    api.post<{ success: boolean; data: AiGenerationJob }>(
      `/classes/${classId}/ai/question-jobs`,
      payload,
    ),

  listQuestionJobs: (classId: number | string) =>
    api.get<{ success: boolean; data: AiGenerationJob[] }>(
      `/classes/${classId}/ai/question-jobs`,
    ),

  getQuestionJob: (jobId: number | string) =>
    api.get<{ success: boolean; data: AiGenerationJob }>(`/ai/question-jobs/${jobId}`),

  cancelQuestionJob: (jobId: number | string) =>
    api.post<{ success: boolean; data: AiGenerationJob }>(`/ai/question-jobs/${jobId}/cancel`),

  updateDraft: (
    draftId: number | string,
    payload: Partial<{
      questionType: 'single_choice' | 'multiple_choice' | 'essay';
      difficulty: 'easy' | 'medium' | 'hard';
      content: string;
      explanation: string | null;
      chapter: string | null;
      tags: string[];
      defaultPoints: number;
      options: Array<{ content: string; isCorrect: boolean }>;
    }>,
  ) =>
    api.put<{ success: boolean; data: AiQuestionDraft }>(
      `/ai/question-drafts/${draftId}`,
      payload,
    ),

  acceptDrafts: (draftIds: number[]) =>
    api.post<{
      success: boolean;
      data: { acceptedCount: number; bankQuestionIds: number[] };
    }>(`/ai/question-drafts/accept`, { draftIds }),

  discardDrafts: (draftIds: number[]) =>
    api.post<{ success: boolean; data: { discardedCount: number } }>(
      `/ai/question-drafts/discard`,
      { draftIds },
    ),

  regenerateDraft: (draftId: number | string) =>
    api.post<{ success: boolean; data: AiQuestionDraft }>(
      `/ai/question-drafts/${draftId}/regenerate`,
    ),
};
