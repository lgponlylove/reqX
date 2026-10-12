import type { ApiRequest, ApiResponse, AuthConfig, KeyValue } from '../types/api';
import { resolveVariables } from './variables';
import { classifyBody, contentTypeOf } from './response-file';

function enabledEntries(list: KeyValue[]): [string, string][] {
  return list.filter((kv) => kv.enabled && kv.key.trim() !== '').map((kv) => [kv.key, kv.value]);
}

function applyAuth(
  headers: Record<string, string>,
  url: URL,
  auth: AuthConfig,
  envVars: Record<string, string>,
  globalVars: Record<string, string>,
): void {
  if (auth.type === 'bearer' && auth.token) {
    const { resolved } = resolveVariables(auth.token, envVars, globalVars);
    headers['Authorization'] = `Bearer ${resolved}`;
  } else if (auth.type === 'basic') {
    const u = resolveVariables(auth.username ?? '', envVars, globalVars).resolved;
    const p = resolveVariables(auth.password ?? '', envVars, globalVars).resolved;
    headers['Authorization'] = `Basic ${btoa(`${u}:${p}`)}`;
  } else if (auth.type === 'apikey' && auth.apiKey) {
    const val = resolveVariables(auth.apiKey, envVars, globalVars).resolved;
    const name = auth.apiKeyName || 'X-API-Key';
    if (auth.apiKeyIn === 'query') url.searchParams.append(name, val);
    else headers[name] = val;
  }
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

type NativeBody
  = { kind: 'text'; content_type: string | null; text: string }
  | { kind: 'form'; fields: [string, string][] }
  | { kind: 'multipart'; parts: { name: string; value: string; is_file: boolean }[] };

interface NativeHttpResponse {
  status: number;
  status_text: string | null;
  headers: [string, string][];
  body: string;
  body_kind: 'text' | 'binary';
  size_bytes: number;
  time_ms: number;
}

function abortError(): DOMException {
  return new DOMException('Request bị hủy', 'AbortError');
}

/**
 * Gửi HTTP.
 * - Trong app Tauri (.exe): qua Rust native (reqwest) → KHÔNG bị CORS.
 * - Trên browser web: fetch → vẫn bị CORS với API khác domain.
 */
export async function sendRequest(
  req: ApiRequest,
  envVars: Record<string, string>,
  globalVars: Record<string, string> = {},
  timeoutMs = 30000,
  externalSignal?: AbortSignal,
): Promise<ApiResponse> {
  const { resolved: urlWithVars } = resolveVariables(req.url, envVars, globalVars);
  const url = new URL(urlWithVars, window.location.origin);

  // Mock Server Check: nếu mock server đang bật và url trỏ tới mock port hoặc localhost/mock path
  try {
    const { useMockStore } = await import('../stores/mock');
    const mockState = useMockStore.getState();
    if (mockState.isRunning) {
      const isTargetingMock =
        url.port === String(mockState.port) ||
        url.hostname === 'mock.local' ||
        url.host.includes(`:${mockState.port}`);

      if (isTargetingMock) {
        const { findMatchingRule, executeMockResponse } = await import('./mockServerEngine');
        const matched = findMatchingRule(mockState.rules, req.method, url.pathname);
        if (matched) {
          if (matched.delayMs && matched.delayMs > 0) {
            await new Promise((r) => setTimeout(r, matched.delayMs));
          }
          const { resolved: bodyWithVars } = resolveVariables(req.body, envVars, globalVars);
          const { response, logItem } = executeMockResponse(
            matched,
            req.method,
            url.toString(),
            {},
            bodyWithVars
          );
          mockState.addLog(logItem);
          return response;
        }
      }
    }
  } catch {
    // Không làm gián đoạn request thông thường nếu import mock thất bại
  }

  // Params tab -> query string
  for (const [k, v] of enabledEntries(req.params)) {
    const { resolved } = resolveVariables(v, envVars, globalVars);
    url.searchParams.append(
      resolveVariables(k, envVars, globalVars).resolved,
      resolved,
    );
  }

  const headers: Record<string, string> = {};
  for (const [k, v] of enabledEntries(req.headers)) {
    headers[resolveVariables(k, envVars, globalVars).resolved] =
      resolveVariables(v, envVars, globalVars).resolved;
  }
  applyAuth(headers, url, req.auth, envVars, globalVars);

  // Body: chuẩn bị 2 dạng (fetch BodyInit + mô tả cho Rust)
  let fetchBody: BodyInit | undefined;
  let nativeBody: NativeBody | undefined;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.bodyType !== 'none') {
    const { resolved } = resolveVariables(req.body, envVars, globalVars);
    if (req.bodyType === 'json') {
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
      fetchBody = resolved;
      nativeBody = { kind: 'text', content_type: null, text: resolved };
    } else if (req.bodyType === 'urlencoded') {
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      fetchBody = resolved;
      nativeBody = { kind: 'text', content_type: null, text: resolved };
    } else if (req.bodyType === 'form-data') {
      // Mỗi dòng "key=value" hoặc "key=@filepath" / "key=@\"filepath\""
      const fields: [string, string][] = [];
      const parts: { name: string; value: string; is_file: boolean }[] = [];
      for (const line of resolved.split('\n')) {
        const t = line.trim();
        if (!t || !t.includes('=')) continue;
        const i = t.indexOf('=');
        const k = t.slice(0, i).trim();
        let v = t.slice(i + 1).trim();
        if (v.startsWith('@')) {
          let filePath = v.slice(1).trim();
          if ((filePath.startsWith('"') && filePath.endsWith('"')) || (filePath.startsWith("'") && filePath.endsWith("'"))) {
            filePath = filePath.slice(1, -1);
          }
          parts.push({ name: k, value: filePath, is_file: true });
          fields.push([k, v]);
        } else {
          parts.push({ name: k, value: v, is_file: false });
          fields.push([k, v]);
        }
      }
      const fd = new FormData();
      for (const [k, v] of fields) fd.append(k, v);
      fetchBody = fd;
      nativeBody = { kind: 'multipart', parts };
    } else {
      fetchBody = resolved;
      nativeBody = { kind: 'text', content_type: null, text: resolved };
    }
  }

  // Content-Type mặc định do app tự thêm → tách ra để Rust set 1 lần (tránh trùng header)
  const { invoke } = isTauri() ? await import('@tauri-apps/api/core') : { invoke: null as never };
  if (isTauri() && invoke) {
    const nativeHeaders: Record<string, string> = { ...headers };
    let defaultCt: string | null = null;
    if (nativeBody?.kind === 'text' && nativeHeaders['Content-Type']) {
      // Chỉ tách khi chính app đã tự set mặc định ở trên (user tự set thì giữ nguyên trong headers)
      defaultCt = nativeHeaders['Content-Type'];
      delete nativeHeaders['Content-Type'];
    } else if (nativeBody?.kind === 'multipart') {
      // Multipart: Xóa Content-Type để reqwest tự generate boundary chuẩn
      for (const k of Object.keys(nativeHeaders)) {
        if (k.toLowerCase() === 'content-type') {
          delete nativeHeaders[k];
        }
      }
    }
    const payload = {
      method: req.method,
      url: url.toString(),
      headers: Object.entries(nativeHeaders),
      body: nativeBody
        ? nativeBody.kind === 'form' || nativeBody.kind === 'multipart'
          ? nativeBody
          : { ...nativeBody, content_type: defaultCt }
        : undefined,
      timeout_secs: Math.max(1, Math.round(timeoutMs / 1000)),
    };
    const invokeP = invoke<NativeHttpResponse>('http_send', { req: payload });
    const res = externalSignal
      ? await Promise.race([
          invokeP,
          new Promise<never>((_, reject) => {
            if (externalSignal.aborted) reject(abortError());
            else externalSignal.addEventListener('abort', () => reject(abortError()), { once: true });
          }),
        ]).finally(() => {
          // Request Rust vẫn chạy nền nếu đã hủy — kết quả bị bỏ, tránh unhandled rejection
          invokeP.catch(() => {});
        })
      : await invokeP;
    const h: Record<string, string> = {};
    for (const [k, v] of res.headers) h[k] = v;
    return {
      status: res.status,
      statusText: res.status_text ?? '',
      timeMs: res.time_ms,
      sizeBytes: res.size_bytes,
      headers: h,
      body: res.body,
      bodyKind: res.body_kind === 'binary' ? 'binary' : 'text',
    };
  }

  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  const onExternalAbort = () => ctrl.abort();
  externalSignal?.addEventListener('abort', onExternalAbort);
  const t0 = performance.now();
  try {
    const res = await fetch(url.toString(), {
      method: req.method,
      headers,
      body: fetchBody,
      signal: ctrl.signal,
    });
    const buf = await res.arrayBuffer();
    const timeMs = Math.round(performance.now() - t0);
    const h: Record<string, string> = {};
    res.headers.forEach((v, k) => (h[k] = v));
    const { body, bodyKind } = classifyBody(buf, contentTypeOf(h));
    return {
      status: res.status,
      statusText: res.statusText,
      timeMs,
      sizeBytes: buf.byteLength,
      headers: h,
      body,
      bodyKind,
    };
  } catch (e) {
    if (e instanceof TypeError) {
      throw new Error(
        'Failed to fetch — 99% là CORS (server không cho browser khác domain gọi) ' +
        'hoặc mất mạng. Hãy dùng bản .exe Tauri (gửi qua Rust native, không bị CORS).',
      );
    }
    throw e;
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}
