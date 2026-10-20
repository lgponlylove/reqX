import { describe, expect, it } from 'vitest';
import type { ApiResponse, Assertion } from '../../types/api';
import { runTests, type TestResult } from '../scripts';
import { scriptChainFor } from '../script-chain';
import { assertionCount, compileAssertions } from '../assertions';

const vs = { get: () => undefined, set: () => {} };
const ctx = { env: vs, globals: vs, merged: {} };

function res(partial: Partial<ApiResponse> = {}): ApiResponse {
  return {
    status: 200,
    statusText: 'OK',
    timeMs: 120,
    sizeBytes: 10,
    headers: { 'Content-Type': 'application/json', 'X-Total-Count': '42' },
    body: '{"data":{"user":{"id":"u-7","active":true,"score":9.5,"tags":["a","b"]},"items":[{"id":1},{"id":2}]}}',
    ...partial,
  };
}

function ax(p: Partial<Assertion> = {}): Assertion {
  return { id: 'x1', enabled: true, kind: 'status', target: '', op: 'equal', expected: '200', ...p };
}

/** Compile rồi chạy thật trong sandbox pm.test — chứng minh code sinh ra dùng được. */
async function run(list: Assertion[], response = res()) {
  const code = compileAssertions(list);
  expect(code, 'không được compile ra code rỗng').toBeTruthy();
  const out = await runTests(code, response, ctx);
  expect(out.error, `script lỗi: ${out.error}`).toBeUndefined();
  return out.results;
}

const failed = (r: TestResult[]) => r.filter((x) => !x.passed);

