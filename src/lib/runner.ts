import type { ApiRequest, ApiResponse, Collection } from '../types/api';
import { sendRequest } from './http-client';
import { runPreRequestChain, runTestsChain, type MutableRequest } from './scripts';
import { scriptChainFor } from './script-chain';
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

function varCtx(hooks: RunnerHooks, dataRow?: Record<string, string>) {
  const { envVars, globals } = hooks.getVars();
  const env = dataRow ? { ...envVars, ...dataRow } : envVars;
  return {
    env: {
      get: (k: string) => (dataRow && k in dataRow ? dataRow[k] : hooks.getVars().envVars[k]),
      set: (k: string, v: string) => hooks.setEnv(k, v),
    },
    globals: {
      get: (k: string) => hooks.getVars().globals[k],
      set: (k: string, v: string) => hooks.setGlobal(k, v),
    },
    merged: { ...globals, ...env },
    data: dataRow,
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

/** Chạy 1 request: pre-request → gửi → tests (pipeline y hệt RequestBar).
 * dataRow: dòng data file của iteration (thắng env khi đọc, set vẫn ghi vào env thật).
 * collections: để giải script kế thừa ở mức collection/folder (truyền vào thì script mức cha mới chạy). */
export async function runOneRequest(
  req: ApiRequest,
  hooks: RunnerHooks,
  timeoutMs: number,
  signal?: AbortSignal,
  dataRow?: Record<string, string>,
  collections?: Collection[],
): Promise<RunItemResult> {
  const base = { requestId: req.id, name: req.name, method: req.method, url: req.url, logs: [] as string[] };
  try {
    const chain = scriptChainFor(collections ?? [], req);
    const mutable: MutableRequest = {
      url: req.url,
      headers: Object.fromEntries(
        req.headers.filter((h) => h.enabled && h.key.trim() !== '').map((h) => [h.key, h.value]),
      ),
      body: req.body,
    };
    const pre = await runPreRequestChain(chain.pre, { ...varCtx(hooks, dataRow), request: mutable });
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
    // Data row thắng env khi resolve {{...}} trong url/params/headers/body
    const effEnv = dataRow ? { ...envVars, ...dataRow } : envVars;
    const res = await sendRequest(effective, effEnv, globals, timeoutMs, signal);

    let passed = 0;
    let total = 0;
    const logs = [...pre.logs];
    if (chain.tests.length > 0) {
      const outcome = await runTestsChain(chain.tests, res, varCtx(hooks, dataRow));
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
  /** Toàn bộ collection trong store — cần để chạy script mức collection/folder. */
  collections?: Collection[];
}

export interface DataIterationResult {
  rowIndex: number;
  row: Record<string, string>;
  items: RunItemResult[];
  ok: boolean;
  passedTests: number;
  totalTests: number;
  timeMs: number;
}

export interface RunDataOpts extends RunAllOpts {
  /** Giới hạn số dòng (mặc định chạy hết). */
  maxRows?: number;
  onIteration?: (it: DataIterationResult, index: number) => void;
}

/**
 * Chạy data-driven kiểu Postman: mỗi dòng data = 1 iteration chạy HẾT danh sách
 * request với dòng đó (data thắng env khi đọc; set vẫn ghi env thật nên giữ qua các dòng).
 */
export async function runCollectionWithData(
  list: ApiRequest[],
  rows: Record<string, string>[],
  hooks: RunnerHooks,
  opts: RunDataOpts,
): Promise<DataIterationResult[]> {
  const out: DataIterationResult[] = [];
  const n = opts.maxRows != null ? Math.min(rows.length, Math.max(0, opts.maxRows)) : rows.length;
  for (let i = 0; i < n; i++) {
    if (opts.signal?.aborted) break;
    const t0 = performance.now();
    const items: RunItemResult[] = [];
    for (const req of list) {
      if (opts.signal?.aborted) break;
      items.push(await runOneRequest(req, hooks, opts.timeoutMs, opts.signal, rows[i], opts.collections));
      const last = items[items.length - 1];
      if (!last.ok && opts.stopOnError) break;
      if (opts.delayMs > 0) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, opts.delayMs);
          opts.signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
        });
      }
    }
    const it: DataIterationResult = {
      rowIndex: i,
      row: rows[i],
      items,
      ok: items.length > 0 && items.every((r) => r.ok),
      passedTests: items.reduce((a, r) => a + r.testsPassed, 0),
      totalTests: items.reduce((a, r) => a + r.testsTotal, 0),
      timeMs: Math.round(performance.now() - t0),
    };
    out.push(it);
    opts.onIteration?.(it, i);
    if (!it.ok && opts.stopOnError) break;
  }
  return out;
}

/** Chạy tuần tự danh sách request (không data file), dừng khi abort (hoặc khi lỗi nếu stopOnError). */
export async function runRequestList(
  list: ApiRequest[],
  hooks: RunnerHooks,
  opts: RunAllOpts,
): Promise<RunItemResult[]> {
  const out: RunItemResult[] = [];
  for (let i = 0; i < list.length; i++) {
    if (opts.signal?.aborted) break;
    const r = await runOneRequest(list[i], hooks, opts.timeoutMs, opts.signal, undefined, opts.collections);
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
