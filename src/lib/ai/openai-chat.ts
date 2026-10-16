/**
 * Client chat chuẩn OpenAI-compatible (Groq / Mistral / OpenRouter / Cloudflare Workers AI).
 * Nằm trong module `ai/` dùng chung — copy cả thư mục sang project khác được.
 */
import type { GeminiContent, GeminiFunctionDecl, GeminiPart } from './gemini';
import { aiFetch } from './ai-fetch';
import { buildBaseURL, parseRateLimitHeaders, type AiProviderDef, type AiRateLimit, type AiUsage } from './ai-providers';

// ---------------------------------------------------------------------------
// Convert tools Gemini-format (type VIẾT HOA) → OpenAI function tools (type thường)
// ---------------------------------------------------------------------------

function lowerType(t: unknown): string {
  const m: Record<string, string> = { OBJECT: 'object', STRING: 'string', NUMBER: 'number', BOOLEAN: 'boolean', ARRAY: 'array', INTEGER: 'integer' };
  return typeof t === 'string' ? (m[t.toUpperCase()] ?? t.toLowerCase()) : 'string';
}

function lowerSchema(s: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'type') out[k] = lowerType(v);
    else if (k === 'properties' && v && typeof v === 'object')
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, lowerSchema(pv as Record<string, unknown>)]));
    else if (k === 'items' && v && typeof v === 'object') out[k] = lowerSchema(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

export interface OpenAITool { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }

export function toOpenAITools(decls: GeminiFunctionDecl[]): OpenAITool[] {
  return decls.map((d) => ({
    type: 'function',
    function: { name: d.name, description: d.description, parameters: lowerSchema(d.parameters as unknown as Record<string, unknown>) },
  }));
}

// ---------------------------------------------------------------------------
// Convert history GeminiContent → OpenAI messages (giữ cặp call/response qua id ổn định)
// ---------------------------------------------------------------------------

export interface OpenAIMessage { role: string; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]; tool_call_id?: string; name?: string }

export function toOpenAIMessages(contents: GeminiContent[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  // id của response phải khớp đúng call tương ứng → nhớ theo tên từ turn gọi gần nhất
  const pending = new Map<string, string[]>();
  contents.forEach((t, ti) => {
    if (t.role === 'user' && t.parts.some((p) => p.functionResponse)) {
      for (const p of t.parts) {
        if (p.functionResponse) {
          const ids = pending.get(p.functionResponse.name);
          out.push({ role: 'tool', content: JSON.stringify(p.functionResponse.response ?? {}), tool_call_id: ids?.shift() ?? `tc_${ti}_${p.functionResponse.name}` });
        } else if (typeof p.text === 'string')
          out.push({ role: 'user', content: p.text });
      }
      return;
    }
    if (t.role === 'model' && t.parts.some((p) => p.functionCall)) {
      const text = t.parts.map((p) => p.text ?? '').join('');
      const tool_calls = t.parts.filter((p) => p.functionCall).map((p, k) => {
        const id = `tc_${ti}_${p.functionCall!.name}_${k}`;
        const arr = pending.get(p.functionCall!.name) ?? [];
        arr.push(id);
        pending.set(p.functionCall!.name, arr);
        return {
          id,
          type: 'function' as const,
          function: { name: p.functionCall!.name, arguments: JSON.stringify(p.functionCall!.args ?? {}) },
        };
      });
      out.push({ role: 'assistant', content: text || null, tool_calls });
      return;
    }
    const text = t.parts.map((p) => p.text ?? '').join('');
    out.push({ role: t.role === 'model' ? 'assistant' : 'user', content: text });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Một lượt gọi /chat/completions — trả về GeminiPart[] để vòng tool-loop dùng chung.
// ---------------------------------------------------------------------------

export interface OpenAIChatOpts {
  baseURL: string;
  key: string;
  model: string;
  system: string;
  contents: GeminiContent[];
  tools: GeminiFunctionDecl[];
  maxTokens?: number;
  extraHeaders?: Record<string, string>;
}

interface OpenAIResp {
  choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } ; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string };
}

export async function openaiChat(o: OpenAIChatOpts): Promise<{ parts: GeminiPart[]; usage: AiUsage; rateLimit?: AiRateLimit }> {
  const url = `${o.baseURL.replace(/\/$/, '')}/chat/completions`;
  let status = 0;
  let data: OpenAIResp | null = null;
  let respHeaders: Record<string, string> = {};
  try {
    const r = await aiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(o.key ? { Authorization: `Bearer ${o.key}` } : {}), ...(o.extraHeaders ?? {}) },
      body: JSON.stringify({
        model: o.model,
        messages: [{ role: 'system', content: o.system }, ...toOpenAIMessages(o.contents)],
        tools: toOpenAITools(o.tools),
        temperature: 0.2,
        max_tokens: o.maxTokens ?? 2048,
      }),
      timeoutMs: 30000,
    });
    status = r.status;
    respHeaders = r.headers;
    try {
      data = JSON.parse(r.text) as OpenAIResp;
    } catch {
      data = null;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError')
      throw new Error('API quá 30s không phản hồi (timeout) — thử lại hoặc để chain tự chuyển provider.');
    throw new Error(`Không gọi được API (mạng/CORS): ${e instanceof Error ? e.message : String(e)}`);
  }
  const errMsg = data?.error?.message ?? (status >= 200 && status < 300 ? null : `HTTP ${status}`);
  if (errMsg) throw new Error(`AI lỗi: ${String(errMsg).slice(0, 300)}`);
  const msg = data?.choices?.[0]?.message;
  if (!msg) throw new Error('AI không trả về nội dung.');
  const parts: GeminiPart[] = [];
  if (msg.content) parts.push({ text: msg.content });
  for (const tc of msg.tool_calls ?? []) {
    if (!tc.function?.name) continue;
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* giữ {} */ }
    parts.push({ functionCall: { name: tc.function.name, args } });
  }
  if (parts.length === 0) throw new Error('AI không trả về nội dung.');
  return {
    parts,
    usage: { prompt: data?.usage?.prompt_tokens ?? 0, completion: data?.usage?.completion_tokens ?? 0 },
    rateLimit: parseRateLimitHeaders(respHeaders),
  };
}

