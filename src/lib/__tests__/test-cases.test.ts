import { describe, it, expect } from 'vitest';
import type { ApiRequest } from '../../types/api';
import {
  applyCase, casesToCsv, collectTargets, generateCases, judge, maskCurl,
  statusMatches, NULL_VALUE, OMIT_VALUE, type TestCase,
} from '../../lib/test-cases';

const BODY = JSON.stringify({
  receiptdocumentid: 1234,
  invoiceno: '1234ABC',
  invoicesymbol: 'IOa8',
  invoicepattern: 'INVOICEPATTERN',
  totaldiscount: 6.5,
  totalamount: 1000000.9,
  invoicedate: '2026-06-12T10:30:00',
  action: 1,
});

function req(patch: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'req1', name: 'validate-document-amount', method: 'POST',
    url: 'https://apiinbound.shome.vn/cobra-service-wms-bus/api/inbound-receipts/documents/validate-document-amount',
    params: [], headers: [{ id: 'h1', key: 'Content-Type', value: 'application/json', enabled: true }],
    bodyType: 'json', body: BODY, auth: { type: 'bearer', token: '5694a9fa-466b' },
    updatedAt: 0, ...patch,
  };
}

const tc = (data: Record<string, string>, expectStatus = '4xx'): TestCase =>
  ({ id: 'tc1', name: 'x', group: 'missing', data, expect: { status: expectStatus } });

describe('collectTargets', () => {
  it('lấy ra từng lá của body JSON kèm kiểu', () => {
    const keys = collectTargets(req()).map((t) => t.key);
    expect(keys).toContain('receiptdocumentid');
    expect(keys).toContain('invoicedate');
    expect(keys).toContain('action');
    const amount = collectTargets(req()).find((t) => t.key === 'totalamount');
    expect(amount?.type).toBe('number');
  });

  it('bỏ qua header Authorization/Cookie/Content-Type để nhóm bảo mật tự thêm', () => {
    const r = req({ headers: [
      { id: 'a', key: 'Authorization', value: 'Bearer x', enabled: true },
      { id: 'b', key: 'Cookie', value: 'JSESSIONID=1', enabled: true },
      { id: 'c', key: 'X-Tenant', value: 'SHOME', enabled: true },
    ] });
    const keys = collectTargets(r).map((t) => t.key);
    expect(keys).toContain('header:X-Tenant');
    expect(keys.filter((k) => k.startsWith('header:'))).toEqual(['header:X-Tenant']);
  });
});

describe('generateCases', () => {
  // cap rộng để kiểm đủ các nhóm; mặc định thật của app vẫn là 40
  const cases = generateCases(req(), 120);

  it('case đầu luôn là baseline hợp lệ, mong đợi 2xx', () => {
    expect(cases[0].group).toBe('valid');
    expect(cases[0].data).toEqual({});
    expect(cases[0].expect.status).toBe('2xx');
  });

  it('sinh đủ nhóm cực đoan cho field chuỗi', () => {
    const names = cases.map((c) => c.name);
    expect(names).toContain('Thiếu invoiceno');
    expect(names).toContain('Bỏ trống invoiceno');
    expect(names.some((n) => n.includes('Ký tự Việt') && n.includes('invoiceno'))).toBe(true);
    expect(names.some((n) => n.includes('301 ký tự'))).toBe(true);
  });

  it('field ngày có sai định dạng thay vì sai kiểu số', () => {
    const dateCases = cases.filter((c) => c.name.includes('invoicedate'));
    expect(dateCases.some((c) => c.data.invoicedate === '2026-13-45T00:00:00')).toBe(true);
    expect(dateCases.some((c) => c.data.invoicedate === '31/12/2026 25:99')).toBe(true);
    expect(dateCases.some((c) => c.data.invoicedate === '123abc')).toBe(false);
  });

  it('field số sinh số âm / 0 / rất lớn / sai kiểu', () => {
    const amount = cases.filter((c) => c.data.totalamount !== undefined);
    expect(amount.map((c) => c.data.totalamount)).toContain('-1');
    expect(amount.map((c) => c.data.totalamount)).toContain('0');
    expect(amount.map((c) => c.data.totalamount)).toContain('99999999999999');
    expect(amount.map((c) => c.data.totalamount)).toContain('abc');
  });

  it('quét giá trị field action', () => {
    const actions = cases.filter((c) => c.group === 'enum').map((c) => c.data.action);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions).not.toContain('1'); // giá trị gốc đã có ở baseline
  });

  it('có case token sai + mất Authorization khi auth bearer', () => {
    const sec = cases.filter((c) => c.data['header:Authorization'] !== undefined);
    expect(sec.length).toBe(2);
    expect(sec.every((c) => c.expect.status === '401')).toBe(true);
  });

  it('tôn trọng max_cases', () => {
    expect(generateCases(req(), 8).length).toBeLessThanOrEqual(8);
  });

  it('body không phải JSON thì vẫn sinh case cho header/query', () => {
    const r = req({ body: 'plain text', bodyType: 'raw', params: [{ id: 'p', key: 'q', value: '1', enabled: true }] });
    const list = generateCases(r, 20);
    expect(list.some((c) => c.data['query:q'] !== undefined)).toBe(true);
  });
});

