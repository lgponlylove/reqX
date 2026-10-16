import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPreRequest, runTests } from '../scripts';
import { PM_SANDBOX_DOC, SCRIPT_SNIPPETS, snippetById, snippetsFor } from '../script-snippets';
import type { ApiResponse } from '../../types/api';

/**
 * Mỗi mẫu trong SCRIPT_SNIPPETS được chạy THẬT qua sandbox (`runPreRequest` / `runTests`)
 * với fetch giả lập — đây là bằng chứng cho claims "chỉ việc bấm là chạy".
 */

vi.stubGlobal('window', {
  location: { origin: 'http://localhost' },
  setTimeout: (...a: unknown[]) => setTimeout(...(a as [() => void, number])),
  clearTimeout: (...a: unknown[]) => clearTimeout(...(a as [number])),
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      return handler(url, init);
    }),
  );
  return calls;
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function makeCtx(vars: Record<string, string> = {}) {
  const store: Record<string, string> = { ...vars };
  const vs = {
    get: (k: string) => store[k],
    set: (k: string, v: string) => { store[k] = v; },
  };
  return { ctx: { env: vs, globals: vs, merged: { ...store } }, store };
}

const mutable = (over: Partial<{ url: string; headers: Record<string, string>; body: string }> = {}) => ({
  url: 'https://api.test/main',
  headers: {} as Record<string, string>,
  body: '',
  ...over,
});

const res = (over: Partial<ApiResponse> = {}): ApiResponse => ({
  status: 200,
  statusText: 'OK',
  timeMs: 120,
  sizeBytes: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: 1, code: 'C01', createdAt: '2026-10-15', status: 'NEW' }),
  ...over,
});

async function runPre(id: string, vars?: Record<string, string>, req?: ReturnType<typeof mutable>) {
  const s = snippetById(id)!;
  const { ctx, store } = makeCtx(vars);
  const request = req ?? mutable();
  const out = await runPreRequest(s.code, { ...ctx, request });
  return { out, store, request };
}

async function runTestsOf(id: string, vars: Record<string, string> = {}, response: ApiResponse = res()) {
  const s = snippetById(id)!;
  const { ctx } = makeCtx(vars);
  const out = await runTests(s.code, response, ctx);
  return { out, ctx };
}

describe('thư viện snippet: cấu trúc', () => {
  it('mọi mẫu có id duy nhất + nhãn vi/en + hint vi/en + code', () => {
    const ids = SCRIPT_SNIPPETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SCRIPT_SNIPPETS) {
      expect(['pre', 'tests']).toContain(s.kind);
      expect(s.label.vi.trim().length).toBeGreaterThan(0);
      expect(s.label.en.trim().length).toBeGreaterThan(0);
      expect(s.hint.vi.trim().length).toBeGreaterThan(0);
      expect(s.hint.en.trim().length).toBeGreaterThan(0);
      expect(s.code.trim().length).toBeGreaterThan(20);
    }
  });

  it('snippetsFor lọc đúng theo kind', () => {
    expect(snippetsFor('pre').every((s) => s.kind === 'pre')).toBe(true);
    expect(snippetsFor('tests').every((s) => s.kind === 'tests')).toBe(true);
    expect(snippetsFor('pre').length).toBeGreaterThanOrEqual(4);
    expect(snippetsFor('tests').length).toBeGreaterThanOrEqual(4);
  });

  it('không mẫu nào dùng API ngoài sandbox ReqX', () => {
    const banned = [
      /\.to\.not\./, // chuỗi phủ định của Chai — sandbox không có
      /pm\.request/, // chỉ pre-request mới có object 'request'
      /pm\.cookies|pm\.visualizer/,
      /require\(|import\s/,
      /formdata|form-data/i,
      /pm\.test\([^)]*,\s*async/, // fn test phải sync
      /localStorage|sessionStorage/,
    ];
    for (const s of SCRIPT_SNIPPETS) {
      for (const re of banned) {
        expect(s.code, `mẫu ${s.id} dùng ${re}`).not.toMatch(re);
      }
    }
  });

  it('PM_SANDBOX_DOC không lẫn tiếng nước ngoài ngoài tiếng Việt/Anh', () => {
    expect(PM_SANDBOX_DOC).not.toMatch(/[\u4e00-\u9fff]/); // không còn ký tự Hán
    expect(PM_SANDBOX_DOC).toMatch(/pm\.sendRequest/);
    expect(PM_SANDBOX_DOC).toMatch(/fn PHẢI LÀ HÀM SYNC/);
  });
});

