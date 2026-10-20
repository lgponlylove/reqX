import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openaiChat } from '../openai-chat';
import { generateContent } from '../gemini';
import { runTests } from '../../scripts';
import type { ApiResponse } from '../../../types/api';

describe('AI Chat Streaming & Visualizer Features', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('openaiChat streams tokens via onDelta', async () => {
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"Xin"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" chào"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" bạn!"}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ];

    let chunkIndex = 0;
    const encoder = new TextEncoder();
    const mockStream = new ReadableStream({
      pull(controller) {
        if (chunkIndex < sseChunks.length) {
          controller.enqueue(encoder.encode(sseChunks[chunkIndex++]));
        } else {
          controller.close();
        }
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: mockStream,
      headers: new Headers({ 'Content-Type': 'text/event-stream' }),
    });

    const deltas: string[] = [];
    const res = await openaiChat({
      baseURL: 'https://api.openai.com/v1',
      key: 'test-key',
      model: 'gpt-4o',
      system: 'system prompt',
      contents: [{ role: 'user', parts: [{ text: 'chào' }] }],
      tools: [],
      onDelta: (d) => deltas.push(d),
    });

    expect(deltas.join('')).toBe('Xin chào bạn!');
    expect(res.parts).toEqual([{ text: 'Xin chào bạn!' }]);
    expect(res.usage).toEqual({ prompt: 10, completion: 5 });
  });

  it('generateContent streams Gemini tokens via onDelta', async () => {
    const sseChunks = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Tôi là "}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"ReqX AI"}]}}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":6}}\n\n',
    ];

    let chunkIndex = 0;
    const encoder = new TextEncoder();
    const mockStream = new ReadableStream({
      pull(controller) {
        if (chunkIndex < sseChunks.length) {
          controller.enqueue(encoder.encode(sseChunks[chunkIndex++]));
        } else {
          controller.close();
        }
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: mockStream,
      headers: new Headers({ 'Content-Type': 'text/event-stream' }),
    });

    const deltas: string[] = [];
    const res = await generateContent(
      'gemini-api-key',
      'gemini-2.0-flash',
      'system prompt',
      [{ role: 'user', parts: [{ text: 'bạn là ai' }] }],
      [],
      (d) => deltas.push(d),
    );

    expect(deltas.join('')).toBe('Tôi là ReqX AI');
    expect(res.parts).toEqual([{ text: 'Tôi là ReqX AI' }]);
    expect(res.usage).toEqual({ prompt: 12, completion: 6 });
  });

  it('pm.visualizer.set renders HTML template in runTests', async () => {
    const response: ApiResponse = {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Success', count: 42 }),
      timeMs: 120,
      sizeBytes: 50,
    };

    const script = `
      pm.test("Status is 200", () => {
        pm.response.to.have.status(200);
      });
      pm.visualizer.set("<h1>{{message}}</h1><p>Count: {{count}}</p>", pm.response.json());
    `;

    const outcome = await runTests(script, response, {
      env: { get: () => undefined, set: () => {} },
      globals: { get: () => undefined, set: () => {} },
      merged: {},
    });

    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0].passed).toBe(true);
    expect(outcome.visualizerHtml).toBe('<h1>Success</h1><p>Count: 42</p>');
  });
});
