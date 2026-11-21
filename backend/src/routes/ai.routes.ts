// src/routes/ai.routes.ts
import { Router, type Request, type Response } from 'express';
import { requireLogin, requireLecturer } from '../middleware/auth.middleware.js';
import {
  requireClassMembership,
  requireClassOwnership,
} from '../middleware/class-access.middleware.js';
import {
  getClassDocsAiStatus,
  reindexDocumentForLecturer,
} from '../services/ai/ingestion.service.js';
import {
  acceptQuestionDrafts,
  cancelQuestionJob,
  createQuestionGenerationJob,
  discardQuestionDrafts,
  getQuestionJobDetails,
  listClassQuestionJobs,
  regenerateSingleDraft,
  updateQuestionDraft,
} from '../services/ai/question-gen.service.js';
import {
  createRagConversation,
  deleteRagConversation,
  getRagConversationMessages,
  getSuggestedQuestionsForClass,
  listRagConversations,
  mapAiErrorToHttp,
  setRagMessageFeedback,
  streamRagChatResponse,
  updateRagConversation,
} from '../services/ai/rag.service.js';
import { sendError } from '../utils/http-error.js';

const router = Router();
const ok = (res: Response, data: any, status = 200) =>
  res.status(status).json({ success: true, data });

// ===========================================================================
// 1. TRẠNG THÁI LẬP CHỈ MỤC TÀI LIỆU LỚP HỌC & GỢI Ý CÂU HỎI
// ===========================================================================
router.get(
  '/classes/:classId/ai/docs-status',
  requireLogin,
  requireClassMembership,
  async (req: Request, res: Response) => {
    try {
      const classId = Number(req.params.classId);
      const data = await getClassDocsAiStatus(classId);
      ok(res, data);
    } catch (err) {
      sendError(res, mapAiErrorToHttp(err));
    }
  },
);

router.post(
  '/ai/docs/:docId/reindex',
  requireLogin,
  requireLecturer,
  async (req: Request, res: Response) => {
    try {
      const docId = Number(req.params.docId);
      const data = await reindexDocumentForLecturer(req.user!.userId, docId);
      ok(res, data);
    } catch (err) {
      sendError(res, mapAiErrorToHttp(err));
    }
  },
);

router.get(
  '/classes/:classId/ai/suggested-questions',
  requireLogin,
  requireClassMembership,
  async (req: Request, res: Response) => {
    try {
      const classId = Number(req.params.classId);
      const questions = await getSuggestedQuestionsForClass(classId);
      ok(res, { questions });
    } catch (err) {
      sendError(res, mapAiErrorToHttp(err));
    }
  },
);

// ===========================================================================
// 2. RAG CHAT HỎI ĐÁP TÀI LIỆU LỚP HỌC (SV & GV)
// ===========================================================================
router.get(
  '/classes/:classId/rag/conversations',
  requireLogin,
  requireClassMembership,
  async (req: Request, res: Response) => {
    try {
      const classId = Number(req.params.classId);
      const data = await listRagConversations(
        classId,
        req.user!.userId,
        Boolean(req.user!.isLecturer),
      );
      ok(res, data);
    } catch (err) {
      sendError(res, mapAiErrorToHttp(err));
    }
  },
);

router.post(
  '/classes/:classId/rag/conversations',
  requireLogin,
  requireClassMembership,
  async (req: Request, res: Response) => {
    try {
      const classId = Number(req.params.classId);
      const data = await createRagConversation(classId, req.user!.userId, req.body);
      ok(res, data, 201);
    } catch (err) {
      sendError(res, mapAiErrorToHttp(err));
    }
  },
);

router.patch(
  '/rag/conversations/:id',
  requireLogin,
  async (req: Request, res: Response) => {
    try {
      const convId = Number(req.params.id);
      const data = await updateRagConversation(convId, req.user!.userId, req.body);
      ok(res, data);
    } catch (err) {
      sendError(res, mapAiErrorToHttp(err));
    }
  },
);

router.delete(
  '/rag/conversations/:id',
  requireLogin,
  async (req: Request, res: Response) => {
    try {
      const convId = Number(req.params.id);
      const data = await deleteRagConversation(convId, req.user!.userId);
      ok(res, data);
    } catch (err) {
      sendError(res, mapAiErrorToHttp(err));
    }
  },
);

router.get(
  '/rag/conversations/:id/messages',
  requireLogin,
  async (req: Request, res: Response) => {
    try {
      const convId = Number(req.params.id);
      const data = await getRagConversationMessages(convId, req.user!.userId);
      ok(res, data);
    } catch (err) {
      sendError(res, mapAiErrorToHttp(err));
    }
  },
);

