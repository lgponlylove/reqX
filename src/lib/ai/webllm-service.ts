import { CreateMLCEngine, type MLCEngine, type InitProgressReport } from '@mlc-ai/web-llm';
import type { GeminiContent } from './gemini';

let engineInstance: MLCEngine | null = null;
let currentModelId: string | null = null;
let isLoading = false;

/**
 * Kiểm tra xem môi trường hiện tại (trình duyệt / Tauri WebView) có hỗ trợ WebGPU không.
 */
export async function isWebGpuSupported(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !(navigator as any).gpu) {
    return false;
  }
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

/**
 * Khởi tạo hoặc lấy engine WebLLM cho model chỉ định.
 * Tiến trình tải trọng số được báo về qua callback onProgress.
 */
export async function getWebLlmEngine(
  modelId: string,
  onProgress?: (report: InitProgressReport) => void,
): Promise<MLCEngine> {
  if (engineInstance && currentModelId === modelId) {
    return engineInstance;
  }

  if (isLoading) {
    // Đợi nếu đang có tiến trình nạp dở
    while (isLoading) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (engineInstance && currentModelId === modelId) {
      return engineInstance;
    }
  }

  isLoading = true;
  try {
    const hasGpu = await isWebGpuSupported();
    if (!hasGpu) {
      throw new Error('Thiết bị hoặc WebView hiện tại chưa kích hoạt WebGPU. Vui lòng cập nhật driver card đồ họa hoặc sử dụng Ollama.');
    }

    const engine = await CreateMLCEngine(modelId, {
      initProgressCallback: (report) => {
        if (onProgress) onProgress(report);
      },
    });

    engineInstance = engine;
    currentModelId = modelId;
    return engine;
  } finally {
    isLoading = false;
  }
}

/**
 * Chuyển đổi lịch sử chat GeminiContent thành format OpenAI Messages của WebLLM.
 */
function toOpenAiMessages(system: string, contents: GeminiContent[]) {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: system },
  ];

  for (const c of contents) {
    const role = c.role === 'model' ? 'assistant' : 'user';
    const text = c.parts.map((p) => p.text ?? '').join('');
    if (text.trim()) {
      messages.push({ role, content: text });
    }
  }

  return messages;
}

/**
 * Gọi chat completion với WebLLM theo cơ chế Streaming delta.
 */
export async function webLlmChat(opts: {
  modelId: string;
  system: string;
  contents: GeminiContent[];
  onProgress?: (report: InitProgressReport) => void;
  onDelta?: (delta: string) => void;
}): Promise<{ text: string }> {
  const engine = await getWebLlmEngine(opts.modelId, opts.onProgress);
  const messages = toOpenAiMessages(opts.system, opts.contents);

  const chunks = await engine.chat.completions.create({
    messages,
    stream: true,
    temperature: 0.2, // Giảm temperature để model nhỏ trả lời chính xác, tránh ảo giác/bịa đặt
    top_p: 0.8,
    max_tokens: 1024,
  });

  let fullText = '';
  for await (const chunk of chunks) {
    const delta = chunk.choices[0]?.delta?.content || '';
    if (delta) {
      fullText += delta;
      if (opts.onDelta) {
        opts.onDelta(delta);
      }
    }
  }

  return { text: fullText };
}
