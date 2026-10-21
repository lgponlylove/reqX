import type { ApiRequest, Collection, ExtractRule, Folder } from '../types/api';
import type { FlowImportData } from './flow';
import { uid } from './variables';
import { stripRequestSecrets } from './secrets';

export interface ReqxBackup {
  kind: 'reqx-backup';
  app: 'reqx';
  version: 1;
  exportedAt: number;
  dirs?: import('../types/api').Dir[];
  collections: Collection[];
  requests: ApiRequest[];
  flows: { id: string; name: string; steps: { requestId: string; extract: ExtractRule[]; disabled?: boolean }[] }[];
}

/** Gom TẤT CẢ (dirs + collections + requests + flows) thành 1 file backup duy nhất. Secrets đã strip nên an toàn. */
export function buildBackup(
  dirs: import('../types/api').Dir[],
  collections: Collection[],
  requests: ApiRequest[],
  flows: { id: string; name: string; steps: { requestId: string; extract: ExtractRule[]; disabled?: boolean }[] }[],
): string {
  const backup: ReqxBackup = {
    kind: 'reqx-backup',
    app: 'reqx',
    version: 1,
    exportedAt: Date.now(),
    dirs,
    collections,
    requests: requests.map(stripRequestSecrets),
    flows,
  };
  return JSON.stringify(backup, null, 2);
}

export interface ParsedBackup {
  dirs: import('../types/api').Dir[];
  items: { collection: Collection; reqs: ApiRequest[] }[];
  flows: FlowImportData[];
  warnings: string[];
}

/**
 * Bung file backup: sinh id mới toàn bộ (tránh đụng id cũ),
 * remap folder/requestIds + flow steps sang id mới, step nào mất request thì bỏ.
 */
