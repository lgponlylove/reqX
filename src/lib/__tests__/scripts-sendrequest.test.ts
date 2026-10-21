import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPreRequest, runTests } from '../scripts';

// http-client dùng window (browser path) — stub tối thiểu để chạy trên node.
vi.stubGlobal('window', {
  location: { origin: 'http://localhost' },
  setTimeout: (...a: unknown[]) => setTimeout(...(a as [() => void, number])),
  clearTimeout: (...a: unknown[]) => clearTimeout(...(a as [number])),
});

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => handler(url, init)));
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function ctx(vars: Record<string, string> = {}) {
  const store = { ...vars };
  const vs = {
    get: (k: string) => store[k],
    set: (k: string, v: string) => { store[k] = v; },
  };
  return { ctx: { env: vs, globals: vs, merged: { ...store } }, store };
}

const mutable = () => ({ url: 'https://api.test/main', headers: {} as Record<string, string>, body: '' });

describe('pm.sendRequest', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('callback style: gọi API phụ rồi set biến', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost' },
      setTimeout: setTimeout as unknown,
      clearTimeout: clearTimeout as unknown,
    });
    mockFetch((url) =>
      url.includes('/login')
        ? jsonRes({ access_token: 'tok-123' })
        : jsonRes({ ok: true }),
    );
    const { ctx: c, store } = ctx({ baseUrl: 'https://api.test' });
    const out = await runPreRequest(
      `pm.sendRequest({ url: pm.variables.get('baseUrl') + '/login', method: 'POST',
         header: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ u: 'a' }) },
        (err, res) => { if (!err) pm.environment.set('token', res.json().access_token); });`,
      { ...c, request: mutable() },
    );
    expect(out.error).toBeUndefined();
    expect(store.token).toBe('tok-123');
  });

  it('await style: trả về code/headers/json', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost' },
      setTimeout: setTimeout as unknown,
      clearTimeout: clearTimeout as unknown,
    });
    mockFetch(() => jsonRes({ id: 7 }));
    const { ctx: c } = ctx();
    const out = await runPreRequest(
      `const res = await pm.sendRequest('https://api.test/users');
       pm.environment.set('uid', String(res.json().id));
       pm.environment.set('code', String(res.code));
       pm.environment.set('ct', res.headers.get('content-type'));`,
      { ...c, request: mutable() },
    );
    expect(out.error).toBeUndefined();
    // store nằm trong ctx env — đọc lại qua merged? kiểm tra qua biến set
    expect(c.env.get('uid')).toBe('7');
    expect(c.env.get('code')).toBe('200');
    expect(c.env.get('ct')).toBe('application/json');
  });

  it('lỗi mạng với await → error của script', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost' },
      setTimeout: setTimeout as unknown,
      clearTimeout: clearTimeout as unknown,
    });
    mockFetch(() => { throw new TypeError('fetch failed'); });
    const { ctx: c } = ctx();
    const out = await runPreRequest(
      `await pm.sendRequest('https://api.test/x');`,
      { ...c, request: mutable() },
    );
    expect(out.error).toMatch(/CORS|Failed to fetch/);
  });

  it('lỗi mạng với callback → vào cb, script không crash', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost' },
      setTimeout: setTimeout as unknown,
      clearTimeout: clearTimeout as unknown,
    });
    mockFetch(() => { throw new TypeError('fetch failed'); });
    const { ctx: c } = ctx();
    const out = await runPreRequest(
      `pm.sendRequest('https://api.test/x', (err) => {
         pm.environment.set('gotErr', err ? 'yes' : 'no'); });`,
      { ...c, request: mutable() },
    );
    expect(out.error).toBeUndefined();
    expect(c.env.get('gotErr')).toBe('yes');
  });

  it('dùng được trong tests script (top-level await + pm.test)', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost' },
      setTimeout: setTimeout as unknown,
      clearTimeout: clearTimeout as unknown,
    });
    mockFetch(() => jsonRes({ access_token: 'tok-9' }));
    const { ctx: c } = ctx();
    const out = await runTests(
      `const res = await pm.sendRequest('https://api.test/verify');
       pm.test('token khớp', () => { pm.expect(res.json().access_token).to.equal('tok-9'); });`,
      { status: 200, statusText: 'OK', timeMs: 5, sizeBytes: 2, headers: {}, body: '{}' },
      c,
    );
    expect(out.error).toBeUndefined();
    expect(out.results).toEqual([{ name: 'token khớp', passed: true }]);
  });

  it('thiếu url → lỗi rõ ràng', async () => {
    const { ctx: c } = ctx();
    const out = await runPreRequest(`await pm.sendRequest({});`, { ...c, request: mutable() });
    expect(out.error).toMatch(/thiếu url/);
  });
});
