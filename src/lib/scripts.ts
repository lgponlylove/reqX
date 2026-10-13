import type { ApiRequest, ApiResponse, Collection, KeyValue } from '../types/api';
import { sendRequest } from './http-client';
import { scriptChainFor } from './script-chain';
import { uid } from './variables';
import { validateJsonSchema } from './json-schema';

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export interface ScriptOutcome {
  results: TestResult[];
  logs: string[];
  /** Lỗi ngoài pm.test (crash script) */
  error?: string;
}

export interface MutableRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface VarStore {
  get: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
}

const fmt = (v: unknown): string => {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

function makeExpect(actual: unknown) {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
  };
  return {
    to: {
      equal: (exp: unknown) => assert(Object.is(actual, exp), `expected ${fmt(actual)} to equal ${fmt(exp)}`),
      eql: (exp: unknown) =>
        assert(fmt(actual) === fmt(exp), `expected ${fmt(actual)} to deep-equal ${fmt(exp)}`),
      include: (sub: string) =>
        assert(
          typeof actual === 'string' && actual.includes(sub),
          `expected ${fmt(actual)} to include ${fmt(sub)}`,
        ),
      matchSchema: (schema: any) => {
        const res = validateJsonSchema(actual, schema);
        if (!res.valid) {
          throw new Error(`JSON Schema assertion failed: ${res.errors.join('; ')}`);
        }
      },
      be: {
        get true() {
          assert(actual === true, `expected ${fmt(actual)} to be true`);
          return true;
        },
        get false() {
          assert(actual === false, `expected ${fmt(actual)} to be false`);
          return false;
        },
        get null() {
          assert(actual === null, `expected ${fmt(actual)} to be null`);
          return false;
        },
        get undefined() {
          assert(actual === undefined, `expected ${fmt(actual)} to be undefined`);
          return false;
        },
        below: (n: number) =>
          assert(typeof actual === 'number' && actual < n, `expected ${fmt(actual)} to be below ${n}`),
        above: (n: number) =>
          assert(typeof actual === 'number' && actual > n, `expected ${fmt(actual)} to be above ${n}`),
      },
      have: {
        status: (n: number) =>
          assert(actual === n, `expected status ${fmt(actual)} to equal ${n}`),
        jsonSchema: (schema: any) => {
          const res = validateJsonSchema(actual, schema);
          if (!res.valid) {
            throw new Error(`JSON Schema assertion failed: ${res.errors.join('; ')}`);
          }
        },
      },
    },
  };
}

function captureConsole(logs: string[]) {
  return {
    log: (...args: unknown[]) => logs.push(args.map((a) => (typeof a === 'string' ? a : fmt(a))).join(' ')),
    warn: (...args: unknown[]) => logs.push('[warn] ' + args.map((a) => (typeof a === 'string' ? a : fmt(a))).join(' ')),
    error: (...args: unknown[]) => logs.push('[error] ' + args.map((a) => (typeof a === 'string' ? a : fmt(a))).join(' ')),
  };
}

// AsyncFunction để script dùng được `await` (code sync cũ vẫn chạy bình thường).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AsyncFn: new (...args: string[]) => (...a: any[]) => Promise<unknown> =
  Object.getPrototypeOf(async function () {}).constructor;

/** Tổng thời gian tối đa cho 1 script (kể cả pm.sendRequest lồng nhau). */
const SCRIPT_TIMEOUT_MS = 30000;

/** Input của pm.sendRequest — tương thích Postman (dạng rút gọn). */
export interface PmSendRequestInput {
  url: string;
  method?: string;
  header?: Record<string, string> | { key: string; value?: string }[];
  headers?: Record<string, string> | { key: string; value?: string }[];
  body?: string | { mode?: string; raw?: string; urlencoded?: { key: string; value?: string }[] };
}

export interface PmSendResponse {
  code: number;
  status: string;
  headers: Record<string, string> & { get: (name: string) => string | undefined };
  responseTime: number;
  responseSize: number;
  text: () => string;
  json: <T = unknown>() => T;
}

export type PmSendCallback = (err: unknown, res?: PmSendResponse) => void;

interface PmBase {
  pending: Set<Promise<unknown>>;
  sendRequest: {
    (req: string | PmSendRequestInput, cb: PmSendCallback): Promise<PmSendResponse | undefined>;
    (req: string | PmSendRequestInput): Promise<PmSendResponse>;
  };
}

