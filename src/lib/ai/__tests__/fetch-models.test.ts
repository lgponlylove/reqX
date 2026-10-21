import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchProviderModels } from '../openai-chat';
import { providerDef } from '../ai-providers';

afterEach(() => vi.unstubAllGlobals());

function mockFetch(ok: boolean, body: unknown, status = 200, headers: Record<string, string> = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok, status,
    text: async () => JSON.stringify(body),
    headers: { forEach: (fn: (v: string, k: string) => void) => Object.entries(headers).forEach(([k, v]) => fn(v, k)) },
  })));
}

describe('fetchProviderModels', () => {
  it('gemini: chỉ lấy model hỗ trợ generateContent, bỏ tiền tố models/', async () => {
    mockFetch(true, {
      models: [
        { name: 'models/gemini-flash-lite-latest', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
      ],
    });
    await expect(fetchProviderModels(providerDef('gemini')!, 'k')).resolves.toEqual(['gemini-flash-lite-latest']);
  });

  it('gemini: key sai → ném message của API', async () => {
    mockFetch(false, { error: { message: 'API key not valid.' } }, 400);
    await expect(fetchProviderModels(providerDef('gemini')!, 'sai')).rejects.toThrow('API key not valid.');
  });

  it('groq/mistral/openrouter: đọc data[].id, bỏ model không-chat, sắp xếp', async () => {
    mockFetch(true, { data: [{ id: 'zzz' }, { id: 'voxtral-mini-realtime-latest' }, { id: 'aaa' }, { id: 'embed-x' }] });
    await expect(fetchProviderModels(providerDef('groq')!, 'k')).resolves.toEqual(['aaa', 'zzz']);
  });

  it('cloudflare: báo rõ không có API liệt kê', async () => {
    await expect(fetchProviderModels(providerDef('cloudflare')!, 'k', 'acc')).rejects.toThrow('không có API liệt kê');
  });

  it('openai: lọc model chat và sắp xếp', async () => {
    mockFetch(true, { data: [{ id: 'gpt-4o' }, { id: 'dall-e-3' }, { id: 'text-embedding-3-small' }, { id: 'gpt-4o-mini' }] });
    await expect(fetchProviderModels(providerDef('openai')!, 'sk-test')).resolves.toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  it('anthropic: đọc data[].id từ api.anthropic.com/v1/models', async () => {
    mockFetch(true, { data: [{ id: 'claude-3-7-sonnet-20250219' }, { id: 'claude-3-5-haiku-20241022' }] });
    await expect(fetchProviderModels(providerDef('anthropic')!, 'sk-ant-test')).resolves.toEqual([
      'claude-3-5-haiku-20241022',
      'claude-3-7-sonnet-20250219',
    ]);
  });

  it('thiếu accountId → báo thiếu; key hợp lệ rỗng → mảng rỗng', async () => {
    await expect(fetchProviderModels(providerDef('cloudflare')!, 'k')).rejects.toThrow();
    mockFetch(true, { data: [] });
    await expect(fetchProviderModels(providerDef('mistral')!, 'k')).resolves.toEqual([]);
  });
});
