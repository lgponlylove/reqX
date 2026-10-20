import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendRequest } from '../http-client';
import type { ApiRequest } from '../../types/api';

describe('sendRequest streaming & SSE', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('gửi request và nhận SSE stream qua onStreamChunk và onStreamEvent', async () => {
    const dummyReq: ApiRequest = {
      id: 'req_stream_test',
      collectionId: 'col_1',
      name: 'Stream Test',
      method: 'POST',
      url: 'https://api.test/v1/chat/completions',
      headers: [],
      params: [],
      auth: { type: 'none' },
      bodyType: 'json',
      body: JSON.stringify({ model: 'gpt-4o', stream: true }),
      updatedAt: Date.now(),
    };

    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"Xin"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" chào"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" AI!"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    let chunkIndex = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (chunkIndex < sseChunks.length) {
          controller.enqueue(new TextEncoder().encode(sseChunks[chunkIndex++]));
        } else {
          controller.close();
        }
      },
    });

    const mockResponse = new Response(stream, {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
      },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    const receivedChunks: string[] = [];
    const receivedEvents: string[] = [];

    const res = await sendRequest(
      dummyReq,
      {},
      {},
      {
        stream: true,
        onStreamChunk: (partial) => {
          receivedChunks.push(partial.body);
        },
        onStreamEvent: (ev) => {
          receivedEvents.push(ev.data);
        },
      },
    );

    expect(res.status).toBe(200);
    expect(res.isStream).toBe(true);
    expect(res.streamCompleted).toBe(true);
    expect(res.sseEvents?.length).toBe(4);
    expect(res.body).toContain('Xin');
    expect(res.body).toContain('AI!');
    expect(receivedEvents.length).toBe(4);
    expect(receivedEvents[0]).toBe('{"choices":[{"delta":{"content":"Xin"}}]}');
    expect(receivedChunks.length).toBeGreaterThanOrEqual(1);
  });
});
