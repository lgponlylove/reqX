import type { AiUsage } from './ai-providers';

/** Client gọi Google AI Studio (Gemini) qua REST, không cần SDK. Key chỉ gửi tới googleapis.com. */
import { aiFetch } from './ai-fetch';
import { SseStreamParser } from '../sse-parser';

export const GEMINI_DEFAULT_MODEL = 'gemini-flash-lite-latest';

export interface GeminiFunctionDecl {
  name: string;
  description: string;
  parameters: {
    type: 'OBJECT';
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/** Lỗi quota/rate limit (429, RESOURCE_EXHAUSTED, TPM...) → đủ điều kiện chuyển key/provider dự phòng. */
export function isQuotaError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /429|quota|rate.?limit|rate_limit|tokens per minute|\btpm\b|resource.exhausted|exhausted|overloaded|insufficient/i.test(msg);
}

/** Lỗi mạng/timeout/5xx → cũng nên thử provider tiếp theo trong chain. */
export function isRetryableError(e: unknown): boolean {
  if (isQuotaError(e)) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /timeout|quá 30s|mạng|CORS|network|failed to fetch|fetch failed|HTTP 5\d\d/i.test(msg);
}

/**
 * Dọn history trước khi gửi: Gemini bắt functionResponse phải đứng ngay sau
 * functionCall tương ứng. Khi history bị cắt bớt (cap 30 lượt), vết cắt có thể
 * rơi giữa cặp call/response → đầu còn lại functionResponse mồ côi → API lỗi
 * \"function response turn comes immediately after a function call turn\".
 * Hàm này bỏ các lượt mồ côi ở đầu + cắt đuôi ở chỗ gãy đầu tiên.
 */
export function sanitizeContents(turns: GeminiContent[]): GeminiContent[] {
  let start = 0;
  const isOrphanResp = (t: GeminiContent) =>
    t.role === 'user' && t.parts.some((p) => p.functionResponse);
  // Đầu history chỉ được là user-text (câu hỏi mới). Bỏ model mở đầu và
  // functionResponse mồ côi (call của nó đã bị cắt mất).
  while (start < turns.length && (turns[start].role === 'model' || isOrphanResp(turns[start]))) start++;
  const out: GeminiContent[] = [];
  // pending: model-call đang chờ response + vị trí đã push trong out (để gỡ khi gãy)
  let pending: { names: string[]; idx: number } | null = null;
  let dropped = 0;
  const respNames = (t: GeminiContent) =>
    t.parts.filter((p) => p.functionResponse).map((p) => p.functionResponse!.name);
  for (const t of turns.slice(start)) {
    if (pending) {
      if (t.role === 'user' && pending.names.every((n) => respNames(t).includes(n))) {
        out.push(t);
        pending = null;
        continue;
      }
      // Cặp gãy: gỡ model-call đã push, giữ lại phần text của lượt user (nếu có) rồi xét tiếp.
      out.splice(pending.idx, 1);
      dropped++;
      pending = null;
      if (t.role === 'user') {
        const texts = t.parts.filter((p) => typeof p.text === 'string');
        if (texts.length) out.push({ role: 'user', parts: texts });
        continue;
      }
      // t là model → rơi xuống xử lý như lượt thường
    }
    out.push(t);
    if (t.role === 'model') {
      const calls = t.parts.filter((p) => p.functionCall).map((p) => p.functionCall!.name);
      if (calls.length) pending = { names: calls, idx: out.length - 1 };
    }
  }
  if (dropped > 0) console.warn(`[gemini] đã bỏ ${dropped} cặp call/response gãy trong history`);
  return out;
}

async function streamGemini(
  apiKey: string,
  model: string,
  system: string,
  contents: GeminiContent[],
  tools: GeminiFunctionDecl[],
  onDelta: (delta: string) => void,
): Promise<{ parts: GeminiPart[]; usage: AiUsage } | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 35000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        ...(tools.length > 0 ? { tools: [{ functionDeclarations: tools }] } : {}),
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      }),
      signal: ctrl.signal,
    });

    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    const collectedParts: GeminiPart[] = [];
    let promptTokens = 0;
    let completionTokens = 0;

    const parser = new SseStreamParser((ev) => {
      const dataStr = ev.data.trim();
      if (!dataStr || dataStr === '[DONE]') return;
      try {
        const json = JSON.parse(dataStr);
        if (json.usageMetadata) {
          promptTokens = json.usageMetadata.promptTokenCount ?? promptTokens;
          completionTokens = json.usageMetadata.candidatesTokenCount ?? completionTokens;
        }
        const candidate = json.candidates?.[0];
        if (!candidate?.content?.parts) return;
        for (const part of candidate.content.parts) {
          if (typeof part.text === 'string' && part.text) {
            fullText += part.text;
            onDelta(part.text);
          }
          if (part.functionCall) {
            collectedParts.push(part);
          }
        }
      } catch {
        // chunk JSON parse error, ignore
      }
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        parser.feed(decoder.decode(value, { stream: true }));
      }
    }
    parser.feed(decoder.decode());

    const parts: GeminiPart[] = [];
    if (fullText) parts.push({ text: fullText });
    for (const p of collectedParts) parts.push(p);

    if (parts.length === 0) return null;

    return {
      parts,
      usage: { prompt: promptTokens, completion: completionTokens },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Một lượt gọi generateContent — parts (text/call) + usage để ước tính chi phí. */
export async function generateContent(
  apiKey: string,
  model: string,
  system: string,
  contents: GeminiContent[],
  tools: GeminiFunctionDecl[],
  onDelta?: (delta: string) => void,
): Promise<{ parts: GeminiPart[]; usage: AiUsage }> {
  if (onDelta) {
    const streamed = await streamGemini(apiKey, model, system, contents, tools, onDelta);
    if (streamed) return streamed;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let status = 0;
  let data: unknown = null;
  try {
    const r = await aiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations: tools }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      }),
      timeoutMs: 30000,
    });
    status = r.status;
    try {
      data = JSON.parse(r.text);
    } catch {
      data = null;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError')
      throw new Error('Google API quá 30s không phản hồi — kiểm tra mạng rồi thử lại.');
    throw new Error(`Không gọi được Google API (mạng/CORS): ${e instanceof Error ? e.message : String(e)}`);
  }
  const errMsg =
    (data as { error?: { message?: string } } | null)?.error?.message ??
    (status >= 200 && status < 300 ? null : `HTTP ${status}`);
  if (errMsg) throw new Error(`Gemini lỗi: ${String(errMsg).slice(0, 300)}`);
  const parts = (data as { candidates?: { content?: { parts?: GeminiPart[] } }[] })?.candidates?.[0]
    ?.content?.parts;
  if (!parts) throw new Error('Gemini không trả về nội dung (có thể bị bộ lọc an toàn chặn).');
  const um = (data as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } })?.usageMetadata;
  return { parts, usage: { prompt: um?.promptTokenCount ?? 0, completion: um?.candidatesTokenCount ?? 0 } };
}