describe('snippet pre-request — chạy thật qua runPreRequest', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('token-client-credentials: gọi IdP, gắn "Bearer <token>" vào request', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost' },
      setTimeout: setTimeout as unknown,
      clearTimeout: clearTimeout as unknown,
    });
    const body: string[] = [];
    mockFetch((url, init) => {
      if (url.includes('/oauth2/token')) {
        body.push(String(init?.body ?? ''));
        return jsonRes({ access_token: 'AT-1', token_type: 'Bearer', expires_in: 3600 });
      }
      return jsonRes({});
    });
    const { out, store, request } = await runPre('token-client-credentials', {
      clientId: 'cid',
      clientSecret: 'c@secret',
    });
    expect(out.error).toBeUndefined();
    expect(request.headers.Authorization).toBe('Bearer AT-1');
    expect(store['authen-get-permissions']).toBe('Bearer AT-1');
    // body urlencoded, secret được escape
    expect(body[0]).toContain('grant_type=client_credentials');
    expect(body[0]).toContain('client_id=cid');
    expect(body[0]).toContain('client_secret=c%40secret');
  });

  it('token-client-credentials: token còn hạn (cache 5 phút) thì KHÔNG gọi IdP', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost' },
      setTimeout: setTimeout as unknown,
      clearTimeout: clearTimeout as unknown,
    });
    const calls = mockFetch(() => jsonRes({ access_token: 'KHONG-DC' }));
    const { out, request } = await runPre('token-client-credentials', {
      'authen-get-permissions': 'Bearer TU-MAU',
      token_lanh_at: String(Date.now() - 60_000), // mới 1 phút trước
    });
    expect(out.error).toBeUndefined();
    expect(calls.length).toBe(0);
    expect(request.headers.Authorization).toBe('Bearer TU-MAU');
  });

  it('token-client-credentials: IdP báo lỗi → script dừng với thông báo rõ', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost' },
      setTimeout: setTimeout as unknown,
      clearTimeout: clearTimeout as unknown,
    });
    mockFetch(() => new Response('{"error":"unauthorized_client"}', { status: 400 }));
    const { out } = await runPre('token-client-credentials', { clientId: 'a', clientSecret: 'b' });
    expect(out.error).toMatch(/Không lấy được token — HTTP 400/);
  });

  it('token-login-json: đăng nhập → token → Authorization', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost' },
      setTimeout: setTimeout as unknown,
      clearTimeout: clearTimeout as unknown,
    });
    mockFetch((url) => (url.endsWith('/login') ? jsonRes({ access_token: 'TK-9' }) : jsonRes({})));
    const { out, store, request } = await runPre('token-login-json', {
      baseUrl: 'https://api.test',
      username: 'qa',
      password: 'p@ss',
    });
    expect(out.error).toBeUndefined();
    expect(request.headers.Authorization).toBe('Bearer TK-9');
    expect(store.accessToken).toBe('TK-9');
  });

  it('sign-hmac: sinh X-Date/X-Nonce/X-Signature = HMAC-SHA256 hex 64 ký tự', async () => {
    const { out, request } = await runPre(
      'sign-hmac',
      { hmacSecret: 'k' },
      mutable({ body: '{"a":1}' }),
    );
    expect(out.error).toBeUndefined();
    expect(request.headers['X-Signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isNaN(Date.parse(request.headers['X-Date']))).toBe(false);
    expect(request.headers['X-Nonce'].length).toBeGreaterThan(4);
  });

  it('sign-hmac: thiếu biến key → báo đúng tên biến', async () => {
    const { out } = await runPre('sign-hmac', {});
    expect(out.error).toMatch(/Thiếu biến hmacSecret/);
  });

  it('header-from-vars: không gọi mạng, chỉ gắn header', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost' },
      setTimeout: setTimeout as unknown,
      clearTimeout: clearTimeout as unknown,
    });
    const calls = mockFetch(() => jsonRes({}));
    const { out, request } = await runPre('header-from-vars', { tenant: 'SHOME' });
    expect(out.error).toBeUndefined();
    expect(calls.length).toBe(0);
    expect(request.headers['X-Tenant']).toBe('SHOME');
    expect(request.headers['X-Request-Id']).toMatch(/^req-\d+$/);
  });

  it('mọi mẫu pre-request đều không crash sandbox', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost' },
      setTimeout: setTimeout as unknown,
      clearTimeout: clearTimeout as unknown,
    });
    mockFetch(() => jsonRes({ access_token: 'X', token_type: 'Bearer', id: 1, code: 'C', createdAt: 't', status: 'NEW' }));
    const vars = {
      clientId: 'cid', clientSecret: 'sec', baseUrl: 'https://api.test', username: 'u', password: 'p',
      hmacSecret: 'k', tenant: 'ACME', domain: 'api.test',
    };
    for (const s of snippetsFor('pre')) {
      const { ctx } = makeCtx(vars);
      const request = mutable();
      const out = await runPreRequest(s.code, { ...ctx, request });
      expect(out.error, `mẫu ${s.id} lỗi: ${out.error}`).toBeUndefined();
      expect(out.logs).toBeInstanceOf(Array);
    }
  });
});

