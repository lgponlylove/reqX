import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { parseDataFile, parseDataFileAsync, rowSummary } from '../datafile';
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
    expect(parseDataFile('a', 'a.txt').error).toMatch(/\.csv, \.json hoặc \.xlsx/);
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

  it('1 object đơn → bọc thành 1 dòng', () => {
    const r = parseDataFile('{"monId":"12"}', 'm.json');
    expect(r.error).toBeUndefined();
    expect(r.rows).toEqual([{ monId: '12' }]);
  });
});

describe('parseDataFileAsync XLSX', () => {
  it('đọc file xlsx và trả về đúng rows và columns', async () => {
    const zip = new JSZip();
    zip.file(
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheets>
          <sheet name="TestData" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
        </sheets>
      </workbook>`
    );
    zip.file(
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      </Relationships>`
    );
    zip.file(
      'xl/worksheets/sheet1.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1">
            <c r="A1"><is><t>username</t></is></c>
            <c r="B1"><is><t>password</t></is></c>
          </row>
          <row r="2">
            <c r="A2"><is><t>admin</t></is></c>
            <c r="B2"><is><t>secret123</t></is></c>
          </row>
        </sheetData>
      </worksheet>`
    );

    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const res = await parseDataFileAsync(buffer, 'test.xlsx');
    expect(res.error).toBeUndefined();
    expect(res.columns).toEqual(['username', 'password']);
    expect(res.rows).toEqual([{ username: 'admin', password: 'secret123' }]);
    expect(res.sheets).toEqual(['TestData']);
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
