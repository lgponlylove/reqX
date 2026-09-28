import type { ApiRequest, ApiResponse } from '../types/api';

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

/**
 * Chạy pre-request script. Script dùng `pm` + `request` (mutable).
 * LƯU Ý: chạy bằng new Function trên máy user — chỉ chạy script do chính bạn viết.
 */
export function runPreRequest(
  code: string,
  ctx: { env: VarStore; globals: VarStore; merged: Record<string, string>; request: MutableRequest },
): { logs: string[]; error?: string } {
  const logs: string[] = [];
  if (!code.trim()) return { logs };
  try {
    const pm = {
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
    };
    const fn = new Function('pm', 'request', 'console', `"use strict";\n${code}`);
    fn(pm, ctx.request, captureConsole(logs));
    return { logs };
  } catch (e) {
    return { logs, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Chạy tests script với `pm.response`, thu kết quả từng pm.test. */
export function runTests(
  code: string,
  res: ApiResponse,
  ctx: { env: VarStore; globals: VarStore; merged: Record<string, string> },
): ScriptOutcome {
  const logs: string[] = [];
  const results: TestResult[] = [];
  if (!code.trim()) return { results, logs };
  try {
    let jsonCache: unknown;
    let jsonTried = false;
    const pm = {
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
      },
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
    };
    const fn = new Function('pm', 'console', `"use strict";\n${code}`);
    fn(pm, captureConsole(logs));
    return { results, logs };
  } catch (e) {
    return { results, logs, error: e instanceof Error ? e.message : String(e) };
  }
}

export const PRE_REQUEST_SAMPLE = `// Chạy TRƯỚC khi gửi — đọc/ghi biến, sửa request.
// Ví dụ: gắn timestamp để chống cache
pm.environment.set('ts', Date.now().toString());
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

/** Request từ file import mà có script → chưa rõ nguồn gốc, nên hỏi trước khi chạy hàng loạt. */
export function untrustedScriptRequests(reqs: ApiRequest[]): ApiRequest[] {
  return reqs.filter(
    (r) => r.origin === 'imported' && ((r.preRequest ?? '').trim() || (r.tests ?? '').trim()),
  );
}

/**
 * Hộp thoại cảnh báo trước khi chạy Flow/Runner. Trả về true = chạy tiếp.
 * Gọi ở UI tương tác (Flow, Runner) — KHÔNG gọi ở Scheduler headless (confirm treo app).
 */
export function confirmUntrustedScripts(reqs: ApiRequest[], where: string): boolean {
  const bad = untrustedScriptRequests(reqs);
  if (bad.length === 0) return true;
  const lines = bad
    .map((r) => {
      const kinds: string[] = [];
      if ((r.preRequest ?? '').trim()) kinds.push('pre-request');
      if ((r.tests ?? '').trim()) kinds.push('tests');
      return `- ${r.name || r.url} (${kinds.join(' + ')})`;
    })
    .join('\n');
  return confirm(
    `⚠ “${where}” chứa script từ file import (chưa rõ nguồn gốc):\n${lines}\n\n` +
      `Script chạy được trong app — chỉ bấm OK nếu bạn tin nguồn file này.\n` +
      `(Mở request → bấm Lưu = đánh dấu đã xem, lần sau không hỏi nữa.)\n\nChạy tiếp?`,
  );
}
