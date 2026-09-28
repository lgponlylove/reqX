import { describe, expect, it } from 'vitest';
import { AI_PROVIDERS, buildBaseURL, pickOrder, providerDef, type AiChainEntry } from '../ai-providers';
import { toOpenAIMessages, toOpenAITools } from '../openai-chat';
import type { GeminiContent, GeminiFunctionDecl } from '../gemini';

const entry = (over: Partial<AiChainEntry> = {}): AiChainEntry => ({
  id: Math.random().toString(36).slice(2), providerId: 'gemini', model: 'm', key: 'k', enabled: true, ...over,
});

describe('ai-providers', () => {
  it('đủ 6 provider: gemini/groq/mistral/openrouter/cloudflare/sambanova', () => {
    expect(AI_PROVIDERS.map((p) => p.id).sort()).toEqual(['cloudflare', 'gemini', 'groq', 'mistral', 'openrouter', 'sambanova']);
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
