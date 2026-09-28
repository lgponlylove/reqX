/**
 * Fetch cho các API AI — module `ai/` dùng chung, copy cả thư mục sang project khác được.
 * - Trong app Tauri (.exe): qua Rust native (`http_send`) → KHÔNG bị CORS
 *   (vd SambaNova chặn CORS từ trình duyệt nên fetch trực tiếp luôn rớt).
 * - Trên browser web / test: fetch thường.
 */
import { isTauri } from '../http-client';

export interface AiFetchResult {
  ok: boolean;
  status: number;
  text: string;
}

export async function aiFetch(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<AiFetchResult> {
  const method = opts.method ?? 'POST';
  const headers = { ...(opts.headers ?? {}) };
  const timeoutMs = opts.timeoutMs ?? 30000;

  if (isTauri()) {
    // Tách Content-Type ra như http-client.ts để Rust set 1 lần (tránh trùng header)
    let contentType: string | null = null;
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === 'content-type') {
        contentType = headers[k];
        delete headers[k];
      }
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<{ status: number; body: string; body_kind: string }>('http_send', {
        req: {
          method,
          url,
          headers: Object.entries(headers),
          body: opts.body !== undefined ? { kind: 'text', content_type: contentType, text: opts.body } : undefined,
          timeout_secs: Math.max(1, Math.round(timeoutMs / 1000)),
        },
      });
      return { ok: res.status >= 200 && res.status < 300, status: res.status, text: res.body_kind === 'text' ? res.body : '' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? '');
      if (/timeout/i.test(msg)) throw new DOMException('API quá hạn không phản hồi (timeout)', 'TimeoutError');
      throw new Error(msg || 'Lỗi gọi native HTTP');
    }
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body: opts.body, signal: ctrl.signal });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'AbortError' || e.name === 'TimeoutError'))
      throw new DOMException('API quá hạn không phản hồi (timeout)', 'TimeoutError');
    throw e;
  } finally {
    clearTimeout(t);
  }
}
