import type { ApiRequest, ApiResponse } from '../types/api';
import { toCurl } from './codegen';
import { maskSensitiveBody, maskUrl } from './mask';
import { maskCurl } from './test-cases';

/**
 * "Bằng chứng lỗi" 1 click — markdown đính vào ticket được ngay, khỏi chụp màn hình.
 * Tách lib thuần (không đụng DOM/Tauri) để vitest chứng minh secret không lọt ra file.
 */

/** Thân request/response chỉ lấy tối đa chứng này — ticket dài quá Dev không đọc. */
const BODY_LIMIT = 4000;

/** Header mang credential: bỏ hẳn dòng, không che bằng *** để không ai tưởng còn giá trị thật. */
const SECRET_HEADER = /^(set-cookie|cookie|authorization|proxy-authorization|x-api-key|api-key|x-auth-token|anthropic-authorization)$/i;

export interface BugReportInput {
  req: ApiRequest;
  res: ApiResponse;
  envName?: string;
  envVars: Record<string, string>;
  globalVars?: Record<string, string>;
  /** Kết quả pm.test của lần gửi vừa rồi (cấu trúc tối giản để không phụ thuộc scripts.ts). */
  testRun?: { results: Array<{ name: string; passed: boolean; error?: string }>; error?: string } | null;
  /** Anh/chị QA gõ thêm: đã làm gì, mong gì, mức độ. */
  note?: string;
  expected?: string;
  at?: number;
  /**
   * Giá trị của biến nghi là secret (env + globals) — kẻ gọi lấy từ store lúc đang chạy.
   * Regex theo TÊN không bắt hết được (apikey tự đặt tên, token nhúng trong body), nên
   * xóa theo CHÍNH GIÁ TRỊ là lưới chắn cuối cùng.
   */
  secretValues?: string[];
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-|-$/g, '') || 'request'
  );
}

/** Tên file an toàn cho Windows: reqx-bug-<ten-request>-<ngay>.md */
export function bugFileName(req: ApiRequest, at = Date.now()): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `reqx-bug-${slug(req.name || req.url)}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.md`;
}

function fence(text: string, lang = ''): string {
  // Hàng ``` trong nội dung sẽ làm hỏng khối code -> đổi hàng rào sang 4 backtick
  const fenceMark = text.includes('```') ? '````' : '```';
  return `${fenceMark}${lang}\n${text.replace(/\s+$/, '')}\n${fenceMark}`;
}

function clip(text: string): string {
  const masked = maskSensitiveBody(text);
  if (masked.length <= BODY_LIMIT) return masked;
  return `${masked.slice(0, BODY_LIMIT)}\n… (cắt giữa, tổng ${masked.length} ký tự — mở ReqX để xem đầy đủ)`;
}

const when = (ms: number) =>
  new Date(ms).toLocaleString('vi-VN', { hour12: false });

/**
 * Xóa tận gốc mọi chuỗi trùng giá trị secret (chỉ giá trị đủ dài, để không ăn nhầm
 * từ thông thường).
 */
function redactValues(text: string, values?: string[]): string {
  if (!values?.length) return text;
  let out = text;
  for (const v of new Set(values.map((x) => (x ?? '').trim()).filter((x) => x.length >= 6))) {
    out = out.split(v).join('***');
  }
  return out;
}

/**
 * Dựng nội dung markdown. Mọi đường ra ngoài (curl, body, header, URL) đều đi qua
 * maskSensitiveBody / maskCurl / SECRET_HEADER trước — xem bug-report.test.ts.
 */