describe('compileAssertions → chạy qua runTests', () => {
  it('status: equal / in / lt / gt', async () => {
    expect(await run([ax({ expected: '200' })])).toEqual([{ name: 'Status code bằng "200"', passed: true }]);
    expect(failed(await run([ax({ expected: '201' })]))).toHaveLength(1);
    expect((await run([ax({ op: 'in', expected: '200, 201, 204' })]))[0].passed).toBe(true);
    expect((await run([ax({ op: 'in', expected: '404' })]))[0].passed).toBe(false);
    expect((await run([ax({ op: 'lt', expected: '300' })]))[0].passed).toBe(true);
    expect((await run([ax({ op: 'gt', expected: '300' })]))[0].passed).toBe(false);
  });

  it('responseTime lấy theo ms', async () => {
    expect((await run([ax({ kind: 'responseTime', op: 'lt', expected: '500' })]))[0].passed).toBe(true);
    expect((await run([ax({ kind: 'responseTime', op: 'lt', expected: '50' })]))[0].passed).toBe(false);
  });

  it('header: không phân biệt hoa thường, exists / equal / contains', async () => {
    expect((await run([ax({ kind: 'header', target: 'x-total-count', op: 'exists' })]))[0].passed).toBe(true);
    expect((await run([ax({ kind: 'header', target: 'X-TOTAL-COUNT', op: 'equal', expected: '42' })]))[0].passed).toBe(true);
    expect((await run([ax({ kind: 'header', target: 'content-type', op: 'contains', expected: 'json' })]))[0].passed).toBe(true);
    const missing = failed(await run([ax({ kind: 'header', target: 'x-khong-co', op: 'exists' })]));
    expect(missing[0].error).toContain('Thiếu header "x-khong-co"');
  });

  it('jsonField: dot-path, index mảng, thiếu path thì FAIL kèm lý do chứ không nổ script', async () => {
    expect((await run([ax({ kind: 'jsonField', target: 'data.user.id', op: 'equal', expected: 'u-7' })]))[0].passed).toBe(true);
    expect((await run([ax({ kind: 'jsonField', target: 'data.items.1.id', op: 'equal', expected: '2' })]))[0].passed).toBe(true);
    expect((await run([ax({ kind: 'jsonField', target: 'data.user.score', op: 'gt', expected: '9' })]))[0].passed).toBe(true);
    expect((await run([ax({ kind: 'jsonField', target: 'data.user.active', op: 'equal', expected: 'true' })]))[0].passed).toBe(true);
    expect((await run([ax({ kind: 'jsonField', target: 'data.user.tags', op: 'contains', expected: 'a' })]))[0].passed).toBe(true);
    expect((await run([ax({ kind: 'jsonField', target: 'data.user.tags', op: 'type', expected: 'array' })]))[0].passed).toBe(true);
    expect((await run([ax({ kind: 'jsonField', target: 'data.user.id', op: 'type', expected: 'string' })]))[0].passed).toBe(true);

    const bad = failed(await run([ax({ kind: 'jsonField', target: 'data.user.khongCo', op: 'exists' })]));
    expect(bad[0].passed).toBe(false);
    expect(bad[0].error).toContain('Thiếu JSON "data.user.khongCo"');
    // index ngoài phạm vi cũng phải báo thiếu, không được ném TypeError
    const oob = failed(await run([ax({ kind: 'jsonField', target: 'data.items.9.id', op: 'equal', expected: '1' })]));
    expect(oob[0].error).toContain('Không lấy được JSON "data.items.9.id"');
  });

  it('jsonField trên response không phải JSON: fail có diagnose, script không chết', async () => {
    const out = await run([ax({ kind: 'jsonField', target: 'a.b', op: 'exists' })], res({ body: '<html>oops</html>' }));
    expect(out[0].passed).toBe(false);
    expect(out[0].error).toContain('Response không phải JSON');
  });

  it('bodyText: contains / notContains / exists', async () => {
    expect((await run([ax({ kind: 'bodyText', op: 'contains', expected: '"active":true' })]))[0].passed).toBe(true);
    expect((await run([ax({ kind: 'bodyText', op: 'notContains', expected: 'password' })]))[0].passed).toBe(true);
    expect((await run([ax({ kind: 'bodyText', op: 'notContains', expected: 'user' })]))[0].passed).toBe(false);
    expect((await run([ax({ kind: 'bodyText', op: 'exists' })]))[0].passed).toBe(true);
  });

  it('giá trị user gõ chỉ là dữ liệu, không bao giờ chạy thành code', async () => {
    const evil = ax({ kind: 'jsonField', target: 'data.user.id', op: 'equal', expected: 'x"); pm.test("INJECTED", ()=>{}); (' });
    const out = await run([evil]);
    // chuỗi payload chỉ XUẤT HIỆN trong tên/lời báo (vô hại); điều quan trọng là không có test thứ hai
    expect(out).toHaveLength(1);
    expect(out.map((r) => r.name)).not.toContain('INJECTED');
    expect(out[0].passed).toBe(false);
    expect(out[0].error).toContain('mong đợi');
    // không có biến toàn cục nào lọt ra ngoài sandbox
    expect((globalThis as Record<string, unknown>).__ax).toBeUndefined();
  });

  it('dòng tắt / bảng rỗng không sinh code', () => {
    expect(compileAssertions([ax({ enabled: false })])).toBe('');
    expect(compileAssertions([])).toBe('');
    expect(compileAssertions(undefined)).toBe('');
    expect(assertionCount([ax(), ax({ id: 'x2', enabled: false })])).toBe(1);
  });

  it('nhiều dòng = nhiều pm.test, mỗi dòng báo lỗi riêng', async () => {
    const out = await run([
      ax({ id: 'a', expected: '200' }),
      ax({ id: 'b', kind: 'jsonField', target: 'data.user.id', op: 'equal', expected: 'sai' }),
      ax({ id: 'c', kind: 'responseTime', op: 'lt', expected: '500' }),
    ]);
    expect(out).toHaveLength(3);
    expect(out.filter((r) => !r.passed).map((r) => r.name)).toEqual(['JSON "data.user.id" bằng "sai"']);
  });

  it('nối vào chuỗi kế thừa: request có bảng điều kiện thì tests chain có thêm script', () => {
    const req = {
      id: 'r1', name: 'R', method: 'GET', url: 'u', params: [], headers: [], bodyType: 'none', body: '',
      auth: { type: 'none' }, tests: 'pm.test("script tay", () => {});', assertions: [ax()],
      updatedAt: 0,
    } as never;
    const chain = scriptChainFor([], req as never);
    expect(chain.tests).toHaveLength(2);
    expect(chain.tests[1]).toContain('__ax.check("status"');
  });

  it('notEqual và notExists hoạt động chính xác trong sandbox', async () => {
    const out = await run([
      ax({ id: '1', kind: 'status', op: 'notEqual', expected: '500' }),
      ax({ id: '2', kind: 'jsonField', target: 'data.user.nonExistentField', op: 'notExists' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].passed).toBe(true);
    expect(out[1].passed).toBe(true);
  });

  it('thất bại khi notEqual gặp giá trị bằng, hoặc notExists gặp giá trị tồn tại', async () => {
    const out = await run([
      ax({ id: '1', kind: 'status', op: 'notEqual', expected: '200' }),
      ax({ id: '2', kind: 'jsonField', target: 'data.user.id', op: 'notExists' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].passed).toBe(false);
    expect(out[1].passed).toBe(false);
  });
});
