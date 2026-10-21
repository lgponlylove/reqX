import type { ApiRequest, ApiResponse, AuthConfig, KeyValue, SseEvent } from '../types/api';
import { resolveVariables } from './variables';
import { classifyBody, contentTypeOf } from './response-file';
import { applyExtendedAuth, parseDigestChallenge, sha256Hex } from './auth-protocols';
import { cookieJar } from './cookie-jar';
import { isSseResponse, SseStreamParser, parseAllSseEvents } from './sse-parser';

export interface RequestOptions {
  timeoutMs?: number;
  redirect?: 'follow' | 'manual' | 'error';
  proxy?: string;
  disableSslVerification?: boolean;
  useCookies?: boolean;
  /** Internal: đã thử lại 1 lần với nonce/realm server gửi trong 401 (Digest handshake). */
  digestAttempted?: boolean;
  /** Bật chế độ stream nhận chunk trực tiếp */
  stream?: boolean;
  /** Callback nhận response cập nhật tiến độ theo từng chunk stream */
  onStreamChunk?: (partial: ApiResponse) => void;
  /** Callback nhận từng SSE event mới được parse */
  onStreamEvent?: (event: SseEvent) => void;
}

function enabledEntries(list: KeyValue[]): [string, string][] {
  return list.filter((kv) => kv.enabled && kv.key.trim() !== '').map((kv) => [kv.key, kv.value]);
}

/** btoa an toàn với ký tự ngoài Latin-1 (mật khẩu/mã token có dấu) — không nổ InvalidCharacterError. */
export function btoaUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Tìm header không phân biệt hoa/thường (React Native/fetch chuẩn hoá lowercase, Rust thì không). */
function pickHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

