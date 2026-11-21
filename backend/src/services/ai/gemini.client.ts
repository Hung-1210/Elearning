// src/services/ai/gemini.client.ts
import { l2NormalizeVec, EMBEDDING_DIM } from './schema.js';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export type GeminiErrorCode =
  | 'MISSING_API_KEY'
  | 'RATE_LIMIT'
  | 'QUOTA_EXCEEDED'
  | 'TIMEOUT'
  | 'BAD_RESPONSE'
  | 'UPSTREAM_ERROR';

export class GeminiApiError extends Error {
  constructor(
    public code: GeminiErrorCode,
    message: string,
    public status?: number,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'GeminiApiError';
  }
}

export interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export type GeminiTaskType =
  | 'RETRIEVAL_DOCUMENT'
  | 'RETRIEVAL_QUERY'
  | 'SEMANTIC_SIMILARITY'
  | 'CLASSIFICATION';

let fetchImpl: typeof fetch = fetch;

export function setGeminiFetchForTest(fn: typeof fetch | null) {
  fetchImpl = fn ?? fetch;
}

export function getGeminiApiKey(): string {
  return (process.env.GEMINI_API_KEY ?? '').trim();
}

export function isGeminiConfigured(): boolean {
  return getGeminiApiKey().length > 0;
}

