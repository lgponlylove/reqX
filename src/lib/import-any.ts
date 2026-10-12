import { useAppStore } from '../stores/app';
import { useFlowStore } from '../stores/flow';
import { importPostmanCollection } from './postman-io';
import { parseFlowObject, parseReqxFlowFile, mergeReqxImport } from './flow';
import { parseBackup } from './backup';

export interface AnyImportResult {
  collections: { name: string; requests: number }[];
  flows: string[];
  info: string[];
  warnings: string[];
  errors: string[];
}

/**
 * Nhập 1 JSON đã parse thuộc bất kỳ loại nào app hiểu:
 * backup full (reqx-backup) | file gộp (reqx-flow) | flow JSON lẻ (có steps)
 * | collection Postman v2.1 | mảng các loại trên.
 * Nhập thẳng vào store, trả tóm tắt để hiển thị.
 */
export function importAnyJson(json: unknown, label = 'dữ liệu'): AnyImportResult {
  const res: AnyImportResult = { collections: [], flows: [], info: [], warnings: [], errors: [] };
  const colOf = (rid: string) =>
    useAppStore
      .getState()
      .collections.find((c) => c.rootRequestIds.includes(rid) || c.folders.some((f) => f.requestIds.includes(rid)))?.id;
  const err = (e: unknown) => res.errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
  try {
    if (json && typeof json === 'object' && !Array.isArray(json) && (json as { kind?: unknown }).kind === 'reqx-backup') {
      const bk = parseBackup(json);
      if ('error' in bk) throw new Error(bk.error);
      if (bk.dirs && bk.dirs.length > 0) {
        useAppStore.getState().importDirs(bk.dirs);
      }
      for (const p of bk.items) {
        useAppStore.getState().importData(p.collection, p.reqs);
        res.collections.push({ name: p.collection.name, requests: p.reqs.length });
      }
      for (const fd of bk.flows) {
        useFlowStore.getState().importFlow(fd, colOf);
        res.flows.push(fd.name);
      }
      res.warnings.push(...bk.warnings.slice(0, 5));
      return res;
    }
    const raws = Array.isArray(json) ? json : [json];
    for (const raw of raws) {
      try {
        if (raw && typeof raw === 'object' && (raw as { kind?: unknown }).kind === 'reqx-flow') {
          const { data: rd, error: re } = parseReqxFlowFile(raw);
          if (re || !rd) throw new Error(re ?? 'file lỗi');
          const merged = mergeReqxImport(rd, useAppStore.getState().requests);
          if (merged.collection) {
            useAppStore.getState().importData(merged.collection, merged.requests);
            res.collections.push({ name: merged.collection.name, requests: merged.requests.length });
          }
          useFlowStore.getState().importFlow(merged.flowData, colOf);
          res.flows.push(merged.flowData.name);
          if (merged.reused.length > 0)
            res.info.push(`Flow “${merged.flowData.name}”: dùng lại ${merged.reused.length} request đã có (${merged.reused.slice(0, 5).join(', ')}${merged.reused.length > 5 ? '…' : ''}).`);
        } else if (raw && typeof raw === 'object' && Array.isArray((raw as { steps?: unknown }).steps)) {
          const existing = useAppStore.getState().requests;
          const { data, error } = parseFlowObject(raw, existing);
          if (!data) throw new Error(error ?? 'flow lỗi');
          useFlowStore.getState().importFlow(data, colOf);
          res.flows.push(data.name);
        } else {
          const { collection, requests: reqs } = importPostmanCollection(raw);
          useAppStore.getState().importData(collection, reqs);
          res.collections.push({ name: collection.name, requests: reqs.length });
        }
      } catch (e) {
        err(e);
      }
    }
  } catch (e) {
    err(e);
  }
  return res;
}

/** Tóm tắt kết quả import thành 1-2 dòng tiếng Việt. */
export function summarizeImport(r: AnyImportResult): string {
  const parts: string[] = [];
  const nReq = r.collections.reduce((n, c) => n + c.requests, 0);
  if (r.collections.length > 0)
    parts.push(`Đã nhập ${r.collections.length} collection (${nReq} requests): ${r.collections.map((c) => c.name).join(', ')}.`);
  if (r.flows.length > 0) parts.push(`Đã nhập ${r.flows.length} flow: ${r.flows.join(', ')} (mở tab Flow để chạy).`);
  if (r.info.length > 0) parts.push(r.info.join('\n'));
  if (r.warnings.length > 0) parts.push(`⚠ ${r.warnings.join(' | ')}`);
  if (r.errors.length > 0) parts.push(`Lỗi, bỏ qua: ${r.errors.join(' | ')}`);
  if (r.collections.length > 0) parts.push('💡 Kéo thả collection vào thư mục trong sidebar để sắp xếp.');
  return parts.join('\n') || 'Không nhập được gì — JSON không thuộc loại nào app hiểu (backup/flow/Postman v2.1).';
}