describe('applyCase', () => {
  it('giữ request gốc, ghi đè number đúng kiểu', () => {
    const base = req();
    const out = applyCase(base, tc({ totalamount: '250', receiptdocumentid: '99' }, '2xx'));
    const parsed = JSON.parse(out.body);
    expect(parsed.totalamount).toBe(250);
    expect(parsed.receiptdocumentid).toBe(99);
    expect(JSON.parse(base.body).totalamount).toBe(1000000.9); // gốc không bị sửa
  });

  it('OMIT xóa hẳn key, NULL_VALUE ghi null', () => {
    const a = JSON.parse(applyCase(req(), tc({ invoiceno: OMIT_VALUE })).body);
    expect('invoiceno' in a).toBe(false);
    const b = JSON.parse(applyCase(req(), tc({ invoiceno: NULL_VALUE })).body);
    expect(b.invoiceno).toBeNull();
  });

  it('giữ nguyên chuỗi khi kiểu gốc là string (đó là case sai kiểu)', () => {
    const a = JSON.parse(applyCase(req(), tc({ totalamount: 'abc' })).body);
    expect(a.totalamount).toBe('abc');
  });

  it('sửa / thêm / xóa header theo key "header:Name"', () => {
    const upd = applyCase(req(), tc({ 'header:Content-Type': 'text/plain' }));
    expect(upd.headers.find((h) => h.key === 'Content-Type')?.value).toBe('text/plain');
    const added = applyCase(req(), tc({ 'header:X-Trace': 'abc' }));
    expect(added.headers.find((h) => h.key === 'X-Trace')?.value).toBe('abc');
    const removed = applyCase(req(), tc({ 'header:Authorization': OMIT_VALUE }));
    expect(removed.headers.some((h) => h.key.toLowerCase() === 'authorization')).toBe(false);
  });

  it('tên không có trong body rơi xuống query param', () => {
    const out = applyCase(req(), tc({ tenant: 'SHOME' }));
    expect(out.params.find((p) => p.key === 'tenant')?.value).toBe('SHOME');
  });

  it('đổi URL qua key "url"', () => {
    expect(applyCase(req(), tc({ url: 'https://other/x' })).url).toBe('https://other/x');
  });
});

describe('nhóm null/rỗng', () => {
  const list = generateCases(req(), 200);

  it('mọi field body đều có bộ ba: thiếu / null / trống', () => {
    for (const key of ['invoiceno', 'totalamount', 'receiptdocumentid', 'action']) {
      const byKey = list.filter((c) => key in c.data);
      expect(byKey.some((c) => c.data[key] === OMIT_VALUE)).toBe(true);
      expect(byKey.some((c) => c.data[key] === NULL_VALUE)).toBe(true);
      expect(byKey.some((c) => c.data[key] === '')).toBe(true);
    }
  });

  it('field nghi bắt buộc mong đợi 4xx, field optional mong đợi any', () => {
    const r = req({ body: JSON.stringify({ invoiceno: 'A', remark: 'x' }) });
    const l = generateCases(r, 100);
    expect(l.find((c) => c.name === 'Bỏ trống invoiceno')?.expect.status).toBe('4xx');
    expect(l.find((c) => c.name === 'null cho invoiceno')?.expect.status).toBe('4xx');
    expect(l.find((c) => c.name === 'Thiếu remark')?.expect.status).toBe('any');
    expect(l.find((c) => c.name === 'null cho remark')?.expect.status).toBe('any');
  });

  it('chỉ field bắt buộc mới có case chỉ-toàn-khoảng-trắng', () => {
    const r = req({ body: JSON.stringify({ invoiceno: 'A', remark: 'x' }) });
    const l = generateCases(r, 100);
    expect(l.some((c) => c.name === 'Chỉ khoảng trắng invoiceno')).toBe(true);
    expect(l.some((c) => c.name === 'Chỉ khoảng trắng remark')).toBe(false);
  });

  it('mảng/object lồng nhau có mảng rỗng, object rỗng, mảng chứa null', () => {
    const r = req({ body: JSON.stringify({ lines: [{ id: 1, qty: 2 }], meta: { source: 'WMS' } }) });
    const l = generateCases(r, 200);
    expect(l.find((c) => c.name === 'Mảng rỗng lines')?.data.lines).toBe('[]');
    expect(l.find((c) => c.name === 'Mảng chứa null lines')?.data.lines).toBe('[null]');
    expect(l.find((c) => c.name === 'Object rỗng meta')?.data.meta).toBe('{}');
    expect(l.some((c) => c.name === 'Object rỗng lines.0')).toBe(true);
  });

  it('có 2 case mức toàn body: body = {} và bỏ hẳn body', () => {
    const whole = list.filter((c) => 'body' in c.data).map((c) => c.data.body);
    expect(whole).toEqual(['{}', OMIT_VALUE]);
  });

  it('case null/rỗng xếp trước các nhóm khác trong danh sách của một field', () => {
    const perField = list.filter((c) => 'invoicedate' in c.data).slice(0, 3).map((c) => c.group);
    expect(perField).toEqual(['missing', 'null', 'boundary']);
  });
});

