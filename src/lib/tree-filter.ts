import type { ApiRequest, Collection, Dir, Folder } from '../types/api';

/** Kết quả lọc cây collection ở sidebar — tính 1 lần, mỗi node chỉ hỏi "mình có được hiện không". */
export interface TreeFilter {
  /** câu lọc đã cắt khoảng trắng thừa + lowercase */
  q: string;
  active: boolean;
  colVisible: Set<string>;
  fldVisible: Set<string>;
  reqVisible: Set<string>;
  /** id thư mục còn chứa kết quả (kèm khoá 'unfiled' cho nhóm chưa sắp xếp) */
  dirVisible: Set<string>;
  totalReqs: number;
  /** số dòng request hiện ra — tính cả dòng hiện vì tên collection/folder cha khớp */
  shownReqs: number;
}

export const UNFILED_KEY = 'unfiled';

/** Khớp theo tên request + URL + method (cùng breadth với Ctrl+K), không phân biệt hoa/thường. */
export function requestHits(r: ApiRequest | undefined, q: string): boolean {
  if (!r) return false;
  return (
    (r.name ?? '').toLowerCase().includes(q) ||
    (r.url ?? '').toLowerCase().includes(q) ||
    String(r.method ?? '').toLowerCase().includes(q)
  );
}

function filterCollection(
  c: Collection,
  requests: Record<string, ApiRequest>,
  q: string,
  out: { colVisible: Set<string>; fldVisible: Set<string>; reqVisible: Set<string> },
): number {
  const byId = (fid: string) => c.folders.find((f) => f.id === fid);
  const colMatch = c.name.toLowerCase().includes(q);
  const nameMatch = (f: Folder) => f.name.toLowerCase().includes(q);
  const reqHit = (id: string) => requestHits(requests[id], q);

  /** Có gì khớp bên dưới folder này không: request khớp, hoặc folder con khớp tên / có nội dung khớp.
   *  `trail` chỉ để chặn vòng lặp khi dữ liệu hỏng (folder cha ↔ con trỏ nhau). */
  const hitMemo = new Map<string, boolean>();
  const subtreeHit = (fid: string, trail: Set<string>): boolean => {
    const cached = hitMemo.get(fid);
    if (cached !== undefined) return cached;
    if (trail.has(fid)) return false;
    trail.add(fid);
    const f = byId(fid);
    if (!f) return false;
    const hit =
      nameMatch(f) || f.requestIds.some(reqHit) || (f.folderIds ?? []).some((ch) => subtreeHit(ch, trail));
    hitMemo.set(fid, hit);
    return hit;
  };

  let shown = 0;
  const showReq = (id: string) => {
    out.reqVisible.add(id);
    shown++;
  };

  const roots = c.folders.filter((f) => !c.folders.some((p) => (p.folderIds ?? []).includes(f.id)));
  const colVisible = colMatch || c.rootRequestIds.some(reqHit) || c.folders.some((f) => subtreeHit(f.id, new Set()));
  if (!colVisible) return 0;
  out.colVisible.add(c.id);
  for (const id of c.rootRequestIds) if (colMatch || reqHit(id)) showReq(id);

  const walked = new Set<string>();
  /** broad = tên collection/folder cha khớp → nguyên subtree bên dưới hiện, không so tiếp. */
  const walk = (f: Folder, broad: boolean) => {
    if (walked.has(f.id)) return;
    walked.add(f.id);
    const selfBroad = broad || nameMatch(f);
    if (!(selfBroad || subtreeHit(f.id, new Set()))) return;
    out.fldVisible.add(f.id);
    for (const id of f.requestIds) if (selfBroad || reqHit(id)) showReq(id);
    for (const ch of f.folderIds ?? []) {
      const child = byId(ch);
      if (child) walk(child, selfBroad);
    }
  };
  for (const f of roots) walk(f, colMatch);
  return shown;
}

export function buildTreeFilter(
  collections: Collection[],
  requests: Record<string, ApiRequest>,
  dirs: Dir[],
  rawQuery: string,
): TreeFilter {
  const q = rawQuery.trim().toLowerCase();
  const totalReqs = collections.reduce(
    (n, c) => n + c.rootRequestIds.length + c.folders.reduce((m, f) => m + f.requestIds.length, 0),
    0,
  );
  const colVisible = new Set<string>();
  const fldVisible = new Set<string>();
  const reqVisible = new Set<string>();
  const dirVisible = new Set<string>();
  if (!q) return { q: '', active: false, colVisible, fldVisible, reqVisible, dirVisible, totalReqs, shownReqs: 0 };

  let shownReqs = 0;
  for (const c of collections) {
    shownReqs += filterCollection(c, requests, q, { colVisible, fldVisible, reqVisible });
  }

  const filed = new Set<string>();
  for (const d of dirs) {
    for (const cid of d.collectionIds) {
      filed.add(cid);
      if (colVisible.has(cid)) dirVisible.add(d.id);
    }
  }
  // Thư mục cha vẫn phải hiện khi kết quả nằm trong thư mục con
  const propagate = (id: string): boolean => {
    const any = dirVisible.has(id) || dirs.some((x) => (x.parentId ?? null) === id && propagate(x.id));
    if (any) dirVisible.add(id);
    return any;
  };
  for (const d of dirs.filter((x) => !x.parentId)) propagate(d.id);
  if (collections.some((c) => !filed.has(c.id) && colVisible.has(c.id))) dirVisible.add(UNFILED_KEY);

  return { q, active: true, colVisible, fldVisible, reqVisible, dirVisible, totalReqs, shownReqs };
}
