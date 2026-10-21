/**
 * Client chat cho Anthropic Claude (Messages API).
 * Chuẩn hóa input từ Gemini format sang Anthropic format và ngược lại.
 */
import type { GeminiContent, GeminiFunctionDecl, GeminiPart } from './gemini';
import { aiFetch } from './ai-fetch';
import { parseRateLimitHeaders, type AiProviderDef, type AiRateLimit, type AiUsage } from './ai-providers';
import { SseStreamParser } from '../sse-parser';

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

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export function toAnthropicTools(decls: GeminiFunctionDecl[]): AnthropicTool[] {
  return decls.map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: lowerSchema(d.parameters as unknown as Record<string, unknown>),
  }));
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

export function toAnthropicMessages(contents: GeminiContent[]): AnthropicMessage[] {
  const rawList: { role: 'user' | 'assistant'; blocks: AnthropicContentBlock[] }[] = [];
  const pending = new Map<string, string[]>();

  contents.forEach((t, ti) => {
    if (t.role === 'user' && t.parts.some((p) => p.functionResponse)) {
      const blocks: AnthropicContentBlock[] = [];
      for (const p of t.parts) {
        if (p.functionResponse) {
          const ids = pending.get(p.functionResponse.name);
          const toolUseId = ids?.shift() ?? `toolu_${ti}_${p.functionResponse.name}`;
          blocks.push({
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: JSON.stringify(p.functionResponse.response ?? {}),
          });
        } else if (typeof p.text === 'string' && p.text) {
          blocks.push({ type: 'text', text: p.text });
        }
      }
      if (blocks.length > 0) rawList.push({ role: 'user', blocks });
      return;
    }

    if (t.role === 'model' && t.parts.some((p) => p.functionCall)) {
      const blocks: AnthropicContentBlock[] = [];
      const text = t.parts.map((p) => p.text ?? '').join('');
      if (text) blocks.push({ type: 'text', text });

      t.parts
        .filter((p) => p.functionCall)
        .forEach((p, k) => {
          const id = `toolu_${ti}_${p.functionCall!.name}_${k}`;
          const arr = pending.get(p.functionCall!.name) ?? [];
          arr.push(id);
          pending.set(p.functionCall!.name, arr);
          blocks.push({
            type: 'tool_use',
            id,
            name: p.functionCall!.name,
            input: p.functionCall!.args ?? {},
          });
        });

      if (blocks.length > 0) rawList.push({ role: 'assistant', blocks });
      return;
    }

    const text = t.parts.map((p) => p.text ?? '').join('');
    if (text) {
      rawList.push({
        role: t.role === 'model' ? 'assistant' : 'user',
        blocks: [{ type: 'text', text }],
      });
    }
  });

  // Gộp các lượt liên tiếp cùng role (Anthropic yêu cầu luân phiên user/assistant)
  const merged: AnthropicMessage[] = [];
  for (const item of rawList) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === item.role) {
      prev.content.push(...item.blocks);
    } else {
      merged.push({ role: item.role, content: [...item.blocks] });
    }
  }

  // Anthropic yêu cầu message đầu tiên phải là user
  if (merged.length > 0 && merged[0].role !== 'user') {
    merged.unshift({ role: 'user', content: [{ type: 'text', text: 'Hello' }] });
  }

  return merged;
}

export interface AnthropicChatOpts {
  baseURL?: string;
  key: string;
  model: string;
  system: string;
  contents: GeminiContent[];
  tools: GeminiFunctionDecl[];
  maxTokens?: number;
  onDelta?: (delta: string) => void;
}

interface AnthropicResp {
  id?: string;
  type?: string;
  role?: string;
  content?: (
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  )[];
  stop_reason?: string;
  error?: { type: string; message: string };
  usage?: { input_tokens?: number; output_tokens?: number };
}