export function parseBackup(json: unknown): ParsedBackup | { error: string } {
  const o = json as Partial<ReqxBackup>;
  if (!o || typeof o !== 'object' || o.kind !== 'reqx-backup') return { error: 'không phải file backup ReqX' };
  const warnings: string[] = [];

  const reqById = new Map(
    (Array.isArray(o.requests) ? o.requests : []).filter((r) => r && typeof r.id === 'string').map((r) => [r.id, r]),
  );
  const reqIdMap = new Map<string, string>(); // id cũ → id mới
  const reqsByNewId = new Map<string, ApiRequest>();
  const items: ParsedBackup['items'] = [];
  const colIdMap = new Map<string, string>(); // id col cũ -> id col mới

  const pick = (colId: string, oldRid: unknown): string | null => {
    if (typeof oldRid !== 'string') return null;
    const old = reqById.get(oldRid);
    if (!old) {
      warnings.push(`request "${oldRid}" có trong collection nhưng thiếu nội dung — bỏ qua`);
      return null;
    }
    if (!reqIdMap.has(oldRid)) reqIdMap.set(oldRid, uid('req'));
    const newId = reqIdMap.get(oldRid)!;
    if (!reqsByNewId.has(newId)) {
      reqsByNewId.set(
        newId,
        stripRequestSecrets({
          ...old,
          id: newId,
          collectionId: colId,
          params: (old.params ?? []).map((k) => ({ ...k, id: uid('kv') })),
          headers: (old.headers ?? []).map((k) => ({ ...k, id: uid('kv') })),
          origin: 'imported',
          updatedAt: Date.now(),
        }),
      );
    }
    return newId;
  };

  for (const c of Array.isArray(o.collections) ? o.collections : []) {
    if (!c || typeof c !== 'object' || typeof (c as Collection).id !== 'string') continue;
    const oldColId = (c as Collection).id;
    const col: Collection = {
      id: uid('col'),
      name: typeof (c as any).name === 'string' && (c as any).name ? (c as any).name : 'Collection',
      folders: [],
      rootRequestIds: [],
      preRequest: typeof (c as any).preRequest === 'string' ? (c as any).preRequest : '',
      tests: typeof (c as any).tests === 'string' ? (c as any).tests : '',
      teardown: typeof (c as any).teardown === 'string' ? (c as any).teardown : '',
    };
    colIdMap.set(oldColId, col.id);
    const folderIdMap = new Map<string, string>();
    for (const f of (c as any).folders ?? []) {
      if (!f || typeof f !== 'object') continue;
      const nf: Folder = {
        id: uid('fld'),
        name: typeof f.name === 'string' && f.name ? f.name : 'Folder',
        requestIds: [] as string[],
        folderIds: [] as string[],
        preRequest: typeof f.preRequest === 'string' ? f.preRequest : '',
        tests: typeof f.tests === 'string' ? f.tests : '',
      };
      folderIdMap.set(f.id, nf.id);
      for (const rid of f.requestIds ?? []) {
        const nid = pick(col.id, rid);
        if (nid) nf.requestIds.push(nid);
      }
      col.folders.push(nf);
    }
    // Nêu lại cây folder con (id đã đổi khi restore)
    for (const f of (c as any).folders ?? []) {
      if (!f || typeof f !== 'object') continue;
      const nf = col.folders.find((x) => x.id === folderIdMap.get(f.id));
      if (!nf) continue;
      for (const cid of f.folderIds ?? []) {
        const mapped = folderIdMap.get(cid);
        if (mapped) nf.folderIds.push(mapped);
      }
    }
    for (const rid of (c as any).rootRequestIds ?? []) {
      const nid = pick(col.id, rid);
      if (nid) col.rootRequestIds.push(nid);
    }
    items.push({ collection: col, reqs: [...reqsByNewId.values()].filter((r) => r.collectionId === col.id) });
  }

  const dirs: import('../types/api').Dir[] = [];
  const dirIdMap = new Map<string, string>();
  for (const d of Array.isArray(o.dirs) ? o.dirs : []) {
    if (!d || typeof d !== 'object' || typeof (d as any).id !== 'string') continue;
    dirIdMap.set((d as any).id, uid('dir'));
  }
  for (const d of Array.isArray(o.dirs) ? o.dirs : []) {
    if (!d || typeof d !== 'object' || typeof (d as any).id !== 'string') continue;
    const oldDirId = (d as any).id;
    const newDirId = dirIdMap.get(oldDirId)!;
    const oldParent = (d as any).parentId;
    const parentId = oldParent ? dirIdMap.get(oldParent) ?? null : null;
    const collectionIds = Array.isArray((d as any).collectionIds) 
      ? (d as any).collectionIds.map((cid: string) => colIdMap.get(cid)).filter(Boolean) as string[]
      : [];
    dirs.push({
      id: newDirId,
      name: typeof (d as any).name === 'string' && (d as any).name ? (d as any).name : 'Thư mục',
      parentId,
      collectionIds,
    });
  }

  const flows: FlowImportData[] = [];
  for (const f of Array.isArray(o.flows) ? o.flows : []) {
    if (!f || typeof f !== 'object') continue;
    const fname = typeof (f as any).name === 'string' && (f as any).name ? (f as any).name : 'Flow';
    const steps: FlowImportData['steps'] = [];
    (Array.isArray((f as any).steps) ? (f as any).steps : []).forEach((st: any, i: number) => {
      const nid = typeof st?.requestId === 'string' ? reqIdMap.get(st.requestId) : undefined;
      if (!nid || !reqsByNewId.has(nid)) {
        warnings.push(`flow "${fname}" step #${i + 1}: request gốc không còn — bỏ qua`);
        return;
      }
      steps.push({
        requestId: nid,
        disabled: st.disabled === true || undefined,
        extract: (Array.isArray(st.extract) ? st.extract : []).map((r: ExtractRule) => ({ ...r })),
      });
    });
    if (steps.length === 0) {
      warnings.push(`flow "${fname}": không còn step nào — bỏ qua`);
      continue;
    }
    flows.push({ name: fname, steps });
  }

  return { dirs, items, flows, warnings };
}