function toKeyValues(input: PmSendRequestInput['header']): KeyValue[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .filter((h) => h.key?.trim())
      .map((h) => ({ id: uid('kv'), key: h.key, value: h.value ?? '', enabled: true }));
  }
  return Object.entries(input)
    .filter(([k]) => k.trim() !== '')
    .map(([key, value]) => ({ id: uid('kv'), key, value: value ?? '', enabled: true }));
}

/** Phần `pm` dùng chung: biến + sendRequest + iterationData. */
function buildPmBase(ctx: {
  env: VarStore;
  globals: VarStore;
  merged: Record<string, string>;
  signal?: AbortSignal;
  data?: Record<string, string>;
}): {
  variables: VarStore;
  environment: VarStore;
  globals: VarStore;
  iterationData: { get: (k: string) => string | undefined; toObject: () => Record<string, string> };
  sendRequest: PmBase['sendRequest'];
  pending: Set<Promise<unknown>>;
} {
  const pending = new Set<Promise<unknown>>();

  const doSend = async (req: string | PmSendRequestInput): Promise<PmSendResponse> => {
    const input: PmSendRequestInput = typeof req === 'string' ? { url: req } : (req ?? {});
    if (!input.url?.trim()) throw new Error('pm.sendRequest: thiếu url');
    const method = (input.method ?? 'GET').toUpperCase() as ApiRequest['method'];
    const headers = toKeyValues(input.header ?? input.headers);

    // Body: chuỗi thô (gửi nguyên văn) hoặc { mode:'urlencoded', urlencoded:[...] }.
    // form-data chưa hỗ trợ trong sendRequest — cần thì dùng request chính.
    let body = '';
    let bodyType: ApiRequest['bodyType'] = 'none';
    if (typeof input.body === 'string' && input.body !== '') {
      body = input.body;
      bodyType = 'json'; // gửi thô; tự set Content-Type nếu không phải JSON
    } else if (input.body && typeof input.body === 'object') {
      const b = input.body;
      if (b.mode === 'urlencoded' && Array.isArray(b.urlencoded)) {
        body = b.urlencoded
          .filter((p) => p.key?.trim())
          .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value ?? '')}`)
          .join('&');
        bodyType = 'urlencoded';
      } else if (b.raw !== undefined) {
        body = b.raw;
        bodyType = 'json';
      } else if (b.mode === 'formdata' || b.mode === 'form-data') {
        throw new Error('pm.sendRequest: chưa hỗ trợ form-data, dùng body chuỗi hoặc urlencoded');
      }
    }

    const apiReq: ApiRequest = {
      id: uid('sreq'),
      name: 'pm.sendRequest',
      method,
      url: input.url,
      params: [],
      headers,
      bodyType,
      body,
      auth: { type: 'none' },
      preRequest: '',
      tests: '',
      updatedAt: Date.now(),
    };
    // resolveVariables nhận (env, globals) — merged đã gộp sẵn nên truyền 1 lần là đủ.
    const res = await sendRequest(apiReq, ctx.merged, {}, SCRIPT_TIMEOUT_MS, ctx.signal);
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) lower[k.toLowerCase()] = v;
    return {
      code: res.status,
      status: res.statusText,
      headers: Object.assign({ ...res.headers }, { get: (n: string) => lower[n.toLowerCase()] }),
      responseTime: res.timeMs,
      responseSize: res.sizeBytes,
      text: () => res.body,
      json: <T = unknown>() => JSON.parse(res.body) as T,
    };
  };

  const sendRequestFn = ((req: string | PmSendRequestInput, cb?: PmSendCallback) => {
    const p = doSend(req);
    // Track bản nuốt lỗi: callback-style không được làm drain nổ,
    // await-style vẫn ném ở chỗ user await. Tránh unhandled rejection.
    const tracked: Promise<unknown> = p.then(
      () => { pending.delete(tracked); },
      () => { pending.delete(tracked); },
    );
    pending.add(tracked);
    if (cb) {
      // Kiểu callback Postman: lỗi vào cb, promise nuốt để khỏi unhandled rejection.
      return p.then(
        (res) => { cb(null, res); return res; },
        (err) => { cb(err); return undefined; },
      );
    }
    return p;
  }) as PmBase['sendRequest'];

  return {
    variables: {
      get: (k: string) => ctx.merged[k],
      set: (k: string, v: string) => ctx.env.set(k, String(v)),
    },
    environment: {
      get: (k: string) => ctx.env.get(k),
      set: (k: string, v: string) => ctx.env.set(k, String(v)),
    },
    globals: {
      get: (k: string) => ctx.globals.get(k),
      set: (k: string, v: string) => ctx.globals.set(k, String(v)),
    },
    // Dữ liệu dòng hiện tại khi Runner chạy file data (Postman: pm.iterationData).
    iterationData: {
      get: (k: string) => ctx.data?.[k],
      toObject: () => ({ ...(ctx.data ?? {}) }),
    },
    sendRequest: sendRequestFn,
    pending,
  };
}

/**
 * Chạy script async rồi chờ hết các pm.sendRequest còn treo (kể cả gọi lồng nhau
 * trong callback). Ném lỗi nếu quá SCRIPT_TIMEOUT_MS.
 */
async function runWithDrain(
  fn: (...a: unknown[]) => Promise<unknown>,
  args: unknown[],
  pm: { pending?: Set<Promise<unknown>> },
): Promise<void> {
  const t0 = Date.now();
  await fn(...args);
  const pending = pm.pending;
  if (!pending) return;
  while (pending.size > 0) {
    if (Date.now() - t0 > SCRIPT_TIMEOUT_MS) {
      throw new Error(`Script timeout sau ${SCRIPT_TIMEOUT_MS / 1000}s (pm.sendRequest chưa xong?)`);
    }
    await Promise.race([...pending]);
  }
}

/**
 * Chạy pre-request script. Script dùng `pm` + `request` (mutable).
 * Hỗ trợ `await pm.sendRequest(...)` lẫn callback kiểu Postman.
 * LƯU Ý: chạy bằng new Function trên máy user — chỉ chạy script do chính bạn viết.
 */
export async function runPreRequest(
  code: string,
  ctx: { env: VarStore; globals: VarStore; merged: Record<string, string>; request: MutableRequest; signal?: AbortSignal; data?: Record<string, string> },
): Promise<{ logs: string[]; error?: string }> {
  const logs: string[] = [];
  if (!code.trim()) return { logs };
  try {
    const pm = buildPmBase(ctx);
    const fn = new AsyncFn('pm', 'request', 'console', `"use strict";\n${code}`);
    await runWithDrain(fn, [pm, ctx.request, captureConsole(logs)], pm);
    return { logs };
  } catch (e) {
    return { logs, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Chạy tests script với `pm.response`, thu kết quả từng pm.test. */
export async function runTests(
  code: string,
  res: ApiResponse,
  ctx: { env: VarStore; globals: VarStore; merged: Record<string, string>; signal?: AbortSignal; data?: Record<string, string> },
): Promise<ScriptOutcome> {
  const logs: string[] = [];
  const results: TestResult[] = [];
  if (!code.trim()) return { results, logs };
  try {
    let jsonCache: unknown;
    let jsonTried = false;
    const pm = {
      ...buildPmBase(ctx),
      test: (name: string, fn: () => void) => {
        try {
          fn();
          results.push({ name, passed: true });
        } catch (e) {
          results.push({ name, passed: false, error: e instanceof Error ? e.message : String(e) });
        }
      },
      expect: makeExpect,
      response: {
        status: res.status,
        statusText: res.statusText,
        time: res.timeMs,
        size: res.sizeBytes,
        headers: res.headers,
        text: () => res.body,
        json: () => {
          if (!jsonTried) {
            jsonTried = true;
            jsonCache = JSON.parse(res.body);
          }
          return jsonCache;
        },
        to: {
          have: {
            status: (expectedStatus: number) => {
              if (res.status !== expectedStatus) {
                throw new Error(`expected response status ${res.status} to equal ${expectedStatus}`);
              }
            },
            jsonSchema: (schema: any) => {
              let parsed = jsonCache;
              if (!jsonTried) {
                jsonTried = true;
                parsed = JSON.parse(res.body);
                jsonCache = parsed;
              }
              const val = validateJsonSchema(parsed, schema);
              if (!val.valid) {
                throw new Error(`JSON Schema assertion failed: ${val.errors.join('; ')}`);
              }
            },
          },
          be: {
            success: () => {
              if (res.status < 200 || res.status >= 300) {
                throw new Error(`expected response status ${res.status} to be 2xx`);
              }
            },
          },
        },
      },
    };
    const fn = new AsyncFn('pm', 'console', `"use strict";\n${code}`);
    await runWithDrain(fn, [pm, captureConsole(logs)], pm);
    return { results, logs };
  } catch (e) {
    return { results, logs, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Chạy chuỗi pre-request (collection → folder → request) chung một ctx.
 * Mỗi script chạy trong scope riêng nên biến `const` không đụng nhau.
 * Dừng ngay ở script có lỗi (đúng hành vi Postman).
 */
export async function runPreRequestChain(
  codes: string[],
  ctx: Parameters<typeof runPreRequest>[1],
): Promise<{ logs: string[]; error?: string }> {
  const logs: string[] = [];
  for (const code of codes) {
    const r = await runPreRequest(code, ctx);
    logs.push(...r.logs);
    if (r.error) return { logs, error: r.error };
  }
  return { logs };
}

/** Chạy chuỗi tests script (request → folder → collection), gộp kết quả pm.test. */
export async function runTestsChain(
  codes: string[],
  res: ApiResponse,
  ctx: Parameters<typeof runTests>[2],
): Promise<ScriptOutcome> {
  const out: ScriptOutcome = { results: [], logs: [] };
  for (const code of codes) {
    const o = await runTests(code, res, ctx);
    out.results.push(...o.results);
    out.logs.push(...o.logs);
    if (o.error) {
      out.error = o.error;
      break;
    }
  }
  return out;
}

export const PRE_REQUEST_SAMPLE = `// Chạy TRƯỚC khi gửi — đọc/ghi biến, sửa request, gọi API phụ.pm.environment.set('ts', Date.now().toString());
// Login lấy token rồi gắn cho request chính (callback kiểu Postman):
// pm.sendRequest({ url: pm.variables.get('baseUrl') + '/login', method: 'POST',
//   header: { 'Content-Type': 'application/json' },
//   body: JSON.stringify({ username: 'admin', password: '123' }) },
//   (err, res) => { if (!err) pm.environment.set('token', res.json().access_token); });
// Hoặc dùng await: const res = await pm.sendRequest('https://api/login');
// Đọc: pm.variables.get('baseUrl')
// Sửa request: request.url = 'https://...'; request.headers['X-Trace'] = '1';
`;

export const TESTS_SAMPLE = `// Kiểm tra response — kết quả hiện ở tab Tests.
pm.test('Status 200', () => {
  pm.expect(pm.response.status).to.equal(200);
});
pm.test('Trả về JSON có id', () => {
  pm.expect(pm.response.json().id).to.be.above(0);
});
`;

/** Request từ file import mà có script → chưa rõ nguồn gốc, nên hỏi trước khi chạy hàng loạt.
 * Truyền collections để tính cả script kế thừa ở mức collection/folder. */
export function untrustedScriptRequests(reqs: ApiRequest[], collections?: Collection[]): ApiRequest[] {
  return reqs.filter((r) => {
    if (r.origin !== 'imported') return false;
    if ((r.preRequest ?? '').trim() || (r.tests ?? '').trim()) return true;
    if (!collections) return false;
    // Đã tới đây nghĩa là bản thân request không có script → mọi script trong chuỗi là kế thừa
    const chain = scriptChainFor(collections, r);
    return chain.pre.length > 0 || chain.tests.length > 0;
  });
}

/**
 * Cổng duyệt script không rõ nguồn gốc. Mặc định là hộp thoại confirm của UI;
 * Node/CLI không có confirm → setScriptGate() để quyết định theo cờ --allow-scripts.
 * Trả về false = KHÔNG chạy script (an toàn mặc định).
 */
export type ScriptGate = (message: string, untrusted: ApiRequest[]) => boolean;

const uiScriptGate: ScriptGate = (message) =>
  typeof confirm === 'function' ? confirm(message) : false;

let scriptGate: ScriptGate = uiScriptGate;

export function setScriptGate(gate?: ScriptGate | null): void {
  scriptGate = gate ?? uiScriptGate;
}

/**
 * Hộp thoại cảnh báo trước khi chạy Flow/Runner. Trả về true = chạy tiếp.
 * Gọi ở UI tương tác (Flow, Runner) — KHÔNG gọi ở Scheduler headless (confirm treo app).
 */
export function confirmUntrustedScripts(reqs: ApiRequest[], where: string, collections?: Collection[]): boolean {
  const bad = untrustedScriptRequests(reqs, collections);
  if (bad.length === 0) return true;
  const lines = bad
    .map((r) => {
      const kinds: string[] = [];
      if ((r.preRequest ?? '').trim()) kinds.push('pre-request');
      if ((r.tests ?? '').trim()) kinds.push('tests');
      if (kinds.length === 0) kinds.push('kế thừa từ collection/folder');
      return `- ${r.name || r.url} (${kinds.join(' + ')})`;
    })
    .join('\n');
  return scriptGate(
    `⚠ “${where}” chứa script từ file import (chưa rõ nguồn gốc):\n${lines}\n\n` +
      `Script chạy được trong app — chỉ bấm OK nếu bạn tin nguồn file này.\n` +
      `(Mở request → bấm Lưu = đánh dấu đã xem, lần sau không hỏi nữa.)\n\nChạy tiếp?`,
    bad,
  );
}