router.patch(
  '/rag/messages/:id/feedback',
  requireLogin,
  async (req: Request, res: Response) => {
    try {
      const msgId = Number(req.params.id);
      const feedback =
        req.body?.feedback === 1 || req.body?.feedback === -1 ? req.body.feedback : null;
      const data = await setRagMessageFeedback(msgId, req.user!.userId, feedback);
      ok(res, data);
    } catch (err) {
      sendError(res, mapAiErrorToHttp(err));
    }
  },
);

// Endpoint SSE stream câu trả lời RAG Chat
router.post(
  '/rag/conversations/:id/chat',
  requireLogin,
  async (req: Request, res: Response) => {
    const convId = Number(req.params.id);
    const abortController = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const sendEvent = (event: string, data: any) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await streamRagChatResponse({
        conversationId: convId,
        userId: req.user!.userId,
        isLecturer: Boolean(req.user!.isLecturer),
        question: String(req.body?.question ?? ''),
        docScope: req.body?.docScope,
        signal: abortController.signal,
        sendEvent,
      });
    } catch (err) {
      const httpErr = mapAiErrorToHttp(err);
      sendEvent('error', {
        status: httpErr.status,
        message: httpErr.message,
      });
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  },
);

// ===========================================================================
// 3. TẠO CÂU HỎI BẰNG AI & DUYỆT VÀO NGÂN HÀNG CÂU HỎI (GIẢNG VIÊN)
// ===========================================================================
router.post(
  '/classes/:classId/ai/question-jobs',
  requireLogin,
  requireLecturer,
  requireClassOwnership,
  async (req: Request, res: Response) => {
    try {
      const classId = Number(req.params.classId);
      const data = await createQuestionGenerationJob(classId, req.user!.userId, req.body);
      ok(res, data, 201);
    } catch (err) {
      sendError(res, mapAiErrorToHttp(err));
    }
  },
);

router.get(
  '/classes/:classId/ai/question-jobs',
  requireLogin,
  requireLecturer,
  requireClassOwnership,
  async (req: Request, res: Response) => {
    try {
      const classId = Number(req.params.classId);
      const data = await listClassQuestionJobs(classId, req.user!.userId);
      ok(res, data);
    } catch (err) {
      sendError(res, mapAiErrorToHttp(err));
    }
  },
);

router.get(
  '/ai/question-jobs/:jobId',
  requireLogin,
  requireLecturer,
  async (req: Request, res: Response) => {
    try {
      const jobId = Number(req.params.jobId);
      const data = await getQuestionJobDetails(jobId, req.user!.userId);
      ok(res, data);
    } catch (err) {
      sendError(res, mapAiErrorToHttp(err));
    }
  },
);

router.post(
  '/ai/question-jobs/:jobId/cancel',
  requireLogin,
  requireLecturer,
  async (req: Request, res: Response) => {
    try {
      const jobId = Number(req.params.jobId);
      const data = await cancelQuestionJob(jobId, req.user!.userId);
      ok(res, data);
    } catch (err) {
      sendError(res, mapAiErrorToHttp(err));
    }
  },
);

router.put(
  '/ai/question-drafts/:id',
  requireLogin,
  requireLecturer,
  async (req: Request, res: Response) => {
    try {
      const draftId = Number(req.params.id);
      const data = await updateQuestionDraft(draftId, req.user!.userId, req.body);
      ok(res, data);
    } catch (err) {
      sendError(res, mapAiErrorToHttp(err));
    }
  },
);

router.post(
  '/ai/question-drafts/accept',
  requireLogin,
  requireLecturer,
  async (req: Request, res: Response) => {
    try {
      const draftIds = Array.isArray(req.body?.draftIds) ? req.body.draftIds : [];
      const data = await acceptQuestionDrafts(req.user!.userId, draftIds);
      ok(res, data);
    } catch (err) {
      sendError(res, mapAiErrorToHttp(err));
    }
  },
);

router.post(
  '/ai/question-drafts/discard',
  requireLogin,
  requireLecturer,
  async (req: Request, res: Response) => {
    try {
      const draftIds = Array.isArray(req.body?.draftIds) ? req.body.draftIds : [];
      const data = await discardQuestionDrafts(req.user!.userId, draftIds);
      ok(res, data);
    } catch (err) {
      sendError(res, mapAiErrorToHttp(err));
    }
  },
);

router.post(
  '/ai/question-drafts/:id/regenerate',
  requireLogin,
  requireLecturer,
  async (req: Request, res: Response) => {
    try {
      const draftId = Number(req.params.id);
      const data = await regenerateSingleDraft(draftId, req.user!.userId);
      ok(res, data);
    } catch (err) {
      sendError(res, mapAiErrorToHttp(err));
    }
  },
);

export default router;
