import { describe, expect, it } from 'vitest';
import type { ApiRequest, Collection, Dir, Folder } from '../../types/api';
import { DEFAULT_REQUEST } from '../../types/api';
import { buildTreeFilter, requestHits, UNFILED_KEY } from '../tree-filter';

function req(id: string, patch: Partial<ApiRequest> = {}): ApiRequest {
  return { ...DEFAULT_REQUEST, id, updatedAt: 0, ...patch } as ApiRequest;
}
function folder(id: string, name: string, requestIds: string[], folderIds: string[] = []): Folder {
  return { id, name, requestIds, folderIds };
}
function col(id: string, name: string, folders: Folder[], rootRequestIds: string[] = []): Collection {
  return { id, name, folders, rootRequestIds };
}

/**
 * Fixture:
 *  Auth (collection) — r1 "Login" (POST /auth/login), f1 "Tokens" (r2 "Refresh token" GET)
 *    -> f2 "PAT" nested trong f1 (r3 "Create PAT" POST /pats)
 *  Orders — f3 "Cart" (r4 "Add item" POST /cart/items)
 */
const tree: Collection[] = [
  col('A', 'Auth', [folder('f1', 'Tokens', ['r2'], ['f2']), folder('f2', 'PAT', ['r3'])], ['r1']),
  col('O', 'Orders', [folder('f3', 'Cart', ['r4'])]),
];
const requests: Record<string, ApiRequest> = {
  r1: req('r1', { name: 'Login', method: 'POST', url: 'https://api.test/auth/login' }),
  r2: req('r2', { name: 'Refresh token', method: 'GET', url: 'https://api.test/token/refresh' }),
  r3: req('r3', { name: 'Create PAT', method: 'POST', url: 'https://api.test/pats' }),
  r4: req('r4', { name: 'Add item', method: 'POST', url: 'https://api.test/cart/items' }),
};
const dirs: Dir[] = [{ id: 'd1', name: 'QA', collectionIds: ['A'], parentId: null }];

describe('requestHits — breadth của bộ lọc', () => {
  it('khớp tên, URL và method (query đã lowercase ở buildTreeFilter)', () => {
    expect(requestHits(requests.r1, 'log')).toBe(true);
    expect(requestHits(requests.r1, '/auth/login')).toBe(true);
    expect(requestHits(requests.r3, 'pats')).toBe(true);
    expect(requestHits(requests.r2, 'get')).toBe(true);
    expect(requestHits(requests.r2, 'delete')).toBe(false);
  });
  it('request không tồn tại không làm hỏng phép so sánh', () => {
    expect(requestHits(undefined, 'any')).toBe(false);
  });
});

describe('buildTreeFilter', () => {
  it('rỗng = không lọc, vẫn đếm đủ tổng request', () => {
    const f = buildTreeFilter(tree, requests, dirs, '   ');
    expect(f.active).toBe(false);
    expect(f.totalReqs).toBe(4);
    expect(f.colVisible.size).toBe(0);
  });

  it('khớp tên request → chỉ hiện dòng đó + cha của nó, node khác ẩn hết', () => {
    const f = buildTreeFilter(tree, requests, dirs, 'create pat');
    expect(f.colVisible.has('A')).toBe(true);
    expect(f.colVisible.has('O')).toBe(false);
    expect(f.fldVisible.has('f1')).toBe(true);
    expect(f.fldVisible.has('f2')).toBe(true);
    expect(f.reqVisible.has('r3')).toBe(true);
    expect(f.reqVisible.has('r2')).toBe(false);
    expect(f.reqVisible.has('r1')).toBe(false);
    expect(f.shownReqs).toBe(1);
    expect(f.dirVisible.has('d1')).toBe(true);
  });

  it('khớp một phần URL', () => {
    const f = buildTreeFilter(tree, requests, dirs, 'cart/items');
    expect([...f.reqVisible]).toEqual(['r4']);
    expect(f.fldVisible.has('f3')).toBe(true);
    expect(f.colVisible.has('A')).toBe(false);
  });

  it('khớp method → mọi request mang method đó, kèm folder/collection cha', () => {
    const f = buildTreeFilter(tree, requests, dirs, 'get');
    expect([...f.reqVisible]).toEqual(['r2']);
    expect(f.colVisible.has('O')).toBe(false);
  });

  it('khớp tên folder → nguyên subtree trong folder hiện, không cần request khớp', () => {
    const f = buildTreeFilter(tree, requests, dirs, 'tokens');
    expect(f.fldVisible.has('f1')).toBe(true);
    expect(f.fldVisible.has('f2')).toBe(true);
    expect(f.reqVisible.has('r2')).toBe(true);
    expect(f.reqVisible.has('r3')).toBe(true);
    expect(f.reqVisible.has('r1')).toBe(false);
    expect(f.shownReqs).toBe(2);
  });

  it('khớp tên collection → cả cây hiện', () => {
    const f = buildTreeFilter(tree, requests, dirs, 'auth');
    expect(f.reqVisible.size).toBe(3);
    expect(f.fldVisible.size).toBe(2);
    expect(f.colVisible.has('O')).toBe(false);
  });

  it('khớp request nằm ở root của collection chưa sắp xếp → đánh dấu nhóm unfiled', () => {
    const f = buildTreeFilter(tree, requests, dirs, 'add item');
    expect(f.dirVisible.has(UNFILED_KEY)).toBe(true);
    expect(f.dirVisible.has('d1')).toBe(false);
  });

  it('thư mục cha hiện khi kết quả nằm ở thư mục con lồng bên trong', () => {
    const nested: Dir[] = [
      { id: 'p', name: 'Cha', collectionIds: [], parentId: null },
      { id: 'c', name: 'Con', collectionIds: ['O'], parentId: 'p' },
    ];
    const f = buildTreeFilter(tree, requests, nested, 'add item');
    expect(f.dirVisible.has('c')).toBe(true);
    expect(f.dirVisible.has('p')).toBe(true);
  });

  it('không có gì khớp → cây ẩn hết, bộ đếm về 0', () => {
    const f = buildTreeFilter(tree, requests, dirs, 'zzz-khong-co');
    expect(f.colVisible.size).toBe(0);
    expect(f.shownReqs).toBe(0);
    expect(f.totalReqs).toBe(4);
  });

  it('dữ liệu hỏng có vòng lặp cha↔con không làm treo bộ lọc', () => {
    const looped: Collection[] = [
      col('L', 'Loop', [folder('x', 'X', ['r9'], ['y']), folder('y', 'Y', [], ['x'])]),
    ];
    const f = buildTreeFilter(looped, { ...requests, r9: req('r9', { name: 'Nine' }) }, [], 'nine');
    expect(f.colVisible.has('L')).toBe(true);
    expect(f.shownReqs).toBe(0);
  });
});