describe('snippet tests — chạy thật qua runTests', () => {
  it('test-status-time: pass khi 200 + nhanh', async () => {
    const { out } = await runTestsOf('test-status-time');
    expect(out.error).toBeUndefined();
    expect(out.results.every((r) => r.passed)).toBe(true);
    expect(out.results).toHaveLength(2);
  });

  it('test-status-time: fail hiện lý do cụ thể', async () => {
    const { out } = await runTestsOf('test-status-time', {}, res({ status: 500, statusText: 'Server Error' }));
    expect(out.results.find((r) => r.name === 'Status 200')?.passed).toBe(false);
    expect(out.results.find((r) => r.name === 'Status 200')?.error).toMatch(/expected response status 500/);
  });

  it('test-required-fields: pass với body đủ field', async () => {
    const { out } = await runTestsOf('test-required-fields');
    expect(out.error).toBeUndefined();
    expect(out.results.every((r) => r.passed)).toBe(true);
    expect(out.results).toHaveLength(4); // 1 test JSON + 3 field
  });

  it('test-required-fields: thiếu field → nói rõ thiếu field nào', async () => {
    const { out } = await runTestsOf('test-required-fields', {}, res({ body: '{"id":1,"createdAt":"t"}' }));
    const fail = out.results.find((r) => r.name.includes('code'));
    expect(fail?.passed).toBe(false);
    expect(fail?.error).toMatch(/thiếu field "code"/);
  });

  it('test-required-fields: field rỗng → báo "rỗng"', async () => {
    const { out } = await runTestsOf('test-required-fields', {}, res({ body: '{"id":1,"code":"","createdAt":"t"}' }));
    expect(out.results.find((r) => r.name.includes('code'))?.error).toMatch(/Field "code" rỗng/);
  });

  it('test-required-fields: body không phải JSON → test 1 fail, không sập script', async () => {
    const { out } = await runTestsOf('test-required-fields', {}, res({ body: '<html>502</html>' }));
    expect(out.error).toBeUndefined();
    expect(out.results[0].passed).toBe(false);
    expect(out.results[0].error).toMatch(/không phải JSON/i);
  });

  it('test-json-schema: đúng cấu trúc thì pass, sai kiểu thì nêu lỗi schema', async () => {
    const ok = await runTestsOf('test-json-schema', {}, res({ body: '{"id":7,"status":"NEW"}' }));
    expect(ok.out.results.every((r) => r.passed)).toBe(true);

    const bad = await runTestsOf('test-json-schema', {}, res({ body: '{"id":"7","status":"XX"}' }));
    expect(bad.out.results[0].passed).toBe(false);
    expect(bad.out.results[0].error).toMatch(/JSON Schema/);
  });

  it('test-has-auth: có token + 200 → pass', async () => {
    const { out } = await runTestsOf('test-has-auth', { 'authen-get-permissions': 'Bearer ABC' });
    expect(out.error).toBeUndefined();
    expect(out.results.every((r) => r.passed)).toBe(true);
  });

  it('test-has-auth: biến token rỗng → bảo đi chạy mẫu pre-request', async () => {
    const { out } = await runTestsOf('test-has-auth', {});
    expect(out.results[0].passed).toBe(false);
    expect(out.results[0].error).toMatch(/rỗng — Pre-request chưa lấy được token/);
  });

  it('test-has-auth: 401 → fail kèm diễn giải token hết hạn', async () => {
    const { out } = await runTestsOf(
      'test-has-auth',
      { 'authen-get-permissions': 'Bearer ABC' },
      res({ status: 401, statusText: 'Unauthorized', body: 'expired' }),
    );
    expect(out.results[0].passed).toBe(true);
    expect(out.results[1].passed).toBe(false);
    expect(out.results[1].error).toMatch(/hết hạn hoặc sai quyền/);
  });

  it('token-client-credentials + test-has-auth nối nhau: header thật = giá trị test đọc được', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost' },
      setTimeout: setTimeout as unknown,
      clearTimeout: clearTimeout as unknown,
    });
    mockFetch(() => jsonRes({ access_token: 'NOI-COOK', token_type: 'Bearer' }));
    const { ctx, store } = makeCtx({ clientId: 'cid', clientSecret: 'sec' });
    const request = mutable();
    const pre = await runPreRequest(snippetById('token-client-credentials')!.code, { ...ctx, request });
    expect(pre.error).toBeUndefined();
    const mergedAfter = { ...ctx.merged, 'authen-get-permissions': store['authen-get-permissions'] };
    const tests = await runTests(snippetById('test-has-auth')!.code, res(), {
      env: ctx.env, globals: ctx.globals, merged: mergedAfter,
    });
    expect(tests.error).toBeUndefined();
    expect(tests.results.every((r) => r.passed)).toBe(true);
    expect(request.headers.Authorization).toBe('Bearer NOI-COOK');
  });
});
