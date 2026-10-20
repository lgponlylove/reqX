import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ApiRequest, Collection } from '../../types/api';

/** Dựng request GET tối giản (chỉ đủ field, body/auth rỗng). */
function req(id: string, collectionId: string): ApiRequest {
  return {
    id,
    name: id,
    method: 'GET',
    url: `https://api.test/${id}`,
    params: [],
    headers: [],
    bodyType: 'none',
    body: '',
    auth: { type: 'none' },
    collectionId,
    updatedAt: 1,
  };
}

function makeHooks(envStore: Record<string, string>) {
  return {
    getVars: () => ({ envVars: { ...envStore }, globals: {} }),
    setEnv: (k: string, v: string) => {
      envStore[k] = v;
    },
    setGlobal: () => {},
  };
}

let calls: string[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('window', {
    location: { origin: 'http://localhost' },
    setTimeout: setTimeout as unknown,
    clearTimeout: clearTimeout as unknown,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('script dọn dẹp mức collection', () => {
  it('chạy MỘT LẦN sau cả danh sách request, không tính vào kết quả', async () => {
    const { runRequestList } = await import('../runner');
    const env: Record<string, string> = {};
    const col: Collection = {
      id: 'c1',
      name: 'Order',
      folders: [],
      rootRequestIds: ['r1', 'r2'],
      teardown: "pm.environment.set('cleaned', 'yes'); console.log('da xoa user test');",
    };
    const seen: string[] = [];
    const out = await runRequestList([req('r1', 'c1'), req('r2', 'c1')], makeHooks(env), {
      timeoutMs: 5000,
      delayMs: 0,
      stopOnError: false,
      collections: [col],
      onTeardown: (o) => seen.push(`${o.collectionName}:${o.error ?? 'ok'}`),
    });
    expect(out).toHaveLength(2); // 2 request — KHÔNG có dòng "teardown" lẫn vào
    expect(seen).toEqual(['Order:ok']);
    expect(env.cleaned).toBe('yes');
    // request thật chỉ gửi 2 lần, script dọn dẹp không tự gửi gì thêm
    expect(calls).toEqual(['https://api.test/r1', 'https://api.test/r2']);
  });

  it('data file: dọn dẹp sau MỖI vòng và đọc được dòng dữ liệu của vòng đó', async () => {
    const { runCollectionWithData } = await import('../runner');
    const env: Record<string, string> = {};
    const col: Collection = {
      id: 'c1',
      name: 'Order',
      folders: [],
      rootRequestIds: ['r1'],
      teardown: "pm.environment.set('lastRow', pm.iterationData.get('monId') + '|' + pm.variables.get('row'));",
    };
    const events: string[] = [];
    const iters = await runCollectionWithData(
      [req('r1', 'c1')],
      [{ monId: '12', row: 'A' }, { monId: '13', row: 'B' }],
      makeHooks(env),
      {
        timeoutMs: 5000,
        delayMs: 0,
        stopOnError: false,
        collections: [col],
        onTeardown: (o) => events.push(o.collectionName),
      },
    );
    expect(iters).toHaveLength(2);
    expect(events).toEqual(['Order', 'Order']); // 1 lần cho mỗi vòng
    expect(env.lastRow).toBe('13|B'); // vòng cuối ghi đè, dùng đúng dòng của vòng đó
    expect(calls).toEqual(['https://api.test/r1', 'https://api.test/r1']);
  });

  it('không có script dọn dẹp thì không gọi callback', async () => {
    const { runRequestList } = await import('../runner');
    let called = 0;
    const col: Collection = { id: 'c1', name: 'Order', folders: [], rootRequestIds: ['r1'] };
    const out = await runRequestList([req('r1', 'c1')], makeHooks({}), {
      timeoutMs: 5000,
      delayMs: 0,
      stopOnError: false,
      collections: [col],
      onTeardown: () => called++,
    });
    expect(out).toHaveLength(1);
    expect(called).toBe(0);
  });

  it('script lỗi → báo về onTeardown.error, các request trước đó vẫn giữ kết quả', async () => {
    const { runRequestList } = await import('../runner');
    const col: Collection = {
      id: 'c1',
      name: 'Order',
      folders: [],
      rootRequestIds: ['r1'],
      teardown: 'throw new Error("API xoa du lieu 500");',
    };
    let err = '';
    const out = await runRequestList([req('r1', 'c1')], makeHooks({}), {
      timeoutMs: 5000,
      delayMs: 0,
      stopOnError: false,
      collections: [col],
      onTeardown: (o) => {
        err = o.error ?? '';
      },
    });
    expect(out[0].ok).toBe(true);
    expect(err).toContain('API xoa du lieu 500');
  });

  it('Builder (1 request) không chạy script dọn dẹp — chỉ Runner/CLI', async () => {
    const { runOneRequest } = await import('../runner');
    const { scriptChainFor } = await import('../script-chain');
    const col: Collection = {
      id: 'c1',
      name: 'Order',
      folders: [],
      rootRequestIds: ['r1'],
      preRequest: "pm.environment.set('pre', '1');",
      teardown: "pm.environment.set('teardown', '1');",
    };
    const env: Record<string, string> = {};
    await runOneRequest(req('r1', 'c1'), makeHooks(env), 5000, undefined, undefined, [col]);
    expect(env.pre).toBe('1');
    expect(env.teardown).toBeUndefined();
    expect(scriptChainFor([col], req('r1', 'c1')).tests).toEqual([]);
  });

  it('collection chỉ có script dọn dẹp vẫn bị gate script lạ chặn khi CLI không cho phép', async () => {
    const { untrustedScriptRequests } = await import('../scripts');
    const r = { ...req('r1', 'c1'), origin: 'imported' as const };
    const col: Collection = {
      id: 'c1',
      name: 'Order',
      folders: [],
      rootRequestIds: ['r1'],
      teardown: 'pm.environment.set("x", "1");',
    };
    expect(untrustedScriptRequests([r])).toEqual([]); // không biết collection → không thấy script
    expect(untrustedScriptRequests([r], [col])).toHaveLength(1);
  });
});
