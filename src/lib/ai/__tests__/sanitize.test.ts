import { describe, expect, it } from 'vitest';
import { sanitizeContents, type GeminiContent } from '../gemini';

const ut = (s: string): GeminiContent => ({ role: 'user', parts: [{ text: s }] });
const mt = (s: string): GeminiContent => ({ role: 'model', parts: [{ text: s }] });
const call = (name: string): GeminiContent => ({ role: 'model', parts: [{ functionCall: { name, args: {} } }] });
const resp = (name: string): GeminiContent => ({ role: 'user', parts: [{ functionResponse: { name, response: { ok: true } } }] });

describe('sanitizeContents', () => {
  it('giữ nguyên history hợp lệ', () => {
    const h = [ut('a'), mt('b'), call('list_flows'), resp('list_flows'), ut('c')];
    expect(sanitizeContents(h)).toHaveLength(5);
  });

  it('vết cắt giữa cặp call/response: bỏ response mồ côi, GIỮ tin nhắn phía sau', () => {
    const cut = [resp('list_flows'), ut('câu hỏi mới')];
    const fixed = sanitizeContents(cut);
    expect(fixed).toHaveLength(1);
    expect(fixed[0]).toEqual(ut('câu hỏi mới'));
  });

  it('model-call treo (không có response): gỡ call, giữ text sau đó', () => {
    const h = [ut('a'), call('run_flow'), ut('thôi đừng chạy nữa')];
    const fixed = sanitizeContents(h);
    expect(fixed).toEqual([ut('a'), ut('thôi đừng chạy nữa')]);
  });

  it('giữ cặp multi-call đủ response (kể cả lẫn text)', () => {
    const h = [
      ut('q'),
      { role: 'model', parts: [{ functionCall: { name: 'a', args: {} } }, { functionCall: { name: 'b', args: {} } }] } as GeminiContent,
      { role: 'user', parts: [{ text: 'x' }, { functionResponse: { name: 'a', response: {} } }, { functionResponse: { name: 'b', response: {} } }] } as GeminiContent,
    ];
    expect(sanitizeContents(h)).toHaveLength(3);
  });

  it('thiếu 1 response trong multi-call: gỡ call, giữ text', () => {
    const h = [
      ut('q'),
      { role: 'model', parts: [{ functionCall: { name: 'a', args: {} } }, { functionCall: { name: 'b', args: {} } }] } as GeminiContent,
      { role: 'user', parts: [{ text: 'chờ đã' }, { functionResponse: { name: 'a', response: {} } }] } as GeminiContent,
      ut('tiếp đi'),
    ];
    const fixed = sanitizeContents(h);
    expect(fixed.map((t) => t.role)).toEqual(['user', 'user', 'user']);
    expect(fixed[1]).toEqual({ role: 'user', parts: [{ text: 'chờ đã' }] });
  });
});
