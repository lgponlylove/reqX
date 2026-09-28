import type { ApiRequest, ApiResponse, Collection } from '../types/api';
import { sendRequest } from './http-client';
import { runPreRequest, runTests, type MutableRequest } from './scripts';
import { uid } from './variables';

export interface RunItemResult {
  requestId: string;
  name: string;
  method: string;
  url: string;
  ok: boolean;
  status?: number;
  timeMs?: number;
  testsPassed: number;
  testsTotal: number;
  error?: string;
  logs: string[];
  /** Response gốc (để flow trích giá trị) — chỉ có khi đã nhận được response. */
  response?: Pick<ApiResponse, 'status' | 'headers' | 'body' | 'bodyKind'>;
}

/** Callbacks để runner đọc/ghi biến môi trường (giống RequestBar). */
export interface RunnerHooks {
  getVars: () => { envVars: Record<string, string>; globals: Record<string, string> };
  setEnv: (k: string, v: string) => void;
  setGlobal: (k: string, v: string) => void;
}

function varCtx(hooks: RunnerHooks) {
  const { envVars, globals } = hooks.getVars();
  return {
    env: {
      get: (k: string) => hooks.getVars().envVars[k],
      set: (k: string, v: string) => hooks.setEnv(k, v),
    },
    globals: {
      get: (k: string) => hooks.getVars().globals[k],
      set: (k: string, v: string) => hooks.setGlobal(k, v),
    },
    merged: { ...globals, ...envVars },
  };
}

/** Lấy danh sách request theo phạm vi: 'all' | 'root' | folderId (giữ đúng thứ tự). */
export function collectRequests(
  col: Collection,
  requests: Record<string, ApiRequest>,
  folderId: string,
): ApiRequest[] {
  const ids =
    folderId === 'all'
      ? [...col.rootRequestIds, ...col.folders.flatMap((f) => f.requestIds)]
      : folderId === 'root'
        ? col.rootRequestIds
        : (col.folders.find((f) => f.id === folderId)?.requestIds ?? []);
  return ids.map((id) => requests[id]).filter(Boolean);
}

/** Cắt response gọn để gắn vào kết quả (tránh ôm cả size/time thừa). */
function pickRes(res: ApiResponse): Pick<ApiResponse, 'status' | 'headers' | 'body' | 'bodyKind'> {
  return { status: res.status, headers: res.headers, body: res.body, bodyKind: res.bodyKind };
}

/** Chạy 1 request: pre-request → gửi → tests (pipeline y hệt RequestBar). */
export async function runOneRequest(
  req: ApiRequest,
  hooks: RunnerHooks,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RunItemResult> {
  const base = { requestId: req.id, name: req.name, method: req.method, url: req.url, logs: [] as string[] };
  try {
    const mutable: MutableRequest = {
      url: req.url,
      headers: Object.fromEntries(
        req.headers.filter((h) => h.enabled && h.key.trim() !== '').map((h) => [h.key, h.value]),
      ),
      body: req.body,
    };
    const pre = runPreRequest(req.preRequest ?? '', { ...varCtx(hooks), request: mutable });
    if (pre.error) return { ...base, ok: false, testsPassed: 0, testsTotal: 0, error: `Pre-request lỗi: ${pre.error}`, logs: pre.logs };

    const effective: ApiRequest = { ...req, url: mutable.url, body: mutable.body };
    const seen = new Set<string>();
    const nextHeaders = req.headers.map((h) => {
      if (!h.enabled || h.key.trim() === '' || !(h.key in mutable.headers)) return h;
      seen.add(h.key);
      return { ...h, value: mutable.headers[h.key] };
    });
    for (const [k, v] of Object.entries(mutable.headers)) {
      if (!seen.has(k) && !nextHeaders.some((h) => h.key === k)) {
        nextHeaders.push({ id: uid('kv'), key: k, value: v, enabled: true });
      }
    }
    effective.headers = nextHeaders;

    const { envVars, globals } = hooks.getVars();
    const res = await sendRequest(effective, envVars, globals, timeoutMs, signal);

    let passed = 0;
    let total = 0;
    const logs = [...pre.logs];
    if (req.tests?.trim()) {
      const outcome = runTests(req.tests, res, varCtx(hooks));
      total = outcome.results.length;
      passed = outcome.results.filter((r) => r.passed).length;
      logs.push(...outcome.logs);
      const failed = outcome.results.filter((r) => !r.passed);
      if (outcome.error) return { ...base, ok: false, status: res.status, timeMs: res.timeMs, testsPassed: passed, testsTotal: total, error: `Tests crash: ${outcome.error}`, logs, response: pickRes(res) };
      if (failed.length > 0) {
        return { ...base, ok: false, status: res.status, timeMs: res.timeMs, testsPassed: passed, testsTotal: total, error: failed.map((f) => `${f.name}: ${f.error ?? 'fail'}`).join(' | '), logs, response: pickRes(res) };
      }
    }
    const ok = res.status >= 200 && res.status < 300;
    return {
      ...base, ok, status: res.status, timeMs: res.timeMs,
      testsPassed: passed, testsTotal: total,
      error: ok ? undefined : `HTTP ${res.status} ${res.statusText}`,
      logs,
      response: pickRes(res),
    };
  } catch (e) {
    return { ...base, ok: false, testsPassed: 0, testsTotal: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface RunAllOpts {
  timeoutMs: number;
  delayMs: number;
  stopOnError: boolean;
  signal?: AbortSignal;
  onItem?: (r: RunItemResult, index: number) => void;
}

/** Chạy tuần tự danh sách request, dừng khi abort (hoặc khi lỗi nếu stopOnError). */
export async function runRequestList(
  list: ApiRequest[],
  hooks: RunnerHooks,
  opts: RunAllOpts,
): Promise<RunItemResult[]> {
  const out: RunItemResult[] = [];
  for (let i = 0; i < list.length; i++) {
    if (opts.signal?.aborted) break;
    const r = await runOneRequest(list[i], hooks, opts.timeoutMs, opts.signal);
    out.push(r);
    opts.onItem?.(r, i);
    if (!r.ok && opts.stopOnError) break;
    if (opts.delayMs > 0 && i < list.length - 1) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, opts.delayMs);
        opts.signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
      });
    }
  }
  return out;
}