async function streamAnthropicChat(
  o: AnthropicChatOpts,
  onDelta: (delta: string) => void,
): Promise<{ parts: GeminiPart[]; usage: AiUsage; rateLimit?: AiRateLimit } | null> {
  const base = (o.baseURL || 'https://api.anthropic.com/v1').replace(/\/$/, '');
  const url = `${base}/messages`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40000);

  try {
    const tools = toAnthropicTools(o.tools);
    const body: Record<string, unknown> = {
      model: o.model,
      messages: toAnthropicMessages(o.contents),
      max_tokens: o.maxTokens ?? 4096,
      stream: true,
    };
    if (o.system) body.system = o.system;
    if (tools.length > 0) body.tools = tools;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': o.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok || !res.body) return null;

    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { respHeaders[k.toLowerCase()] = v; });

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    const toolMap: Record<number, { id: string; name: string; json: string }> = {};
    let promptTokens = 0;
    let completionTokens = 0;

    const parser = new SseStreamParser((ev) => {
      const dataStr = ev.data.trim();
      if (!dataStr) return;
      try {
        const json = JSON.parse(dataStr);
        if (json.type === 'message_start' && json.message?.usage) {
          promptTokens = json.message.usage.input_tokens ?? promptTokens;
          completionTokens = json.message.usage.output_tokens ?? completionTokens;
        } else if (json.type === 'message_delta' && json.usage) {
          completionTokens = json.usage.output_tokens ?? completionTokens;
        } else if (json.type === 'content_block_start') {
          const idx = json.index ?? 0;
          if (json.content_block?.type === 'tool_use') {
            toolMap[idx] = {
              id: json.content_block.id ?? `toolu_${idx}`,
              name: json.content_block.name ?? '',
              json: '',
            };
          }
        } else if (json.type === 'content_block_delta') {
          const idx = json.index ?? 0;
          if (json.delta?.type === 'text_delta' && typeof json.delta.text === 'string') {
            fullText += json.delta.text;
            onDelta(json.delta.text);
          } else if (json.delta?.type === 'input_json_delta' && typeof json.delta.partial_json === 'string') {
            if (toolMap[idx]) {
              toolMap[idx].json += json.delta.partial_json;
            }
          }
        }
      } catch {
        // chunk parse error, ignore
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
    for (const tc of Object.values(toolMap)) {
      if (!tc.name) continue;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.json || '{}'); } catch { args = {}; }
      parts.push({ functionCall: { name: tc.name, args } });
    }

    if (parts.length === 0) return null;

    return {
      parts,
      usage: { prompt: promptTokens, completion: completionTokens },
      rateLimit: parseRateLimitHeaders(respHeaders),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function anthropicChat(
  o: AnthropicChatOpts,
): Promise<{ parts: GeminiPart[]; usage: AiUsage; rateLimit?: AiRateLimit }> {
  if (o.onDelta) {
    const streamed = await streamAnthropicChat(o, o.onDelta);
    if (streamed) return streamed;
  }

  const base = (o.baseURL || 'https://api.anthropic.com/v1').replace(/\/$/, '');
  const url = `${base}/messages`;
  let status = 0;
  let data: AnthropicResp | null = null;
  let respHeaders: Record<string, string> = {};

  try {
    const tools = toAnthropicTools(o.tools);
    const body: Record<string, unknown> = {
      model: o.model,
      messages: toAnthropicMessages(o.contents),
      max_tokens: o.maxTokens ?? 4096,
    };
    if (o.system) body.system = o.system;
    if (tools.length > 0) body.tools = tools;

    const r = await aiFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': o.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      timeoutMs: 35000,
    });
    status = r.status;
    respHeaders = r.headers;
    try {
      data = JSON.parse(r.text) as AnthropicResp;
    } catch {
      data = null;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError')
      throw new Error('Anthropic Claude quá 35s không phản hồi (timeout) — thử lại hoặc chuyển model.');
    throw new Error(`Không gọi được Claude API: ${e instanceof Error ? e.message : String(e)}`);
  }

  const errMsg = data?.error?.message ?? (status >= 200 && status < 300 ? null : `HTTP ${status}`);
  if (errMsg) throw new Error(`Claude lỗi: ${String(errMsg).slice(0, 300)}`);

  const parts: GeminiPart[] = [];
  for (const block of data?.content ?? []) {
    if (block.type === 'text' && block.text) {
      parts.push({ text: block.text });
    } else if (block.type === 'tool_use' && block.name) {
      parts.push({
        functionCall: {
          name: block.name,
          args: block.input ?? {},
        },
      });
    }
  }

  if (parts.length === 0) throw new Error('Claude không trả về nội dung.');

  return {
    parts,
    usage: {
      prompt: data?.usage?.input_tokens ?? 0,
      completion: data?.usage?.output_tokens ?? 0,
    },
    rateLimit: parseRateLimitHeaders(respHeaders),
  };
}

/** Lấy danh sách model từ API Anthropic (hoặc fallback danh sách chuẩn) */
export async function fetchAnthropicModels(def: AiProviderDef, key: string): Promise<string[]> {
  const ctrlMs = 15000;
  const headers: Record<string, string> = {
    'x-api-key': key.trim(),
    'anthropic-version': '2023-06-01',
  };
  try {
    const r = await aiFetch('https://api.anthropic.com/v1/models', { method: 'GET', headers, timeoutMs: ctrlMs });
    if (r.ok) {
      const data = JSON.parse(r.text) as { data?: { id?: string }[] };
      const models = (data?.data ?? []).map((m) => m.id ?? '').filter(Boolean).sort();
      if (models.length > 0) return models;
    }
  } catch {
    // fallback
  }
  return def.models;
}
