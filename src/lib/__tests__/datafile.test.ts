import { describe, expect, it, vi } from 'vitest';
import { parseDataFile, rowSummary } from '../datafile';
import { runTests } from '../scripts';
import type { ApiRequest } from '../../types/api';

describe('parseDataFile CSV', () => {
  it('parse cơ bản + trim', () => {
    const r = parseDataFile('monId,tenMon\n12,Pho Bo\n13, Bun Cha \n', 'menu.csv');
    expect(r.error).toBeUndefined();
    expect(r.columns).toEqual(['monId', 'tenMon']);
    expect(r.rows).toEqual([
      { monId: '12', tenMon: 'Pho Bo' },
      { monId: '13', tenMon: 'Bun Cha' },
    ]);
  });

  it('chịu dấu phẩy trong ngoặc kép + "" escape', () => {
    const r = parseDataFile('a,b\n"x, y","p""q"\n', 't.csv');
    expect(r.rows).toEqual([{ a: 'x, y', b: 'p"q' }]);
  });

  it('báo lỗi file trống / thiếu dòng data / đuôi lạ', () => {
    expect(parseDataFile('', 'a.csv').error).toMatch(/trống/);
    expect(parseDataFile('a,b\n', 'a.csv').error).toMatch(/ít nhất 2 dòng/);
    expect(parseDataFile('a', 'a.txt').error).toMatch(/\.csv hoặc \.json/);
  });
});

describe('parseDataFile JSON', () => {
  it('mảng object, số giữ nguyên dạng chuỗi', () => {
    const r = parseDataFile('[{"monId":12,"gia":45000},{"monId":"13"}]', 'm.json');
    expect(r.error).toBeUndefined();
    expect(r.columns).toEqual(['monId', 'gia']);
    expect(r.rows).toEqual([
      { monId: '12', gia: '45000' },
      { monId: '13', gia: '' },
    ]);
  });

  it('báo lỗi sai cú pháp / không phải mảng object', () => {
    expect(parseDataFile('{oops', 'm.json').error).toMatch(/cú pháp/);
    expect(parseDataFile('[1,2]', 'm.json').error).toMatch(/không phải object/);
    expect(parseDataFile('[]', 'm.json').error).toMatch(/mảng các object/);
  });
});

describe('rowSummary', () => {
  it('tối đa 2 cột + đếm thừa', () => {
    expect(rowSummary({ a: '1', b: '2', c: '3' }, ['a', 'b', 'c'])).toBe('a=1 b=2 +1');
  });
});

describe('pm.iterationData', () => {
  it('get + toObject đọc dòng hiện tại', async () => {
    const store: Record<string, string> = {};
    const vs = { get: (k: string) => store[k], set: (k: string, v: string) => { store[k] = v; } };
    const out = await runTests(
      `pm.test('đọc data', () => {
         pm.expect(pm.iterationData.get('monId')).to.equal('12');
         pm.expect(pm.iterationData.toObject().tenMon).to.equal('Pho Bo');
       });`,
      { status: 200, statusText: 'OK', timeMs: 1, sizeBytes: 2, headers: {}, body: '{}' },
      { env: vs, globals: vs, merged: {}, data: { monId: '12', tenMon: 'Pho Bo' } },
    );
    expect(out.results).toEqual([{ name: 'đọc data', passed: true }]);
  });

  it('không có data → get ra undefined', async () => {
    const store: Record<string, string> = {};
    const vs = { get: (k: string) => store[k], set: (k: string, v: string) => { store[k] = v; } };
    const out = await runTests(
      `pm.test('trống', () => {
         pm.expect(pm.iterationData.get('x')).to.be.undefined;
       });`,
      { status: 200, statusText: 'OK', timeMs: 1, sizeBytes: 2, headers: {}, body: '{}' },
      { env: vs, globals: vs, merged: {} },
    );
    expect(out.results[0].passed).toBe(true);
  });
});

describe('data thắng env khi resolve', () => {
  it('URL dùng giá trị dòng data, không phải env', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost' },
      setTimeout: setTimeout as unknown,
      clearTimeout: clearTimeout as unknown,
    });
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(url);
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const { runCollectionWithData } = await import('../runner');
    const envStore: Record<string, string> = { monId: 'env-1' };
    const hooks = {
      getVars: () => ({ envVars: { ...envStore }, globals: {} }),
      setEnv: (k: string, v: string) => { envStore[k] = v; },
      setGlobal: () => {},
    };
    const req: ApiRequest = {
      id: 'r1', name: 'Mon', method: 'GET', url: 'https://api.test/mon/{{monId}}',
      params: [], headers: [], bodyType: 'none', body: '',
      auth: { type: 'none' }, preRequest: '', tests: '', updatedAt: 1,
    };
    const iters = await runCollectionWithData(
      [req],
      [{ monId: '12' }, { monId: '13' }],
      hooks,
      { timeoutMs: 5000, delayMs: 0, stopOnError: false },
    );
    expect(iters).toHaveLength(2);
    expect(iters.every((x) => x.ok)).toBe(true);
    expect(seen).toEqual([
      'https://api.test/mon/12',
      'https://api.test/mon/13',
    ]);
    vi.unstubAllGlobals();
  });
});
