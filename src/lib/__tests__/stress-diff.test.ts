import { describe, expect, it } from 'vitest';
import { calculateStressReport, type StressRequestResult } from '../stress';
import { diffJson } from '../diff';

describe('Local Stress Testing Lib', () => {
  it('tính đúng KPI và các phân vị P50, P90, P95, P99', () => {
    const results: StressRequestResult[] = [
      { id: 1, ok: true, status: 200, timeMs: 50 },
      { id: 2, ok: true, status: 200, timeMs: 60 },
      { id: 3, ok: true, status: 200, timeMs: 70 },
      { id: 4, ok: true, status: 200, timeMs: 80 },
      { id: 5, ok: false, status: 500, timeMs: 200, error: 'Internal Server Error' },
    ];

    const report = calculateStressReport(results, 1000);
    expect(report.completed).toBe(5);
    expect(report.success).toBe(4);
    expect(report.failed).toBe(1);
    expect(report.errorRate).toBe(20); // 1/5 = 20%
    expect(report.avgTimeMs).toBe(92); // (50+60+70+80+200)/5 = 92
    expect(report.minTimeMs).toBe(50);
    expect(report.maxTimeMs).toBe(200);
    expect(report.statusCodes[200]).toBe(4);
    expect(report.statusCodes[500]).toBe(1);
    expect(report.errors['Internal Server Error']).toBe(1);
    expect(report.rps).toBe(5); // 5 reqs trong 1s
  });

  it('xử lý an toàn khi danh sách results rỗng', () => {
    const report = calculateStressReport([], 0);
    expect(report.completed).toBe(0);
    expect(report.rps).toBe(0);
    expect(report.errorRate).toBe(0);
  });
});

describe('diffJson Deep Structural Diff', () => {
  it('phát hiện đúng field được thêm, xoá và sửa', () => {
    const oldObj = { id: 1, name: 'Alice', role: 'user' };
    const newObj = { id: 1, name: 'Bob', age: 25 };

    const diffs = diffJson(oldObj, newObj);
    const paths = diffs.map((d) => ({ path: d.path, type: d.type }));

    expect(paths).toContainEqual({ path: 'name', type: 'modified' });
    expect(paths).toContainEqual({ path: 'role', type: 'removed' });
    expect(paths).toContainEqual({ path: 'age', type: 'added' });
  });

  it('phát hiện thay đổi kiểu dữ liệu (type_changed)', () => {
    const oldObj = { price: 100 };
    const newObj = { price: '100' };

    const diffs = diffJson(oldObj, newObj);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].type).toBe('type_changed');
    expect(diffs[0].oldType).toBe('number');
    expect(diffs[0].newType).toBe('string');
  });

  it('phát hiện phần tử array thay đổi', () => {
    const oldArr = ['apple', 'banana'];
    const newArr = ['apple', 'orange', 'grape'];

    const diffs = diffJson(oldArr, newArr);
    expect(diffs.some((d) => d.type === 'modified')).toBe(true);
    expect(diffs.some((d) => d.type === 'added')).toBe(true);
  });
});
