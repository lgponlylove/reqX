import type { ApiRequest, Collection, Folder } from '../types/api';

/** Chuỗi script đã giải quyết theo mức kế thừa, theo đúng thứ tự chạy. */
export interface ScriptChain {
  pre: string[];
  tests: string[];
}

const has = (s?: string) => !!(s ?? '').trim();

/** Đường dẫn folder từ gốc xuống folder trực tiếp chứa request (không gồm request). */
export function folderPathOf(col: Collection, requestId: string): Folder[] {
  const parentOf = new Map<string, string>();
  for (const f of col.folders ?? []) {
    for (const cid of f.folderIds ?? []) parentOf.set(cid, f.id);
  }
  let cur = (col.folders ?? []).find((f) => f.requestIds?.includes(requestId));
  if (!cur) return [];

  const path: Folder[] = [];
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    const pid = parentOf.get(cur.id);
    cur = pid ? (col.folders ?? []).find((f) => f.id === pid) : undefined;
  }
  return path;
}

/** Collection thật chứa request — dò theo thành viên trước, không thấy thì tin collectionId. */
export function findCollectionOf(collections: Collection[], req: ApiRequest): Collection | null {
  const memberOf = (c: Collection) =>
    c.rootRequestIds?.includes(req.id) || (c.folders ?? []).some((f) => f.requestIds?.includes(req.id));

  const byMember = collections.find(memberOf);
  if (byMember) return byMember;
  return collections.find((c) => c.id === req.collectionId) ?? null;
}

/**
 * Postman chạy script theo mức: pre-request đi từ ngoài vào trong
 * (collection → folder → … → request), tests chạy ngược lại.
 */
export function scriptChainFor(collections: Collection[], req: ApiRequest): ScriptChain {
  const col = findCollectionOf(collections, req);
  const pre: string[] = [];
  const tests: string[] = [];

  if (col) {
    if (has(col.preRequest)) pre.push(col.preRequest!);
    for (const f of folderPathOf(col, req.id)) if (has(f.preRequest)) pre.push(f.preRequest!);
  }
  if (has(req.preRequest)) pre.push(req.preRequest!);

  if (has(req.tests)) tests.push(req.tests!);
  if (col) {
    const path = folderPathOf(col, req.id);
    for (let i = path.length - 1; i >= 0; i--) if (has(path[i].tests)) tests.push(path[i].tests!);
    if (has(col.tests)) tests.push(col.tests!);
  }
  return { pre, tests };
}

/** Số script được kế thừa từ collection/folder cho request này (để hiện badge). */
export function inheritedScriptCount(collections: Collection[], req: ApiRequest): { pre: number; tests: number } {
  const chain = scriptChainFor(collections, req);
  return {
    pre: chain.pre.length - (has(req.preRequest) ? 1 : 0),
    tests: chain.tests.length - (has(req.tests) ? 1 : 0),
  };
}
