/**
 * CẤU HÌNH PROVIDERS CHO TRỢ LÝ CHAT — cả thư mục `ai/` này là module dùng chung,
 * copy nguyên thư mục sang project khác được (không import gì từ app).
 *
 * Cách dùng ở project mới:
 *  1. Copy nguyên thư mục `ai/` sang project mới (giữ nguyên cấu trúc trong).
 *  2. Định nghĩa history/tools theo format Gemini* ở dưới (hoặc dùng thẳng GeminiContent).
 *  3. Gọi `pickOrder(chain, rrIndex)` để lấy thứ tự thử → gọi client tương ứng theo `style`.
 */

export type AiApiStyle = 'gemini' | 'openai-compatible';

/** Định nghĩa 1 provider (dữ liệu tĩnh — key/model do người dùng nhập ở chain). */
export interface AiProviderDef {
  id: string;
  name: string;
  style: AiApiStyle;
  /** Có thể chứa {accountId} — dùng buildBaseURL() để thay. */
  baseURL: string;
  needsAccountId?: boolean;
  accountLabel?: string;
  keyLabel: string;
  keyPlaceholder: string;
  models: string[];
  defaultModel: string;
  /** Trần max_tokens của provider (vd Groq gpt-oss-120b chỉ cho 16384). */
  maxTokensCap?: number;
  notes: string;
}

export const AI_PROVIDERS: AiProviderDef[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    style: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/models',
    keyLabel: 'API key (Google AI Studio)',
    keyPlaceholder: 'Dán key lấy ở aistudio.google.com',
    models: ['gemini-flash-lite-latest', 'gemini-flash-latest'],
    defaultModel: 'gemini-flash-lite-latest',
    notes: 'Gói free rộng rãi, hợp làm mặc định.',
  },
  {
    id: 'groq',
    name: 'Groq',
    style: 'openai-compatible',
    baseURL: 'https://api.groq.com/openai/v1',
    keyLabel: 'API key (console.groq.com)',
    keyPlaceholder: 'gsk_...',
    models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'],
    defaultModel: 'openai/gpt-oss-120b',
    maxTokensCap: 16384,
    notes: 'Rất nhanh. Gói on_demand giới hạn 8000 TPM — hợp chat lẻ, không hợp agent code nặng.',
  },
  {
    id: 'mistral',
    name: 'Mistral (La Plateforme)',
    style: 'openai-compatible',
    baseURL: 'https://api.mistral.ai/v1',
    keyLabel: 'API key (console.mistral.ai)',
    keyPlaceholder: 'Dán key La Plateforme',
    models: ['devstral-medium-latest', 'codestral-latest', 'mistral-small-latest', 'mistral-medium-latest'],
    defaultModel: 'devstral-medium-latest',
    notes: 'Devstral hợp agentic coding. Free mode giới hạn thấp — chạy ổn định thì dùng pay-as-you-go + spending limit.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    style: 'openai-compatible',
    baseURL: 'https://openrouter.ai/api/v1',
    keyLabel: 'API key (openrouter.ai)',
    keyPlaceholder: 'sk-or-...',
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'mistralai/devstral-medium:free'],
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    notes: 'Một key gọi hàng trăm model. Model :free hay hết quota — để cuối chain làm dự phòng.',
  },
  {
    id: 'sambanova',
    name: 'SambaNova Cloud',
    style: 'openai-compatible',
    baseURL: 'https://api.sambanova.ai/v1',
    keyLabel: 'API key (cloud.sambanova.ai)',
    keyPlaceholder: 'Dán key SambaNova Cloud',
    models: ['Meta-Llama-3.3-70B-Instruct', 'gpt-oss-120b', 'DeepSeek-V3.1'],
    defaultModel: 'Meta-Llama-3.3-70B-Instruct',
    notes: 'Nhanh, free tier rộng. Chỉ model trong list mới hỗ trợ tool-call (Qwen 2.5 Coder không gọi tool được).',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    style: 'openai-compatible',
    baseURL: 'https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1',
    needsAccountId: true,
    accountLabel: 'Account ID (Cloudflare dashboard)',
    keyLabel: 'API token (Workers AI)',
    keyPlaceholder: 'Dán token có quyền Workers AI',
    models: ['@cf/meta/llama-3.1-8b-instruct', '@cf/mistral/mistral-7b-instruct-v0.3'],
    defaultModel: '@cf/meta/llama-3.1-8b-instruct',
    notes: 'Cần Account ID + token. Không phải model nào cũng hỗ trợ tools — lỗi thì chain tự nhảy sang provider khác.',
  },
];

export function providerDef(id: string): AiProviderDef | undefined {
  return AI_PROVIDERS.find((p) => p.id === id);
}

/** Thay {accountId} trong baseURL (Cloudflare). Thiếu accountId → trả '' để UI báo lỗi rõ. */
export function buildBaseURL(def: AiProviderDef, accountId?: string): string {
  if (!def.baseURL.includes('{accountId}')) return def.baseURL;
  const id = (accountId ?? '').trim();
  if (!id) return '';
  return def.baseURL.replace('{accountId}', encodeURIComponent(id));
}

// ---------------------------------------------------------------------------
// Chain: danh sách entry do người dùng sắp xếp — vừa xoay vòng vừa failover.
// ---------------------------------------------------------------------------

/** 1 nấc trong chain: provider nào + model nào + key nào. */
export interface AiChainEntry {
  id: string;
  providerId: string;
  model: string;
  key: string;
  accountId?: string;
  enabled: boolean;
}

/**
 * Thứ tự thử trong 1 lượt chat: chỉ entry enabled, xoay vòng từ rrIndex
 * (chia tải đều) — entry lỗi thì vòng gọi ở ngoài bỏ qua, thử tiếp entry sau (failover).
 */
export function pickOrder(chain: AiChainEntry[], rrIndex: number): AiChainEntry[] {
  const on = chain.filter((e) => e.enabled && e.key.trim() && e.model.trim());
  if (on.length === 0) return [];
  const start = ((rrIndex % on.length) + on.length) % on.length;
  return [...on.slice(start), ...on.slice(0, start)];
}
