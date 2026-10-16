import { describe, it, expect } from 'vitest';
import {
  SseStreamParser,
  parseAllSseEvents,
  extractLlmDelta,
  reconstructLlmMessage,
  isSseResponse,
} from '../sse-parser';

describe('SseStreamParser', () => {
  it('phân tích các event cơ bản đúng định dạng SSE', () => {
    const raw = `event: greeting\nid: 101\ndata: Xin chào các bạn\n\nevent: update\ndata: Đang xử lý\n\n`;
    const events = parseAllSseEvents(raw);

    expect(events.length).toBe(2);
    expect(events[0].event).toBe('greeting');
    expect(events[0].id).toBe('101');
    expect(events[0].data).toBe('Xin chào các bạn');

    expect(events[1].event).toBe('update');
    expect(events[1].data).toBe('Đang xử lý');
  });

  it('xử lý event nhiều dòng data (data multi-line)', () => {
    const raw = `data: Dòng 1\ndata: Dòng 2\ndata: Dòng 3\n\n`;
    const events = parseAllSseEvents(raw);

    expect(events.length).toBe(1);
    expect(events[0].event).toBe('message'); // Mặc định là message
    expect(events[0].data).toBe('Dòng 1\nDòng 2\nDòng 3');
  });

  it('xử lý chuỗi chunk bị cắt rời ngẫu nhiên khi streaming qua mạng', () => {
    const parser = new SseStreamParser();
    // Chunk 1: Chưa hết dòng data
    const c1 = parser.feed('data: {"choices":[{"delta":{"content":"Xin');
    expect(c1.length).toBe(0);

    // Chunk 2: Tiếp tục nội dung và kết thúc event 1, mở đầu event 2
    const c2 = parser.feed(' chào"}}]}\n\ndata: {"choices":');
    expect(c2.length).toBe(1);
    expect(c2[0].data).toBe('{"choices":[{"delta":{"content":"Xin chào"}}]}');

    // Chunk 3: Hoàn thành event 2
    const c3 = parser.feed('[{"delta":{"content":" ReqX!"}}]}\n\n');
    expect(c3.length).toBe(1);
    expect(c3[0].data).toBe('{"choices":[{"delta":{"content":" ReqX!"}}]}');

    const all = [...c1, ...c2, ...c3];
    expect(reconstructLlmMessage(all)).toBe('Xin chào ReqX!');
  });

  it('bỏ qua comment SSE bắt đầu bằng dấu :', () => {
    const raw = `: ping keepalive\ndata: hello\n\n: comment khác\n`;
    const events = parseAllSseEvents(raw);
    expect(events.length).toBe(1);
    expect(events[0].data).toBe('hello');
  });
});

describe('extractLlmDelta & reconstructLlmMessage', () => {
  it('trích xuất delta dạng OpenAI / DeepSeek / vLLM', () => {
    const d1 = extractLlmDelta('{"choices":[{"index":0,"delta":{"content":"Hello"}}]}');
    const d2 = extractLlmDelta('{"choices":[{"index":0,"delta":{"content":" world"}}]}');
    const done = extractLlmDelta('[DONE]');

    expect(d1).toBe('Hello');
    expect(d2).toBe(' world');
    expect(done).toBeNull();
  });

  it('trích xuất reasoning_content (DeepSeek R1 suy luận)', () => {
    const d = extractLlmDelta('{"choices":[{"index":0,"delta":{"reasoning_content":"Suy nghĩ..."}}]}');
    expect(d).toBe('Suy nghĩ...');
  });

  it('trích xuất delta dạng Anthropic Claude', () => {
    const d = extractLlmDelta('{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Claude AI"}}');
    expect(d).toBe('Claude AI');
  });

  it('trích xuất delta dạng Google Gemini', () => {
    const d = extractLlmDelta('{"candidates":[{"content":{"parts":[{"text":"Gemini AI"}]}}]}');
    expect(d).toBe('Gemini AI');
  });

  it('trích xuất delta dạng Ollama', () => {
    const d = extractLlmDelta('{"response":"Ollama stream"}');
    expect(d).toBe('Ollama stream');
  });
});

describe('isSseResponse', () => {
  it('nhận diện text/event-stream từ header', () => {
    expect(isSseResponse({ 'Content-Type': 'text/event-stream; charset=utf-8' })).toBe(true);
    expect(isSseResponse({ 'content-type': 'text/event-stream' })).toBe(true);
    expect(isSseResponse({ 'content-type': 'application/json' })).toBe(false);
  });

  it('nhận diện dữ liệu SSE từ cấu trúc body fallback', () => {
    expect(isSseResponse({}, 'data: test\n\n')).toBe(true);
    expect(isSseResponse({}, '{"hello":"world"}')).toBe(false);
  });
});
