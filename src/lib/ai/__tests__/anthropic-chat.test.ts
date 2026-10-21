import { describe, expect, it } from 'vitest';
import { toAnthropicTools, toAnthropicMessages } from '../anthropic-chat';
import type { GeminiContent, GeminiFunctionDecl } from '../gemini';

describe('Anthropic Claude Adapter', () => {
  it('converts Gemini tool declarations to Anthropic input_schema format', () => {
    const decls: GeminiFunctionDecl[] = [
      {
        name: 'send_request',
        description: 'Send an HTTP request',
        parameters: {
          type: 'OBJECT',
          properties: {
            url: { type: 'STRING', description: 'Request URL' },
            method: { type: 'STRING' },
          },
          required: ['url'],
        },
      },
    ];

    const tools = toAnthropicTools(decls);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('send_request');
    expect(tools[0].description).toBe('Send an HTTP request');
    expect(tools[0].input_schema).toEqual({
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Request URL' },
        method: { type: 'string' },
      },
      required: ['url'],
    });
  });

  it('converts GeminiContents to alternating Anthropic messages with tool_use and tool_result', () => {
    const contents: GeminiContent[] = [
      {
        role: 'user',
        parts: [{ text: 'Gửi request login giúp tôi' }],
      },
      {
        role: 'model',
        parts: [
          { text: 'Đang kiểm tra request...' },
          {
            functionCall: {
              name: 'send_request',
              args: { url: 'https://example.com/login' },
            },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'send_request',
              response: { status: 200, ok: true },
            },
          },
        ],
      },
    ];

    const messages = toAnthropicMessages(contents);
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toEqual([{ type: 'text', text: 'Gửi request login giúp tôi' }]);

    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content[0]).toEqual({ type: 'text', text: 'Đang kiểm tra request...' });
    expect(messages[1].content[1].type).toBe('tool_use');
    if (messages[1].content[1].type === 'tool_use') {
      expect(messages[1].content[1].name).toBe('send_request');
      expect(messages[1].content[1].input).toEqual({ url: 'https://example.com/login' });
    }

    expect(messages[2].role).toBe('user');
    expect(messages[2].content[0].type).toBe('tool_result');
    if (messages[2].content[0].type === 'tool_result') {
      expect(JSON.parse(messages[2].content[0].content)).toEqual({ status: 200, ok: true });
    }
  });

  it('merges consecutive messages of the same role to conform to Anthropic API requirements', () => {
    const contents: GeminiContent[] = [
      { role: 'user', parts: [{ text: 'Tin nhắn 1' }] },
      { role: 'user', parts: [{ text: 'Tin nhắn 2' }] },
    ];

    const messages = toAnthropicMessages(contents);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toEqual([
      { type: 'text', text: 'Tin nhắn 1' },
      { type: 'text', text: 'Tin nhắn 2' },
    ]);
  });
});