describe('applyCase null/rỗng', () => {
  it('key "body" thay cả body, "<<xóa field>>" bỏ hẳn body', () => {
    expect(JSON.parse(applyCase(req(), tc({ body: '{}' })).body)).toEqual({});
    expect(applyCase(req(), tc({ body: OMIT_VALUE })).body).toBe('');
  });

  it('mảng/object ghi đè giữ đúng kiểu JSON, không thành chuỗi', () => {
    const r = req({ body: JSON.stringify({ lines: [{ id: 1 }], meta: { a: 1 } }) });
    const out = JSON.parse(applyCase(r, tc({ lines: '[]', meta: '{}' })).body);
    expect(out.lines).toEqual([]);
    expect(out.meta).toEqual({});
  });

  it('chuỗi rỗng trên field số ghi thành "" (không bị ép về 0)', () => {
    const out = JSON.parse(applyCase(req(), tc({ totalamount: '' })).body);
    expect(out.totalamount).toBe('');
  });
});

describe('statusMatches', () => {
  it('hiểu 2xx / 4xx / any / mã cụ thể / so sánh', () => {
    expect(statusMatches('2xx', 204)).toBe(true);
    expect(statusMatches('4xx', 200)).toBe(false);
    expect(statusMatches('any', 500)).toBe(true);
    expect(statusMatches('', 500)).toBe(true);
    expect(statusMatches('401', 401)).toBe(true);
    expect(statusMatches('!=200', 200)).toBe(false);
    expect(statusMatches('>=400', 404)).toBe(true);
    expect(statusMatches('<400', 500)).toBe(false);
  });
});

describe('judge', () => {
  const ok = (over: Partial<TestCase> = {}): TestCase =>
    ({ ...tc({ invoiceno: '' }, '4xx'), ...over });
  const res = { ok: false, status: 400, testsPassed: 0, testsTotal: 0, response: { body: '{"code":"AMOUNT_INVALID"}' } };

  it('pass khi status khớp mong đợi', () => {
    expect(judge(ok(), res).pass).toBe(true);
  });
  it('fail khi status khác mong đợi, nêu rõ lý do', () => {
    const v = judge(ok({ expect: { status: '2xx' } }), res);
    expect(v.pass).toBe(false);
    expect(v.why).toContain('Mong đợi 2xx');
  });
  it('fail khi body thiếu chuỗi mong đợi', () => {
    const v = judge(ok({ expect: { status: '4xx', contains: 'NOT_HERE' } }), res);
    expect(v.pass).toBe(false);
    expect(v.why).toContain('body không chứa');
  });
  it('fail khi pm.test fail dù status khớp', () => {
    const v = judge(ok(), { ...res, testsPassed: 1, testsTotal: 2, error: 'code phải bằng 0: fail' });
    expect(v.pass).toBe(false);
    expect(v.why).toContain('pm.test fail 1/2');
  });
});

describe('maskCurl', () => {
  it('che bearer token, cookie và Authorization header', () => {
    const curl = `curl -X POST 'https://x/y' -H 'Authorization: Bearer 5694a9fa-466b-4f31' -H 'Cookie: JSESSIONID=1E37111194ACE2C1'`;
    const m = maskCurl(curl);
    expect(m).not.toContain('5694a9fa-466b-4f31');
    expect(m).not.toContain('1E37111194ACE2C1');
    expect(m).toContain('Authorization: ***');
  });
});

describe('casesToCsv', () => {
  it('mở đầu bằng BOM để Excel đọc đúng tiếng Việt, có tiêu đề cột', () => {
    const cases = generateCases(req(), 12);
    const csv = casesToCsv(req(), cases, {});
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Ten case');
    expect(csv.split('\n').length).toBeGreaterThan(cases.length + 3);
  });

  it('1 dòng = 1 case, field chứa phẩy/nháy được bọc nháy kép', () => {
    const list = [tc({ invoiceno: 'a,b' })];
    list[0].name = 'Thiếu "invoiceno"';
    const csv = casesToCsv(req(), list, {});
    expect(csv).toContain('"Thiếu ""invoiceno"""');
    expect(csv).toContain('"invoiceno=a,b"');
  });
});