export function buildBugReport(i: BugReportInput): string {
  const { req, res } = i;
  const at = i.at ?? Date.now();
  const out: string[] = [];

  out.push(`# 🐞 ${req.name || `${req.method} ${req.url}`}`);
  out.push('');
  out.push(`- **Lúc gọi:** ${when(at)}`);
  out.push(`- **Môi trường:** ${i.envName || '(chọn env trong ReqX)'}`);
  out.push(`- **Request:** \`${req.method}\` ${req.name || '(không đặt tên)'}`);
  out.push(`- **URL:** ${maskUrl(req.url)}`);
  out.push(
    `- **Kết quả nhận được:** ${res.status} ${res.statusText} • ${res.timeMs} ms • ${res.sizeBytes} bytes`,
  );
  out.push(`- **Độ nhạy cảm của dữ liệu trong file này:** token/cookie đã được ReqX che, Dev cần giá trị thật thì tự lấy trong env.`);
  out.push('');

  if (i.expected?.trim()) {
    out.push('## Điều mong đợi');
    out.push('');
    out.push(i.expected.trim());
    out.push('');
  }
  if (i.note?.trim()) {
    out.push('## Ghi nhận của người test');
    out.push('');
    out.push(i.note.trim());
    out.push('');
  }

  out.push('## Kết quả kiểm thử tự động');
  out.push('');
  const results = i.testRun?.results ?? [];
  if (results.length === 0) {
    out.push('_Request này chưa có điều kiện kiểm thử (tab Tests) — kết quả chỉ có mã HTTP ở trên._');
  } else {
    for (const r of results) {
      out.push(`- ${r.passed ? '✅' : '❌'} ${r.name}${r.error ? ` — ${r.error}` : ''}`);
    }
  }
  if (i.testRun?.error) out.push(`- ⚠️ Script Tests lỗi: ${i.testRun.error}`);
  out.push('');

  out.push('## Gọi lại đúng request này (curl — đã che credential)');
  out.push('');
  out.push(fence(maskCurl(toCurl(req, i.envVars, i.globalVars ?? {})), 'bash'));
  out.push('');

  const headerLines = req.headers
    .filter((h) => h.enabled && h.key.trim() !== '')
    .map((h) => (SECRET_HEADER.test(h.key.trim()) ? `| ${h.key} | 🔒 đã bỏ (credential) |` : `| ${h.key} | ${clip(h.value)} |`));
  out.push('## Header đã gửi');
  out.push('');
  out.push(headerLines.length ? ['| Header | Giá trị |', '| --- | --- |', ...headerLines].join('\n') : '_Không có header nào bật._');
  out.push('');

  if (req.bodyType !== 'none' && req.body.trim()) {
    out.push('## Thân request gửi đi');
    out.push('');
    out.push(fence(clip(req.body), req.bodyType === 'json' ? 'json' : ''));
    out.push('');
  }

  out.push('## Header trả về');
  out.push('');
  const resHeaders = Object.entries(res.headers ?? {})
    .filter(([k]) => !SECRET_HEADER.test(k))
    .map(([k, v]) => `| ${k} | ${clip(String(v))} |`);
  const dropped = Object.keys(res.headers ?? {}).filter((k) => SECRET_HEADER.test(k));
  out.push(
    resHeaders.length
      ? ['| Header | Giá trị |', '| --- | --- |', ...resHeaders, ...dropped.map((k) => `| ${k} | 🔒 đã bỏ (credential) |`)].join('\n')
      : '_Không có header nào (hoặc toàn bộ là credential đã che)._');
  out.push('');

  out.push('## Nội dung trả về');
  out.push('');
  if (res.bodyKind === 'binary') {
    out.push(`_Phản hồi là file nhị phân (${res.sizeBytes} bytes) — không dán vào ticket được. Tải từ ReqX: tab Response → 💾 Lưu file._`);
  } else if (!res.body.trim()) {
    out.push('_Response rỗng._');
  } else {
    out.push(fence(clip(res.body), res.body.trimStart().startsWith('{') || res.body.trimStart().startsWith('[') ? 'json' : ''));
  }
  out.push('');

  out.push('---');
  out.push('');
  out.push('_File này do ReqX sinh. Nếu có ảnh chụp kèm theo, ảnh chỉ để minh họa — số liệu chuẩn ở trên._');
  out.push('');

  return redactValues(out.join('\n'), i.secretValues);
}
