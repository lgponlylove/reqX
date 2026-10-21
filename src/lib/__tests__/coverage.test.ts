import { describe, expect, it } from 'vitest';
import type { ApiRequest, Collection } from '../../types/api';
import { DEFAULT_REQUEST } from '../../types/api';
import { coverageCsv, coverageTone, measureCoverage, type CoverageRun } from '../coverage';

function req(id: string, name: string, patch: Partial<ApiRequest> = {}): ApiRequest {
  return {
    ...DEFAULT_REQUEST,
    id,
    name,
    updatedAt: 0,
    ...patch,
  } as ApiRequest;
}

/**
 * Fixture 3 collection:
 *  A: 2 request root — 1 có test riêng, 1 không có gì
 *  B: collection có tests kế thừa; 1 folder chứa 2 request (0 test riêng) + 1 request root không test
 *  C: rỗng (0 request) để chắc không chia 0
 */
const colA: Collection = {
  id: 'A',
  name: 'Auth',
  folders: [],
  rootRequestIds: ['a1', 'a2'],
};
const colB: Collection = {
  id: 'B',
  name: 'Orders',
  tests: "pm.test('200', () => pm.response.to.have.status(200));",
  folders: [{ id: 'f1', name: 'Cart', requestIds: ['b1', 'b2'], folderIds: [] }],
  rootRequestIds: ['b3'],
};
const colC: Collection = { id: 'C', name: 'Empty', folders: [], rootRequestIds: [] };

const requests: Record<string, ApiRequest> = {
  a1: req('a1', 'Login', { tests: "pm.test('ok', ()=>{});" }),
  a2: req('a2', 'Logout'),
  b1: req('b1', 'Add item'),
  b2: req('b2', 'Remove item'),
  b3: req('b3', 'List orders'),
};

const runs: CoverageRun[] = [
  // lần chạy cũ: Add item FAIL
  { kind: 'collection', refId: 'B:f1', at: 1000, steps: [{ name: 'Add item', ok: false }, { name: 'Remove item', ok: true }] },
  // lần chạy mới hơn: Add item PASS → lấy lần này
  { kind: 'collection', refId: 'B:f1', at: 2000, steps: [{ name: 'Add item', ok: true }] },
  // Login chưa từng chạy bằng Runner nhưng từng gửi ở Builder (history)
];

const history = [{ request: { id: 'a1', name: 'Login' } }];

describe('measureCoverage', () => {
  const res = measureCoverage([colA, colB, colC], requests, runs, history);
  const row = (id: string) => res.rows.find((r) => r.id === id)!;

  it('đếm đúng collection có request', () => {
    expect(res.rows.map((r) => r.id)).toEqual(['A', 'B', 'B/f1', 'C']);
    expect(row('A').total).toBe(2);
    expect(row('B').total).toBe(3);
    expect(row('B/f1').total).toBe(2);
    expect(row('C').total).toBe(0);
    expect(row('C').pct).toBe(0);
  });

  it('phân biệt test riêng và test nhờ kế thừa', () => {
    expect(row('A').ownTests).toBe(1);
    expect(row('A').inheritedOnly).toBe(0);
    // b1/b2/b3 đều không có tests riêng nhưng collection B có → inheritance
    expect(row('B').ownTests).toBe(0);
    expect(row('B').inheritedOnly).toBe(3);
    expect(row('B').withTests).toBe(3);
    expect(row('B').pct).toBe(100);
  });

  it('% độ phủ chỉ tính test, không tính chuyện đã chạy', () => {
    expect(row('A').pct).toBe(50);
    expect(coverageTone(50)).toBe('warn');
    expect(coverageTone(80)).toBe('good');
    expect(coverageTone(0)).toBe('empty');
    expect(coverageTone(10)).toBe('bad');
  });

  it('request chưa từng chạy = không có ở run nào và không có trong history', () => {
    // a1 có trong history, a2 không ở đâu cả
    expect(row('A').neverRun).toBe(1);
    // f1: cả 2 request đều xuất hiện ở run at=1000/2000
    expect(row('B/f1').neverRun).toBe(0);
    // b3 không ever chạy
    expect(row('B').neverRun).toBe(1);
  });

  it('fail tính theo LẦN CHẠY GẦN NHẤT có mặt request', () => {
    expect(row('B/f1').lastFailed).toBe(0);
    expect(row('B').lastFailed).toBe(0);
    // nếu chỉ còn run cũ thì 'Add item' phải bị tính fail
    const onlyOld = measureCoverage([colB], requests, [runs[0]], []);
    expect(onlyOld.rows.find((r) => r.id === 'B/f1')!.lastFailed).toBe(1);
  });

  it('tổng hợp bằng tổng các collection, không cộng trùng folder', () => {
    expect(res.summary.total).toBe(5);
    expect(res.summary.withTests).toBe(4);
    expect(res.summary.ownTests).toBe(1);
    expect(res.summary.neverRun).toBe(2);
    expect(res.summary.collections).toBe(3);
    expect(res.summary.pct).toBe(80);
  });

  it('CSV có BOM, đủ cột và thoát dấu phẩy trong tên', () => {
    const csv = coverageCsv(measureCoverage([{ ...colA, name: 'Auth, Prod' }], requests, [], []));
    expect(csv.charCodeAt(0), 'BOM').toBe(0xfeff);
    expect(csv).toContain('"Auth, Prod"');
    expect(csv.split('\r\n')[0]).toContain('Độ phủ %');
  });
});
