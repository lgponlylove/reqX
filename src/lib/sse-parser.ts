export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
  raw: string;
  timestamp: number;
}

/**
 * Trích xuất nội dung text sinh ra từ SSE delta của các API LLM phổ biến:
 * - OpenAI / Azure OpenAI / DeepSeek / Groq / vLLM (choices[0].delta.content / reasoning_content)
 * - Anthropic Claude (content_block_delta -> delta.text)
 * - Google Gemini (candidates[0].content.parts[0].text)
 * - Ollama (response / message.content)
 * - Generic text
 */
export function extractLlmDelta(data: string): string | null {
  const trimmed = data.trim();
  if (!trimmed || trimmed === '[DONE]') return null;
  try {
    const json = JSON.parse(trimmed);
    // OpenAI / DeepSeek / Groq / vLLM format
    if (Array.isArray(json.choices) && json.choices.length > 0) {
      const choice = json.choices[0];
      if (typeof choice.delta?.content === 'string') return choice.delta.content;
      if (typeof choice.delta?.reasoning_content === 'string') return choice.delta.reasoning_content;
      if (typeof choice.text === 'string') return choice.text;
    }
    // Anthropic Claude format
    if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
      if (typeof json.delta.text === 'string') return json.delta.text;
    }
    // Google Gemini format
    if (Array.isArray(json.candidates) && json.candidates.length > 0) {
      const parts = json.candidates[0]?.content?.parts;
      if (Array.isArray(parts) && parts.length > 0) {
        return parts.map((p: { text?: string }) => p.text ?? '').join('');
      }
    }
    // Ollama format
    if (typeof json.response === 'string') return json.response;
    if (typeof json.message?.content === 'string') return json.message.content;
    // Generic JSON content / text
    if (typeof json.content === 'string') return json.content;
    if (typeof json.text === 'string') return json.text;
  } catch {
    // Không phải JSON, giữ nguyên chuỗi
    return data;
  }
  return null;
}

/**
 * Ghép toàn bộ delta từ danh sách SSE events thành văn bản hoàn chỉnh của AI.
 */
export function reconstructLlmMessage(events: SseEvent[]): string {
  let full = '';
  for (const ev of events) {
    const delta = extractLlmDelta(ev.data);
    if (delta) full += delta;
  }
  return full;
}

/**
 * Bộ phân tích cú pháp SSE stream lũy tiến (hỗ trợ chunk bị cắt rời giữa chừng).
 */
export class SseStreamParser {
  private buffer = '';
  private currentEvent: Partial<SseEvent> = {};
  private currentDataLines: string[] = [];

  constructor(private onEvent?: (event: SseEvent) => void) {}

  public feed(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    const lines = this.buffer.split(/\r?\n/);
    // Phần tử cuối cùng chưa chắc kết thúc bằng newline, lưu lại vào buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line === '') {
        // Dòng trống kết thúc 1 SSE event
        if (this.currentDataLines.length > 0 || this.currentEvent.event || this.currentEvent.id) {
          const ev: SseEvent = {
            id: this.currentEvent.id,
            event: this.currentEvent.event || 'message',
            data: this.currentDataLines.join('\n'),
            retry: this.currentEvent.retry,
            raw:
              (this.currentEvent.event ? `event: ${this.currentEvent.event}\n` : '') +
              (this.currentEvent.id ? `id: ${this.currentEvent.id}\n` : '') +
              this.currentDataLines.map((d) => `data: ${d}`).join('\n'),
            timestamp: Date.now(),
          };
          events.push(ev);
          this.onEvent?.(ev);
          this.currentEvent = {};
          this.currentDataLines = [];
        }
        continue;
      }

      if (line.startsWith(':')) {
        // Comment dòng SSE, bỏ qua theo đặc tả W3C
        continue;
      }

      let field = line;
      let value = '';
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        field = line.slice(0, colonIdx);
        value = line.slice(colonIdx + 1);
        if (value.startsWith(' ')) {
          value = value.slice(1);
        }
      }

      if (field === 'data') {
        this.currentDataLines.push(value);
      } else if (field === 'event') {
        this.currentEvent.event = value;
      } else if (field === 'id') {
        this.currentEvent.id = value;
      } else if (field === 'retry') {
        const r = parseInt(value, 10);
        if (!isNaN(r)) this.currentEvent.retry = r;
      }
    }

    return events;
  }

  public flush(): SseEvent[] {
    const events: SseEvent[] = [];
    if (this.currentDataLines.length > 0 || this.currentEvent.event || this.currentEvent.id) {
      const ev: SseEvent = {
        id: this.currentEvent.id,
        event: this.currentEvent.event || 'message',
        data: this.currentDataLines.join('\n'),
        retry: this.currentEvent.retry,
        raw:
          (this.currentEvent.event ? `event: ${this.currentEvent.event}\n` : '') +
          (this.currentEvent.id ? `id: ${this.currentEvent.id}\n` : '') +
          this.currentDataLines.map((d) => `data: ${d}`).join('\n'),
        timestamp: Date.now(),
      };
      events.push(ev);
      this.onEvent?.(ev);
      this.currentEvent = {};
      this.currentDataLines = [];
    }
    this.buffer = '';
    return events;
  }
}

/**
 * Phân tích nhanh toàn bộ chuỗi text thành mảng các SSE Event.
 */
export function parseAllSseEvents(text: string): SseEvent[] {
  const parser = new SseStreamParser();
  const events = parser.feed(text);
  events.push(...parser.flush());
  return events;
}

/**
 * Kiểm tra xem response hoặc chuỗi có phải là Server-Sent Events không.
 */
export function isSseResponse(headers: Record<string, string>, body?: string): boolean {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'content-type' && v.toLowerCase().includes('text/event-stream')) {
      return true;
    }
  }
  if (body && (body.startsWith('data:') || body.includes('\ndata:') || body.includes('\revent:'))) {
    return true;
  }
  return false;
}