export function getChatModel(): string {
  const raw = (process.env.GEMINI_CHAT_MODEL || 'gemini-3.1-flash-lite').trim().replace(/^models\//, '');
  return raw || 'gemini-3.1-flash-lite';
}

export function getEmbedModel(): string {
  const raw = (process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-2').trim().replace(/^models\//, '');
  return raw || 'gemini-embedding-2';
}

/** Danh sách model chat (ưu tiên gemini-3.1-flash-lite và biến thể -preview của nó trên v1beta). */
function getChatModelCandidates(): string[] {
  const primary = getChatModel();
  const fallbacks = [
    primary,
    primary.endsWith('-preview') ? primary : `${primary}-preview`,
    'gemini-3.1-flash-lite',
    'gemini-3.1-flash-lite-preview',
  ];
  return Array.from(new Set(fallbacks));
}

/** Danh sách model embedding dự phòng nếu model cấu hình trả về 404. */
function getEmbedModelCandidates(): string[] {
  const primary = getEmbedModel();
  const fallbacks = [
    primary,
    'gemini-embedding-2',
    'gemini-embedding-001',
    'text-embedding-004',
  ];
  return Array.from(new Set(fallbacks));
}

function requireApiKey(): string {
  const key = getGeminiApiKey();
  if (!key) {
    throw new GeminiApiError(
      'MISSING_API_KEY',
      'Chưa cấu hình GEMINI_API_KEY trong backend/.env. Vui lòng thêm khóa API Gemini để sử dụng tính năng AI.',
      503,
    );
  }
  return key;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts?: { timeoutMs?: number; maxRetries?: number; signal?: AbortSignal },
): Promise<Response> {
  const timeoutMs = opts?.timeoutMs ?? 45_000;
  const maxRetries = opts?.maxRetries ?? 2;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const onExternalAbort = () => controller.abort();
    if (opts?.signal) {
      if (opts.signal.aborted) {
        clearTimeout(timer);
        throw new GeminiApiError('TIMEOUT', 'Yêu cầu đã bị hủy bởi người dùng');
      }
      opts.signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      const res = await fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (opts?.signal) opts.signal.removeEventListener('abort', onExternalAbort);

      if (res.ok) return res;

      const status = res.status;
      const errBody = await res.text().catch(() => '');

      if ((status === 429 || status >= 500) && attempt < maxRetries) {
        const delayMs = Math.min(8000, 800 * Math.pow(2, attempt) + Math.floor(Math.random() * 300));
        await sleep(delayMs);
        continue;
      }

      if (status === 429) {
        throw new GeminiApiError(
          'RATE_LIMIT',
          'Hệ thống AI (Gemini) đang nhận nhiều yêu cầu cùng lúc. Vui lòng thử lại sau ít giây.',
          429,
          errBody,
        );
      }

      if (status === 400 || status === 401 || status === 403) {
        if (/API_KEY_INVALID|API key not valid|UNAUTHENTICATED/i.test(errBody)) {
          throw new GeminiApiError(
            'MISSING_API_KEY',
            'GEMINI_API_KEY không hợp lệ hoặc không được phép truy cập. Vui lòng kiểm tra lại khóa API trong backend/.env.',
            status,
            errBody,
          );
        }
        if (/quota|RESOURCE_EXHAUSTED/i.test(errBody)) {
          throw new GeminiApiError(
            'QUOTA_EXCEEDED',
            'Đã vượt hạn mức (quota) của Gemini API. Vui lòng thử lại sau.',
            status,
            errBody,
          );
        }
      }

      throw new GeminiApiError(
        'UPSTREAM_ERROR',
        `Gemini API trả lỗi HTTP ${status}: ${errBody.slice(0, 240)}`,
        status,
        errBody,
      );
    } catch (err: any) {
      clearTimeout(timer);
      if (opts?.signal) opts.signal.removeEventListener('abort', onExternalAbort);
      if (err instanceof GeminiApiError) throw err;
      if (err?.name === 'AbortError') {
        lastErr = new GeminiApiError(
          'TIMEOUT',
          'Yêu cầu tới Gemini AI quá thời gian chờ. Vui lòng thử lại.',
          504,
          err,
        );
      } else {
        lastErr = new GeminiApiError(
          'UPSTREAM_ERROR',
          `Không thể kết nối tới Gemini API: ${err?.message || 'Lỗi mạng'}`,
          502,
          err,
        );
      }
      if (attempt < maxRetries && !opts?.signal?.aborted) {
        await sleep(600 * Math.pow(2, attempt));
        continue;
      }
      throw lastErr;
    }
  }

  throw lastErr instanceof GeminiApiError
    ? lastErr
    : new GeminiApiError('UPSTREAM_ERROR', 'Lỗi không xác định khi gọi Gemini API');
}

/** Gọi Gemini sinh văn bản (tự động fallback sang gemini-2.5-flash nếu model cấu hình trả về 404/400). */
export async function generateText(opts: {
  systemInstruction?: string;
  contents: GeminiContent[];
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number;
  timeoutMs?: number;
}): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const apiKey = requireApiKey();
  const candidates = getChatModelCandidates();
  let lastErr: unknown;

  for (const model of candidates) {
    const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const generationConfig: Record<string, any> = {
      temperature: opts.temperature ?? 0.2,
    };
    if (opts.maxOutputTokens) {
      generationConfig.maxOutputTokens = opts.maxOutputTokens;
    }

    const body: Record<string, any> = {
      contents: opts.contents,
      generationConfig,
    };
    if (opts.systemInstruction) {
      body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
    }

    try {
      const res = await fetchWithRetry(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
        },
        { timeoutMs: opts.timeoutMs ?? 45_000 },
      );

      const json: any = await res.json();
      const parts: any[] = json?.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((p) => !p?.thought && typeof p?.text === 'string')
        .map((p) => p.text)
        .join('');

      const tokensIn = Number(json?.usageMetadata?.promptTokenCount ?? 0);
      const tokensOut = Number(json?.usageMetadata?.candidatesTokenCount ?? 0);

      return { text, tokensIn, tokensOut };
    } catch (err: any) {
      lastErr = err;
      // Nếu model bị 404 Not Found hoặc 400 Invalid Argument thì thử model dự phòng tiếp theo
      if (err instanceof GeminiApiError && (err.status === 404 || err.status === 400)) {
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

/** Gọi Gemini sinh JSON tuân thủ responseSchema (Structured Output). */
export async function generateStructuredJson<T = any>(opts: {
  systemInstruction?: string;
  prompt: string;
  responseSchema: Record<string, any>;
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number;
  timeoutMs?: number;
}): Promise<{ data: T; rawText: string; tokensIn: number; tokensOut: number }> {
  const apiKey = requireApiKey();
  const candidates = getChatModelCandidates();
  let lastErr: unknown;

  for (const model of candidates) {
    const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const generationConfig: Record<string, any> = {
      temperature: opts.temperature ?? 0.35,
      responseMimeType: 'application/json',
      responseSchema: opts.responseSchema,
    };
    if (opts.maxOutputTokens) {
      generationConfig.maxOutputTokens = opts.maxOutputTokens;
    }

    const body: Record<string, any> = {
      contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
      generationConfig,
    };
    if (opts.systemInstruction) {
      body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
    }

    try {
      const res = await fetchWithRetry(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
        },
        { timeoutMs: opts.timeoutMs ?? 60_000 },
      );

      const json: any = await res.json();
      const parts: any[] = json?.candidates?.[0]?.content?.parts ?? [];
      const rawText = parts
        .filter((p) => !p?.thought && typeof p?.text === 'string')
        .map((p) => p.text)
        .join('')
        .trim();

      if (!rawText) {
        throw new GeminiApiError('BAD_RESPONSE', 'Gemini trả về phản hồi rỗng khi sinh dữ liệu JSON');
      }

      const parsed = safeParseJson<T>(rawText);
      const tokensIn = Number(json?.usageMetadata?.promptTokenCount ?? 0);
      const tokensOut = Number(json?.usageMetadata?.candidatesTokenCount ?? 0);

      return { data: parsed, rawText, tokensIn, tokensOut };
    } catch (err: any) {
      lastErr = err;
      if (err instanceof GeminiApiError && (err.status === 404 || err.status === 400)) {
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

/** Parse JSON an toàn (chịu được trường hợp bọc trong ```json ... ```). */
export function safeParseJson<T = any>(raw: string): T {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch (err) {
    const firstBrace = trimmed.search(/[\[{]/);
    const lastBrace = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
      } catch {
        // fall through
      }
    }
    throw new GeminiApiError(
      'BAD_RESPONSE',
      'Không thể phân tích cú pháp JSON từ phản hồi của Gemini',
      502,
      err,
    );
  }
}

/**
 * Stream văn bản từ Gemini qua SSE (:streamGenerateContent?alt=sse),
 * tự động fallback sang model dự phòng (gemini-2.5-flash) hoặc generateContent chuẩn (giống Old backend rag) nếu cần.
 */
export async function streamGenerateText(opts: {
  systemInstruction?: string;
  contents: GeminiContent[];
  temperature?: number;
  thinkingBudget?: number;
  signal?: AbortSignal;
  onDelta: (deltaText: string) => void;
}): Promise<{ fullText: string; tokensIn: number; tokensOut: number }> {
  const apiKey = requireApiKey();
  const candidates = getChatModelCandidates();
  let lastErr: unknown;

  for (const model of candidates) {
    const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

    const generationConfig: Record<string, any> = {
      temperature: opts.temperature ?? 0.2,
    };

    const body: Record<string, any> = {
      contents: opts.contents,
      generationConfig,
    };
    if (opts.systemInstruction) {
      body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
    }

    try {
      const res = await fetchWithRetry(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
        },
        { timeoutMs: 60_000, maxRetries: 1, signal: opts.signal },
      );

      if (!res.body) {
        throw new GeminiApiError('BAD_RESPONSE', 'Luồng phản hồi từ Gemini bị rỗng');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let fullText = '';
      let tokensIn = 0;
      let tokensOut = 0;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payloadStr = trimmed.slice(5).trim();
          if (!payloadStr || payloadStr === '[DONE]') continue;
          try {
            const evt = JSON.parse(payloadStr);
            const parts: any[] = evt?.candidates?.[0]?.content?.parts ?? [];
            for (const p of parts) {
              if (!p?.thought && typeof p?.text === 'string' && p.text.length > 0) {
                fullText += p.text;
                opts.onDelta(p.text);
              }
            }
            if (evt?.usageMetadata) {
              tokensIn = Number(evt.usageMetadata.promptTokenCount ?? tokensIn);
              tokensOut = Number(evt.usageMetadata.candidatesTokenCount ?? tokensOut);
            }
          } catch {
            // Ignore partial line
          }
        }
      }

      if (fullText.trim().length > 0) {
        return { fullText, tokensIn, tokensOut };
      }
    } catch (err: any) {
      lastErr = err;
      if (err instanceof GeminiApiError && (err.status === 404 || err.status === 400)) {
        continue;
      }
      break;
    }
  }

  // Fallback cuối cùng: gọi generateText (non-streaming, giống hệt Old backend rag)
  try {
    const nonStream = await generateText({
      systemInstruction: opts.systemInstruction,
      contents: opts.contents,
      temperature: opts.temperature,
    });
    if (nonStream.text) {
      opts.onDelta(nonStream.text);
    }
    return {
      fullText: nonStream.text,
      tokensIn: nonStream.tokensIn,
      tokensOut: nonStream.tokensOut,
    };
  } catch (fallbackErr) {
    throw lastErr ?? fallbackErr;
  }
}

/** Tạo vector embedding 768 chiều (đã chuẩn hóa L2) cho 1 đoạn văn bản. */
export async function embedText(
  text: string,
  _taskType?: GeminiTaskType,
): Promise<number[]> {
  const { embeddings } = await embedBatch([text]);
  return embeddings[0];
}

/** Gọi :embedContent đơn lẻ cho 1 văn bản (fallback giống Old backend rag/services/openaiService.js). */
async function embedSingleWithModel(
  apiKey: string,
  model: string,
  text: string,
): Promise<number[]> {
  const modelResource = model.startsWith('models/') ? model : `models/${model}`;
  const url = `${GEMINI_BASE_URL}/${modelResource}:embedContent?key=${encodeURIComponent(apiKey)}`;
  const cleanText = (text || '').trim() || ' ';

  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model: modelResource,
        content: { parts: [{ text: cleanText }] },
        outputDimensionality: EMBEDDING_DIM,
      }),
    },
    { timeoutMs: 30_000, maxRetries: 2 },
  );

  const json: any = await res.json();
  const vals: number[] = Array.isArray(json?.embedding?.values)
    ? json.embedding.values.map(Number)
    : Array.isArray(json?.embeddings?.[0]?.values)
      ? json.embeddings[0].values.map(Number)
      : [];

  if (vals.length === 0) {
    throw new GeminiApiError('BAD_RESPONSE', 'Vector embedding rỗng từ Gemini');
  }
  return l2NormalizeVec(vals.slice(0, EMBEDDING_DIM));
}

