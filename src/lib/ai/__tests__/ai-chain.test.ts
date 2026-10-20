import { describe, expect, it } from 'vitest';
import { AI_PROVIDERS, buildBaseURL, orderChain, pickOrder, entryTier, entryRpm, TierBucket, parseRateLimitHeaders, adaptiveInit, adaptOnSuccess, adaptOnRateLimit, providerDef, type AiChainEntry } from '../ai-providers';
import { toOpenAIMessages, toOpenAITools } from '../openai-chat';
import type { GeminiContent, GeminiFunctionDecl } from '../gemini';

const entry = (over: Partial<AiChainEntry> = {}): AiChainEntry => ({
  id: Math.random().toString(36).slice(2), providerId: 'gemini', model: 'm', key: 'k', enabled: true, ...over,
});

describe('ai-providers', () => {
  it('đủ 7 provider: gemini/groq/mistral/openrouter/cloudflare/sambanova/ollama', () => {
    expect(AI_PROVIDERS.map((p) => p.id).sort()).toEqual(['cloudflare', 'gemini', 'groq', 'mistral', 'ollama', 'openrouter', 'sambanova']);
  });

  it('ollama không cần key vẫn được orderChain đưa vào nếu enabled', () => {
    const chain = [entry({ id: 'ol', providerId: 'ollama', model: 'llama3.2', key: '' })];
    expect(orderChain(chain, 0, 'save-cost').map((e) => e.id)).toEqual(['ol']);
  });

  it('buildBaseURL ưu tiên customBaseURL nếu có', () => {
    const ol = providerDef('ollama')!;
    expect(buildBaseURL(ol)).toBe('http://localhost:11434/v1');
    expect(buildBaseURL(ol, undefined, 'http://192.168.1.100:11434/v1')).toBe('http://192.168.1.100:11434/v1');
  });

  it('cloudflare cần accountId, thiếu thì base rỗng', () => {
    const cf = providerDef('cloudflare')!;
    expect(buildBaseURL(cf)).toBe('');
    expect(buildBaseURL(cf, 'abc123')).toBe('https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1');
  });

  it('groq có trần maxTokens 16384 (vụ gpt-oss-120b)', () => {
    expect(providerDef('groq')!.maxTokensCap).toBe(16384);
  });

  it('pickOrder: bỏ entry tắt/thiếu key, xoay vòng theo rrIndex', () => {
    const chain = [entry({ id: 'a' }), entry({ id: 'b', enabled: false }), entry({ id: 'c', key: '' }), entry({ id: 'd' })];
    expect(pickOrder(chain, 0).map((e) => e.id)).toEqual(['a', 'd']);
    expect(pickOrder(chain, 1).map((e) => e.id)).toEqual(['d', 'a']);
    expect(pickOrder(chain, 5).map((e) => e.id)).toEqual(['d', 'a']); // 5 % 2 = 1
  });

  it('pickOrder rỗng khi không có nấc dùng được', () => {
    expect(pickOrder([entry({ enabled: false })], 0)).toEqual([]);
  });

  it('entryTier: ghi đè entry thắng hãng; entryRpm mặc định free 10 / paid 1000', () => {
    expect(entryTier(entry(), providerDef('groq'))).toBe('free');
    expect(entryTier(entry({ tier: 'paid' }), providerDef('groq'))).toBe('paid');
    expect(entryRpm(entry(), providerDef('groq'))).toBe(10);
    expect(entryRpm(entry({ tier: 'paid' }), providerDef('groq'))).toBe(1000);
  });

  it('orderChain save-cost: free trước rồi paid; stable ngược lại', () => {
    const chain = [entry({ id: 'p1', tier: 'paid' }), entry({ id: 'f1' }), entry({ id: 'f2' })];
    expect(orderChain(chain, 0, 'save-cost').map((e) => e.id)).toEqual(['f1', 'f2', 'p1']);
    expect(orderChain(chain, 0, 'stable').map((e) => e.id)).toEqual(['p1', 'f1', 'f2']);
  });

  it('orderChain xoay vòng riêng từng nhóm bậc', () => {
    const chain = [entry({ id: 'p1', tier: 'paid' }), entry({ id: 'f1' }), entry({ id: 'f2' })];
    expect(orderChain(chain, 1, 'save-cost').map((e) => e.id)).toEqual(['f2', 'f1', 'p1']);
  });

  it('TierBucket: hết lượt thì false, qua cửa sổ thì hồi; left() để khóa tạm khi gần chạm trần', () => {
    const b = new TierBucket(2, 1000);
    expect(b.take(0)).toBe(true);
    expect(b.left(0)).toBe(1);
    expect(b.take(0)).toBe(true);
    expect(b.left(0)).toBe(0);
    expect(b.take(0)).toBe(false);
    expect(b.take(1001)).toBe(true);
  });

  it('entryRpm: entry ghi đè thắng hãng thắng mặc định bậc', () => {
    const def = { ...providerDef('groq')!, rpm: 50 };
    expect(entryRpm(entry(), def)).toBe(50);
    expect(entryRpm(entry({ rpm: 7 }), def)).toBe(7);
    expect(entryRpm(entry(), providerDef('groq'))).toBe(10);
  });

  it('parseRateLimitHeaders: đọc kiểu OpenAI, key thường', () => {
    expect(parseRateLimitHeaders({})).toBeUndefined();
    const r = parseRateLimitHeaders({
      'x-ratelimit-limit-requests': '30',
      'x-ratelimit-remaining-requests': '0',
      'retry-after': '20',
    }, 1000000);
    expect(r).toEqual({ limit: 30, remaining: 0, resetMs: 1020000 });
  });

  it('AIMD: OK tăng dần tới trần, 429 giảm nửa, header cho số thật thì theo', () => {
    let s = adaptiveInit(10);
    expect(s.learned).toBe(10);
    s = adaptOnRateLimit(s);
    expect(s.learned).toBe(5);
    s = adaptOnSuccess(s, 10);
    expect(s.learned).toBe(6);
    s = adaptOnRateLimit(s, 30);
    expect(s.learned).toBe(30);
    s = adaptOnRateLimit(adaptiveInit(1));
    expect(s.learned).toBe(1); // không xuống dưới 1
  });
});

describe('openai-chat convert', () => {
  it('tools: type HOA → thường', () => {
    const decls: GeminiFunctionDecl[] = [{
      name: 'list_requests', description: 'x',
      parameters: { type: 'OBJECT', properties: { collection_ref: { type: 'STRING', description: 'y' } }, required: ['collection_ref'] },
    }];
    const [t] = toOpenAITools(decls);
    expect(t).toEqual({
      type: 'function',
      function: {
        name: 'list_requests', description: 'x',
        parameters: { type: 'object', properties: { collection_ref: { type: 'string', description: 'y' } }, required: ['collection_ref'] },
      },
    });
  });

  it('messages: giữ cặp call/response qua tool_call_id', () => {
    const contents: GeminiContent[] = [
      { role: 'user', parts: [{ text: 'chạy flow X' }] },
      { role: 'model', parts: [{ functionCall: { name: 'run_flow', args: { flow_ref: 'X' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'run_flow', response: { ok: true } } }] },
    ];
    const msgs = toOpenAIMessages(contents);
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'chạy flow X' });
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].tool_calls![0].function.name).toBe('run_flow');
    expect(msgs[2]).toMatchObject({ role: 'tool', tool_call_id: msgs[1].tool_calls![0].id });
    expect(JSON.parse(msgs[2].content!)).toEqual({ ok: true });
  });
});
