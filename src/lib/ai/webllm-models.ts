/**
 * Danh sách model WebLLM siêu nhẹ tối ưu chạy trực tiếp trong browser/Tauri qua WebGPU
 */
export interface WebLlmModelDef {
  id: string;
  name: string;
  size: string;
  vram: string;
  description: string;
}

export const WEBLLM_MODELS: WebLlmModelDef[] = [
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen2.5-0.5B (Khuyên dùng - Siêu nhẹ)',
    size: '~350 MB',
    vram: '~600 MB',
    description: 'Rất nhẹ, hiểu tốt tiếng Việt, phản hồi nhanh trên cả chip đồ họa tích hợp (Intel/AMD).',
  },
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    name: 'SmolLM2-360M (Cực nhỏ)',
    size: '~250 MB',
    vram: '~400 MB',
    description: 'Dung lượng nhỏ nhất, tải trong 10-20 giây, phù hợp máy cấu hình tối thiểu.',
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    name: 'Llama-3.2-1B (Thông minh hơn)',
    size: '~750 MB',
    vram: '~1.2 GB',
    description: 'Khả năng lập trình và suy luận logic tốt hơn, cần GPU rời hoặc RAM 8GB+.',
  },
];
