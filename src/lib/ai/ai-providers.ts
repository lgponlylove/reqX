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

/** Bậc dùng: free (trần thấp, bỏ qua nhanh khi sập) hay paid (trần cao, retry đàng hoàng). */
export type AiTier = 'free' | 'paid';

/** Tokens 1 lần gọi (để ước tính chi phí nấc paid). */
export interface AiUsage {
  prompt: number;
  completion: number;
}

/** Chiến lược gọi chain: tiết kiệm (free trước, tràn mới sang paid) hay ổn định (paid trước). */
export type AiStrategy = 'save-cost' | 'stable';

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
  /** Bậc mặc định của hãng (cho phép ghi đè từng nấc trong chain). */
  tier: AiTier;
  /** Trần gọi/phút để admission control (mặc định: free 10, paid 1000). */
  rpm?: number;
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
    tier: 'free',
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
    tier: 'free',
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
    tier: 'free',
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
    tier: 'free',
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
    tier: 'free',
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
    tier: 'free',
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
  /** Ghi đè bậc của hãng (để trống = theo hãng). Thêm nấc trả phí thì đặt 'paid' ở đây. */
  tier?: AiTier;
  /** Ghi đè trần gọi/phút (để trống = tự học + mặc định bậc). Nhập số trong console hãng nếu biết. */
  rpm?: number;
}

/** Bậc hiệu lực của 1 nấc (ghi đè entry thắng hãng). */
export function entryTier(e: AiChainEntry, def?: AiProviderDef): AiTier {
  return e.tier ?? def?.tier ?? 'free';
}

/** Trần gọi/phút hiệu lực: entry ghi đè > hãng ghi đè > mặc định theo bậc. */
export function entryRpm(e: AiChainEntry, def?: AiProviderDef): number {
  if (e.rpm && e.rpm > 0) return Math.floor(e.rpm);
  if (def?.rpm) return def.rpm;
  return entryTier(e, def) === 'paid' ? 1000 : 10;
}

function rotate<T>(arr: T[], start: number): T[] {
  if (arr.length === 0) return [];
  const s = ((start % arr.length) + arr.length) % arr.length;
  return [...arr.slice(s), ...arr.slice(0, s)];
}

/**
 * Thứ tự thử trong 1 lượt chat: chỉ entry enabled + có key/model.
 * - save-cost: free trước (xoay vòng), tràn mới sang paid — rẻ.
 * - stable: paid trước, free dự phòng — ổn định.
 */
export function orderChain(chain: AiChainEntry[], rrIndex: number, strategy: AiStrategy): AiChainEntry[] {
  const on = chain.filter((e) => e.enabled && e.key.trim() && e.model.trim());
  if (on.length === 0) return [];
  const defOf = (e: AiChainEntry) => providerDef(e.providerId);
  const free = rotate(on.filter((e) => entryTier(e, defOf(e)) === 'free'), rrIndex);
  const paid = rotate(on.filter((e) => entryTier(e, defOf(e)) === 'paid'), rrIndex);
  return strategy === 'stable' ? [...paid, ...free] : [...free, ...paid];
}

/** Giữ tương thích: xoay vòng mù (mặc định save-cost). */
export function pickOrder(chain: AiChainEntry[], rrIndex: number): AiChainEntry[] {
  return orderChain(chain, rrIndex, 'save-cost');
}

// ---------------------------------------------------------------------------
// Học trần thật lúc chạy (vì không hãng nào công bố số cố định cho mọi key):
//  1. Header rate-limit (nếu hãng trả về) → biết chính xác còn bao nhiêu lượt.
//  2. AIMD: gọi OK thì tăng dần, dính 429 thì giảm mạnh → tự hội tụ đúng trần key.
// ---------------------------------------------------------------------------

/** Thông tin rate-limit đọc từ headers response (kiểu OpenAI: x-ratelimit-*). */
export interface AiRateLimit {
  limit?: number;
  remaining?: number;
  /** Thời điểm hồi (ms epoch) — từ retry-after hoặc x-ratelimit-reset-* */
  resetMs?: number;
}

function num(v: string | undefined): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse headers (key đã viết thường) → AiRateLimit. Không có header nào thì undefined. */
export function parseRateLimitHeaders(h: Record<string, string>, now = Date.now()): AiRateLimit | undefined {
  const limit =
    num(h['x-ratelimit-limit-requests']) ?? num(h['x-ratelimit-limit']) ?? num(h['ratelimit-limit']);
  const remaining =
    num(h['x-ratelimit-remaining-requests']) ?? num(h['x-ratelimit-remaining']) ?? num(h['ratelimit-remaining']);
  const retryAfter = num(h['retry-after']);
  const resetS =
    num(h['x-ratelimit-reset-requests']) ?? num(h['x-ratelimit-reset']) ?? num(h['ratelimit-reset']);
  if (limit === undefined && remaining === undefined && retryAfter === undefined && resetS === undefined)
    return undefined;
  return {
    limit,
    remaining,
    resetMs: retryAfter !== undefined ? now + retryAfter * 1000 : resetS !== undefined ? resetS * 1000 : undefined,
  };
}

/** Trạng thái học trần của 1 nấc: bắt đầu = trần cấu hình, tự chỉnh theo thực tế. */
export interface AdaptiveState {
  learned: number;
}

export function adaptiveInit(configured: number): AdaptiveState {
  return { learned: Math.max(1, Math.floor(configured)) };
}

/** Gọi OK → tăng dần (+1) tới trần cấu hình (không vượt số user nhập). */
export function adaptOnSuccess(s: AdaptiveState, cap: number): AdaptiveState {
  return { learned: Math.min(Math.max(1, Math.floor(cap)), s.learned + 1) };
}

/** Dính 429 → giảm nửa (tối thiểu 1). Header cho limit thật thì nhảy thẳng về đó. */
export function adaptOnRateLimit(s: AdaptiveState, headerLimit?: number): AdaptiveState {
  const next = headerLimit && headerLimit > 0 ? Math.floor(headerLimit) : Math.floor(s.learned / 2);
  return { learned: Math.max(1, next) };
}

// ---------------------------------------------------------------------------
// TierBucket: token bucket đếm lượt/phút cho admission.
// Hết lượt thì bỏ qua bậc đó trong lượt này (xếp hàng chờ hồi), không nện thêm.
// Backend multi-user: 1 bucket/bậc dùng chung + hàng đợi FIFO phía trên.
// ---------------------------------------------------------------------------

export class TierBucket {
  private hits: number[] = [];
  constructor(public rpm: number, public windowMs = 60000) {}
  /** Còn lượt không? Hết thì trả false (không trừ). */
  take(now = Date.now()): boolean {
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    if (this.hits.length >= this.rpm) return false;
    this.hits.push(now);
    return true;
  }
  /** Số lượt còn lại trong cửa sổ hiện tại (để hiện UI). */
  left(now = Date.now()): number {
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    return Math.max(0, this.rpm - this.hits.length);
  }
}