async function applyAuth(
  headers: Record<string, string>,
  url: URL,
  method: ApiRequest['method'],
  auth: AuthConfig,
  bodyText: string,
  envVars: Record<string, string>,
  globalVars: Record<string, string>,
  payloadHash?: string,
): Promise<void> {
  if (auth.type === 'bearer' && auth.token) {
    const { resolved } = resolveVariables(auth.token, envVars, globalVars);
    headers['Authorization'] = `Bearer ${resolved}`;
  } else if (auth.type === 'basic') {
    const u = resolveVariables(auth.username ?? '', envVars, globalVars).resolved;
    const p = resolveVariables(auth.password ?? '', envVars, globalVars).resolved;
    headers['Authorization'] = `Basic ${btoaUtf8(`${u}:${p}`)}`;
  } else if (auth.type === 'apikey' && auth.apiKey) {
    const val = resolveVariables(auth.apiKey, envVars, globalVars).resolved;
    const name = auth.apiKeyName || 'X-API-Key';
    if (auth.apiKeyIn === 'query') url.searchParams.append(name, val);
    else headers[name] = val;
  } else {
    await applyExtendedAuth(headers, url, method, auth, bodyText, envVars, globalVars, payloadHash);
  }
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Base URL cho request tương đối. UI dùng origin của page; CLI (không có window)
 * phải gọi setDefaultBaseUrl() — xem `--base-url`.
 */
let defaultBaseUrl: string | undefined;
export function setDefaultBaseUrl(origin?: string): void {
  defaultBaseUrl = origin?.replace(/\/+$/, '') || undefined;
}

function resolveBaseUrl(): string | undefined {
  if (defaultBaseUrl) return defaultBaseUrl;
  return typeof window !== 'undefined' ? window.location.origin : undefined;
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
  optionsOrTimeout: number | RequestOptions = 30000,
  externalSignal?: AbortSignal,
): Promise<ApiResponse> {
  const options: RequestOptions =
    typeof optionsOrTimeout === 'number'
      ? { timeoutMs: optionsOrTimeout }
      : (optionsOrTimeout ?? {});
  const timeoutMs = options.timeoutMs ?? 30000;
  const useCookies = options.useCookies !== false;

  /**
   * Digest handshake: lần gửi đầu ta chưa biết nonce/realm của server.
   * Nếu server trả 401 + WWW-Authenticate: Digest -> gửi lại ĐÚNG MỘT lần với challenge thật.
   */
  async function maybeDigestRetry(resp: ApiResponse): Promise<ApiResponse> {
    if (options.digestAttempted || req.auth.type !== 'digest' || !req.auth.digest || resp.status !== 401) {
      return resp;
    }
    const challenge = pickHeader(resp.headers, 'www-authenticate');
    if (!challenge || !/^digest/i.test(challenge.trim())) return resp;
    const ch = parseDigestChallenge(challenge);
    if (!ch.nonce) return resp;
    const retryReq: ApiRequest = {
      ...req,
      auth: {
        ...req.auth,
        digest: {
          ...req.auth.digest,
          realm: ch.realm ?? req.auth.digest.realm,
          nonce: ch.nonce,
          opaque: ch.opaque ?? req.auth.digest.opaque,
          qop: ch.qop ?? req.auth.digest.qop,
          algorithm: ch.algorithm ?? req.auth.digest.algorithm,
        },
      },
    };
    return sendRequest(retryReq, envVars, globalVars, { ...options, digestAttempted: true }, externalSignal);
  }

  const { resolved: urlWithVars } = resolveVariables(req.url, envVars, globalVars);
  const base = resolveBaseUrl();
  if (!base && !/^[a-z][a-z0-9+.-]*:/i.test(urlWithVars)) {
    throw new Error(
      `URL tương đối "${urlWithVars}" cần base — đặt base tuyệt đối hoặc truyền --base-url khi chạy CLI`,
    );
  }
  const url = new URL(urlWithVars, base);

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

  // Body: chuẩn bị 2 dạng (fetch BodyInit + mô tả cho Rust).
  // Phải làm TRƯỚC khi ký auth: SigV4/Digest hash đúng payload sẽ gửi thật (đã thay biến),
  // nếu ký trên template {{var}} thì server trả SignatureDoesNotMatch.
  let fetchBody: BodyInit | undefined;
  let nativeBody: NativeBody | undefined;
  let authBodyText = '';
  let authPayloadHash: string | undefined;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.bodyType !== 'none') {
    const { resolved } = resolveVariables(req.body, envVars, globalVars);
    const hasContentType = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type');

    if (req.bodyType === 'json' || req.bodyType === 'graphql') {
      if (!hasContentType) headers['Content-Type'] = 'application/json';
      fetchBody = resolved;
      nativeBody = { kind: 'text', content_type: null, text: resolved };
      authBodyText = resolved;
    } else if (req.bodyType === 'raw') {
      const rawSubtype = req.rawType || 'json';
      const defaultCt: Record<string, string> = {
        json: 'application/json',
        text: 'text/plain',
        javascript: 'application/javascript',
        html: 'text/html',
        xml: 'application/xml',
      };
      if (!hasContentType) {
        headers['Content-Type'] = defaultCt[rawSubtype] || 'text/plain';
      }
      fetchBody = resolved;
      nativeBody = { kind: 'text', content_type: null, text: resolved };
      authBodyText = resolved;
    } else if (req.bodyType === 'urlencoded') {
      if (!hasContentType) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      fetchBody = resolved;
      nativeBody = { kind: 'text', content_type: null, text: resolved };
      authBodyText = resolved;
    } else if (req.bodyType === 'binary') {
      if (!hasContentType) headers['Content-Type'] = 'application/octet-stream';
      try {
        const binStr = atob(resolved);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
        fetchBody = bytes.buffer;
        // Hash trên byte thật, không phải trên chuỗi base64
        authPayloadHash = await sha256Hex(bytes);
      } catch {
        fetchBody = new TextEncoder().encode(resolved);
        authBodyText = resolved;
      }
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
      if (parts.length > 0) {
        const fd = new FormData();
        for (const [k, v] of fields) fd.append(k, v);
        fetchBody = fd;
        nativeBody = { kind: 'multipart', parts };
      }
      // multipart có boundary do transport sinh ra lúc gửi -> không ký payload được
    } else {
      fetchBody = resolved;
      nativeBody = { kind: 'text', content_type: null, text: resolved };
      authBodyText = resolved;
    }
  }

  // Cookie Jar: attach Cookie header if enabled and not already explicitly set
  if (useCookies && !headers['Cookie'] && !headers['cookie']) {
    const cookieVal = cookieJar.getCookieHeader(url.toString());
    if (cookieVal) {
      headers['Cookie'] = cookieVal;
    }
  }

  // N6 — auto-refresh trong phiên: token sắp hết hạn mà có refresh token thì lấy token mới
  // TRƯỚC khi ký auth, ngay trong RAM (không ghi đĩa). Bỏ qua request gọi token endpoint
  // để không đệ quy.
  let effectiveAuth = req.auth;
  if (req.auth.type === 'oauth2' && req.auth.oauth2 && req.id !== 'oauth2_token_fetch') {
    try {
      const { ensureFreshOAuth2 } = await import('./oauth2-refresh');
      const { config } = await ensureFreshOAuth2(req.auth.oauth2, envVars, globalVars, {
        requestId: req.id,
        signal: externalSignal,
      });
      effectiveAuth = { ...req.auth, oauth2: config };
    } catch {
      // Refresh hỏng thì cứ gửi bằng token cũ — server sẽ trả 401 nếu token thật sự chết
    }
  }

  await applyAuth(headers, url, req.method, effectiveAuth, authBodyText, envVars, globalVars, authPayloadHash);

  // Content-Type mặc định do app tự thêm → tách ra để Rust set 1 lần (tránh trùng header)
  const { invoke } = isTauri() ? await import('@tauri-apps/api/core') : { invoke: null as never };
  if (isTauri() && invoke) {
    const nativeHeaders: Record<string, string> = { ...headers };
    let defaultCt: string | null = null;
    if (nativeBody?.kind === 'text') {
      const ctKey = Object.keys(nativeHeaders).find((k) => k.toLowerCase() === 'content-type');
      if (ctKey) {
        defaultCt = nativeHeaders[ctKey];
        delete nativeHeaders[ctKey];
      }
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
    for (const [k, v] of res.headers) {
      h[k] = v;
      if (useCookies && k.toLowerCase() === 'set-cookie') {
        cookieJar.setCookie(url.toString(), v);
      }
    }
    const sse = isSseResponse(h, res.body);
    const parsedResp: ApiResponse = {
      status: res.status,
      statusText: res.status_text ?? '',
      timeMs: res.time_ms,
      sizeBytes: res.size_bytes,
      headers: h,
      body: res.body,
      bodyKind: res.body_kind === 'binary' ? 'binary' : 'text',
      isStream: sse,
      streamCompleted: true,
      sseEvents: sse ? parseAllSseEvents(res.body) : undefined,
    };
    if (sse) options.onStreamChunk?.(parsedResp);
    return maybeDigestRetry(parsedResp);
  }

  const ctrl = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => ctrl.abort(), timeoutMs);
  const onExternalAbort = () => ctrl.abort();
  externalSignal?.addEventListener('abort', onExternalAbort);
  const t0 = performance.now();
  try {
    const res = await fetch(url.toString(), {
      method: req.method,
      headers,
      body: fetchBody,
      signal: ctrl.signal,
      redirect: options.redirect ?? 'follow',
    });
    const h: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      h[k] = v;
      if (useCookies && k.toLowerCase() === 'set-cookie') {
        cookieJar.setCookie(url.toString(), v);
      }
    });

    const isSse = isSseResponse(h);
    const shouldStream = (isSse || options.stream) && !!res.body && typeof res.body.getReader === 'function';

    if (shouldStream) {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder('utf-8');
      const parser = new SseStreamParser((ev) => {
        options.onStreamEvent?.(ev);
      });
      let accumulatedBody = '';
      const allEvents: SseEvent[] = [];
      let totalBytes = 0;

      const initialPartial: ApiResponse = {
        status: res.status,
        statusText: res.statusText,
        timeMs: Math.round(performance.now() - t0),
        sizeBytes: 0,
        headers: h,
        body: '',
        bodyKind: 'text',
        isStream: true,
        streamCompleted: false,
        sseEvents: [],
      };
      options.onStreamChunk?.(initialPartial);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            const chunkStr = decoder.decode(value, { stream: true });
            accumulatedBody += chunkStr;
            const newEvents = parser.feed(chunkStr);
            allEvents.push(...newEvents);

            const partial: ApiResponse = {
              status: res.status,
              statusText: res.statusText,
              timeMs: Math.round(performance.now() - t0),
              sizeBytes: totalBytes,
              headers: h,
              body: accumulatedBody,
              bodyKind: 'text',
              isStream: true,
              streamCompleted: false,
              sseEvents: [...allEvents],
            };
            options.onStreamChunk?.(partial);
          }
        }
      } catch (streamErr) {
        if (externalSignal?.aborted || ctrl.signal.aborted) {
          allEvents.push(...parser.flush());
          const finalPartial: ApiResponse = {
            status: res.status,
            statusText: res.statusText,
            timeMs: Math.round(performance.now() - t0),
            sizeBytes: totalBytes,
            headers: h,
            body: accumulatedBody,
            bodyKind: 'text',
            isStream: true,
            streamCompleted: true,
            sseEvents: allEvents,
          };
          options.onStreamChunk?.(finalPartial);
          return maybeDigestRetry(finalPartial);
        }
        throw streamErr;
      }

      allEvents.push(...parser.flush());
      const finalResp: ApiResponse = {
        status: res.status,
        statusText: res.statusText,
        timeMs: Math.round(performance.now() - t0),
        sizeBytes: totalBytes,
        headers: h,
        body: accumulatedBody,
        bodyKind: 'text',
        isStream: true,
        streamCompleted: true,
        sseEvents: allEvents,
      };
      options.onStreamChunk?.(finalResp);
      return maybeDigestRetry(finalResp);
    }

    const buf = await res.arrayBuffer();
    const timeMs = Math.round(performance.now() - t0);
    const { body, bodyKind } = classifyBody(buf, contentTypeOf(h));
    const sse = isSse || isSseResponse(h, body);
    return maybeDigestRetry({
      status: res.status,
      statusText: res.statusText,
      timeMs,
      sizeBytes: buf.byteLength,
      headers: h,
      body,
      bodyKind,
      isStream: sse,
      streamCompleted: true,
      sseEvents: sse ? parseAllSseEvents(body) : undefined,
    });
  } catch (e) {
    if (e instanceof TypeError) {
      // Browser: gần như luôn là CORS. Node/CLI: không có CORS, lỗi là mạng thật
      // (ECONNREFUSED/TIMEOUT) — nguyên nhân nằm ở e.cause của undici.
      if (typeof window === 'undefined') {
        const cause = (e as { cause?: { code?: string; message?: string } }).cause;
        throw new Error(`Không kết nối được ${url.origin} — ${cause?.code ?? cause?.message ?? e.message}`);
      }
      throw new Error(
        'Failed to fetch — 99% là CORS (server không cho browser khác domain gọi) ' +
        'hoặc mất mạng. Hãy dùng bản .exe Tauri (gửi qua Rust native, không bị CORS).',
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}