/**
 * Tạo vector embedding 768 chiều theo lô (không dùng taskType bất đối xứng để giống Old backend rag,
 * tự động fallback sang :embedContent đơn lẻ hoặc model embedding dự phòng nếu batch lỗi).
 */
export async function embedBatch(
  texts: string[],
  _taskType?: GeminiTaskType,
): Promise<{ embeddings: number[][]; tokensIn: number }> {
  if (texts.length === 0) return { embeddings: [], tokensIn: 0 };

  const apiKey = requireApiKey();
  const modelCandidates = getEmbedModelCandidates();
  let lastErr: unknown;

  for (const model of modelCandidates) {
    const modelResource = model.startsWith('models/') ? model : `models/${model}`;
    const url = `${GEMINI_BASE_URL}/${modelResource}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;

    try {
      const BATCH_SIZE = 50;
      const allEmbeddings: number[][] = [];
      let estimatedTokensIn = 0;

      for (let start = 0; start < texts.length; start += BATCH_SIZE) {
        const slice = texts.slice(start, start + BATCH_SIZE);
        const requests = slice.map((t) => {
          const cleanText = (t || '').trim() || ' ';
          estimatedTokensIn += Math.ceil(cleanText.length / 4);
          return {
            model: modelResource,
            content: { parts: [{ text: cleanText }] },
            outputDimensionality: EMBEDDING_DIM,
          };
        });

        try {
          const res = await fetchWithRetry(
            url,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey,
              },
              body: JSON.stringify({ requests }),
            },
            { timeoutMs: 45_000, maxRetries: 2 },
          );

          const json: any = await res.json();
          const rawList: any[] = json?.embeddings ?? [];
          if (!Array.isArray(rawList) || rawList.length !== slice.length) {
            throw new GeminiApiError(
              'BAD_RESPONSE',
              `Gemini embedding trả về ${rawList?.length ?? 0}/${slice.length} vector`,
            );
          }

          for (const item of rawList) {
            const vals: number[] = Array.isArray(item?.values) ? item.values.map(Number) : [];
            if (vals.length === 0) {
              throw new GeminiApiError('BAD_RESPONSE', 'Vector embedding rỗng từ Gemini');
            }
            allEmbeddings.push(l2NormalizeVec(vals.slice(0, EMBEDDING_DIM)));
          }
        } catch (batchErr: any) {
          // Nếu lỗi 404 (model không tồn tại), nhảy sang model ứng viên tiếp theo
          if (batchErr instanceof GeminiApiError && batchErr.status === 404) {
            throw batchErr;
          }
          // Fallback sang gọi từng câu (:embedContent) giống Old backend rag/services/openaiService.js
          const singleResults = await Promise.all(
            slice.map((t) => embedSingleWithModel(apiKey, model, t)),
          );
          allEmbeddings.push(...singleResults);
        }
      }

      return { embeddings: allEmbeddings, tokensIn: estimatedTokensIn };
    } catch (err: any) {
      lastErr = err;
      if (err instanceof GeminiApiError && (err.status === 404 || err.status === 400)) {
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}
