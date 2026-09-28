import type { ApiRequest, Collection, ExtractRule } from '../types/api';
import type { FlowImportData } from './flow';
import { uid } from './variables';
import { stripRequestSecrets } from './secrets';

export interface ReqxBackup {
  kind: 'reqx-backup';
  app: 'reqx';
  version: 1;
  exportedAt: number;
  collections: Collection[];
  requests: ApiRequest[];
  flows: { id: string; name: string; steps: { requestId: string; extract: ExtractRule[]; disabled?: boolean }[] }[];
}

/** Gom TẤT CẢ (collections + requests + flows) thành 1 file backup duy nhất. Secrets đã strip nên an toàn. */
export function buildBackup(
  collections: Collection[],
  requests: ApiRequest[],
  flows: { id: string; name: string; steps: { requestId: string; extract: ExtractRule[]; disabled?: boolean }[] }[],
): string {
  const backup: ReqxBackup = {
    kind: 'reqx-backup',
    app: 'reqx',
    version: 1,
    exportedAt: Date.now(),
    collections,
    requests: requests.map(stripRequestSecrets),
    flows,
  };
  return JSON.stringify(backup, null, 2);
}

export interface ParsedBackup {
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
    const col: Collection = {
      id: uid('col'),
      name: typeof c.name === 'string' && c.name ? c.name : 'Collection',
      folders: [],
      rootRequestIds: [],
    };
    for (const f of c.folders ?? []) {
      if (!f || typeof f !== 'object') continue;
      const nf = { id: uid('fld'), name: typeof f.name === 'string' && f.name ? f.name : 'Folder', requestIds: [] as string[] };
      for (const rid of f.requestIds ?? []) {
        const nid = pick(col.id, rid);
        if (nid) nf.requestIds.push(nid);
      }
      col.folders.push(nf);
    }
    for (const rid of c.rootRequestIds ?? []) {
      const nid = pick(col.id, rid);
      if (nid) col.rootRequestIds.push(nid);
    }
    items.push({ collection: col, reqs: [...reqsByNewId.values()].filter((r) => r.collectionId === col.id) });
  }

  const flows: FlowImportData[] = [];
  for (const f of Array.isArray(o.flows) ? o.flows : []) {
    if (!f || typeof f !== 'object') continue;
    const fname = typeof f.name === 'string' && f.name ? f.name : 'Flow';
    const steps: FlowImportData['steps'] = [];
    (Array.isArray(f.steps) ? f.steps : []).forEach((st, i) => {
      const nid = typeof st?.requestId === 'string' ? reqIdMap.get(st.requestId) : undefined;
      if (!nid || !reqsByNewId.has(nid)) {
        warnings.push(`flow "${fname}" step #${i + 1}: request gốc không còn — bỏ qua`);
        return;
      }
      steps.push({
        requestId: nid,
        disabled: st.disabled === true || undefined,
        extract: (Array.isArray(st.extract) ? st.extract : []).map((r) => ({ ...r })),
      });
    });
    if (steps.length === 0) {
      warnings.push(`flow "${fname}": không còn step nào — bỏ qua`);
      continue;
    }
    flows.push({ name: fname, steps });
  }

  return { items, flows, warnings };
}