// ---------------------------------------------------------------------------
// Lấy danh sách model mà key đang dùng được phép gọi (để người dùng tự chọn).
// Gemini: GET /v1beta/models?key= — các hãng còn lại: GET {base}/models (Bearer).
// ---------------------------------------------------------------------------

interface GeminiModelsResp {
  models?: { name?: string; supportedGenerationMethods?: string[] }[];
  error?: { message?: string };
}

interface OpenAIModelsResp {
  data?: { id?: string }[];
  error?: { message?: string } | string;
}

export async function fetchProviderModels(def: AiProviderDef, key: string, accountId?: string, customBaseURL?: string): Promise<string[]> {
  const parse = (text: string) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  };
  const ctrlMs = 20000;
  if (def.style === 'gemini') {
    const r = await aiFetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      { method: 'GET', timeoutMs: ctrlMs },
    );
    const data = parse(r.text) as GeminiModelsResp | null;
    if (!r.ok) throw new Error(data?.error?.message ?? `HTTP ${r.status}`);
    return (data?.models ?? [])
      .filter((m) => (m.name ?? '').startsWith('models/') && (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => m.name!.slice('models/'.length));
  }
  if (def.id === 'cloudflare')
    throw new Error('Cloudflare Workers AI không có API liệt kê model — dùng danh sách gợi ý sẵn.');
  const base = buildBaseURL(def, accountId, customBaseURL);
  if (!base) throw new Error(`${def.name}: thiếu Account ID hoặc Base URL.`);

  const headers: Record<string, string> = {};
  if (key && key.trim()) {
    headers.Authorization = `Bearer ${key.trim()}`;
  }

  if (def.id === 'ollama') {
    try {
      const r = await aiFetch(`${base.replace(/\/$/, '')}/models`, { method: 'GET', headers, timeoutMs: ctrlMs });
      if (r.ok) {
        const data = parse(r.text) as OpenAIModelsResp | null;
        const models = (data?.data ?? []).map((m) => m.id ?? '').filter(Boolean).sort();
        if (models.length > 0) return models;
      }
    } catch {
      // Fallback sang endpoint native bên dưới
    }
    const nativeBase = base.replace(/\/v1\/?$/, '');
    try {
      const r = await aiFetch(`${nativeBase}/api/tags`, { method: 'GET', headers, timeoutMs: ctrlMs });
      if (r.ok) {
        const data = parse(r.text) as { models?: { name?: string }[] } | null;
        const models = (data?.models ?? []).map((m) => m.name ?? '').filter(Boolean).sort();
        if (models.length > 0) return models;
      }
    } catch (e) {
      throw new Error(`Không kết nối được Ollama tại ${base}. Đảm bảo Ollama đang chạy (ollama serve). Lỗi: ${e instanceof Error ? e.message : String(e)}`);
    }
    return def.models;
  }

  const r = await aiFetch(`${base.replace(/\/$/, '')}/models`, {
    method: 'GET',
    headers,
    timeoutMs: ctrlMs,
  });
  const data = parse(r.text) as OpenAIModelsResp | null;
  if (!r.ok) throw new Error(typeof data?.error === 'string' ? data.error : (data?.error?.message ?? `HTTP ${r.status}`));
  // Bỏ model không dùng cho chat (realtime/embed/ocr/audio...) — gọi chat/completions sẽ 400
  const NON_CHAT = /realtime|embed|ocr|transcri|tts|speech|audio|voxtral|whisper|dall/i;
  return (data?.data ?? []).map((m) => m.id ?? '').filter((id) => id && !NON_CHAT.test(id)).sort();
}
