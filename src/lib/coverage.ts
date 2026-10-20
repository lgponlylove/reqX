import type { ApiRequest, Collection, Folder } from '../types/api';
import { scriptChainFor } from './script-chain';
import { assertionCount } from './assertions';

/**
 * "Độ phủ kiểm thử" — bao nhiêu request trong collection đã CÓ điều kiện kiểm thử
 * và bao nhiêu chưa từng được chạy. Hàm thuần, không đụng DOM/Tauri để vitest kiểm
 * chứng được số liệu (đây là trang báo cáo, sai số còn tệ hơn không có báo cáo).
 */

/** Bản ghi chạy tay (Runner/Flow) — lấy đúng phần coverage cần, không phụ thuộc store. */
export interface CoverageRun {
  /** 'collection' = Runner (refId = `collectionId:folderId`), 'flow' = tab Flow (refId = flowId) */
  kind: 'collection' | 'flow';
  refId: string;
  at: number;
  steps: { name: string; ok: boolean }[];
}

/** Một mục lịch sử gửi request ở tab Builder — chỉ cần biết request nào đã từng được gửi. */
export interface CoverageHistoryItem {
  request: { id: string; name: string };
}

export interface CoverageRow {
  id: string;
  kind: 'collection' | 'folder';
  name: string;
  /** độ sâu để thụt đầu dòng (folder lồng nhau) */
  depth: number;
  total: number;
  /** có test của chính mình */
  ownTests: number;
  /** không có test riêng nhưng được collection/folder cha kiểm thử hộ */
  inheritedOnly: number;
  /** = ownTests + inheritedOnly */
  withTests: number;
  /** chưa thấy trong bất kỳ lần chạy nào (Runner/Flow/lịch sử gửi) */
  neverRun: number;
  /** fail ở lần chạy GẦN NHẤT có mặt nó */
  lastFailed: number;
  /** 0-100, làm tròn */
  pct: number;
}

export interface CoverageResult {
  rows: CoverageRow[];
  summary: {
    total: number;
    withTests: number;
    ownTests: number;
    neverRun: number;
    lastFailed: number;
    pct: number;
    collections: number;
  };
}

const norm = (s: string) => s.trim().toLowerCase();

/** Test của chính request (không tính kế thừa): script Tests hoặc dòng bật trong bảng điều kiện. */
function hasOwnTests(r: ApiRequest): boolean {
  return !!(r.tests ?? '').trim() || assertionCount(r.assertions) > 0;
}

/** Folder con trực tiếp — `folderIds` lồng nhau, collections lưu folders phẳng. */
function childFolders(col: Collection, folder: Folder): Folder[] {
  const byId = new Map((col.folders ?? []).map((f) => [f.id, f]));
  return (folder.folderIds ?? []).map((id) => byId.get(id)).filter((f): f is Folder => !!f);
}

/** Toàn bộ request thuộc một folder (kể cả folder con) — để số liệu folder khớp tổng thực tế. */
function requestsInFolder(col: Collection, folder: Folder, byId: Map<string, ApiRequest>): ApiRequest[] {
  const out: ApiRequest[] = [];
  const seen = new Set<string>();
  const walk = (f: Folder) => {
    if (seen.has(f.id)) return;
    seen.add(f.id);
    for (const id of f.requestIds ?? []) {
      const r = byId.get(id);
      if (r) out.push(r);
    }
    for (const c of childFolders(col, f)) walk(c);
  };
  walk(folder);
  return out;
}

function allRequests(col: Collection, byId: Map<string, ApiRequest>): ApiRequest[] {
  const out: ApiRequest[] = [];
  const seen = new Set<string>();
  for (const id of col.rootRequestIds ?? []) {
    const r = byId.get(id);
    if (r && !seen.has(r.id)) {
      seen.add(r.id);
      out.push(r);
    }
  }
  for (const f of col.folders ?? []) {
    for (const r of requestsInFolder(col, f, byId)) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        out.push(r);
      }
    }
  }
  return out;
}

/**
 * Với mỗi TÊN request, lấy lần chạy gần nhất có nó: ok hay fail, và đã từng chạy chưa.
 * Runner/Flow lưu step theo tên (không lưu id) nên đây là khớp theo tên — request đổi tên
 * thì mất dấu, thà báo "chưa chạy" còn hơn bịa số liệu.
 */
function latestByStepName(runs: CoverageRun[]): Map<string, { at: number; ok: boolean }> {
  const best = new Map<string, { at: number; ok: boolean }>();
  for (const run of runs) {
    for (const s of run.steps) {
      const k = norm(s.name);
      if (!k) continue;
      const cur = best.get(k);
      if (!cur || run.at >= cur.at) best.set(k, { at: run.at, ok: s.ok });
    }
  }
  return best;
}

function score(
  id: string,
  kind: 'collection' | 'folder',
  name: string,
  depth: number,
  reqs: ApiRequest[],
  collections: Collection[],
  latest: Map<string, { at: number; ok: boolean }>,
  sentIds: Set<string>,
): CoverageRow {
  let own = 0;
  let inherited = 0;
  let never = 0;
  let failed = 0;
  for (const r of reqs) {
    const chain = scriptChainFor(collections, r).tests.length;
    if (chain > 0) (hasOwnTests(r) ? own++ : inherited++);
    const last = latest.get(norm(r.name || r.url));
    const ran = !!last || sentIds.has(r.id);
    if (!ran) never++;
    if (last && !last.ok) failed++;
  }
  const total = reqs.length;
  return {
    id,
    kind,
    name,
    depth,
    total,
    ownTests: own,
    inheritedOnly: inherited,
    withTests: own + inherited,
    neverRun: never,
    lastFailed: failed,
    pct: total === 0 ? 0 : Math.round(((own + inherited) / total) * 100),
  };
}

/**
 * Đo độ phủ cho toàn bộ collection. `runs` lấy từ useFlowStore.runs,
 * `history` lấy từ useAppStore.history (lần gửi ở tab Builder cũng tính là "đã chạy").
 */
export function measureCoverage(
  collections: Collection[],
  requests: Record<string, ApiRequest>,
  runs: CoverageRun[],
  history: CoverageHistoryItem[],
): CoverageResult {
  const byId = new Map(Object.entries(requests).map(([k, v]) => [k, v]));
  const latest = latestByStepName(runs);
  const sentIds = new Set(history.map((h) => h.request.id));

  const rows: CoverageRow[] = [];
  for (const col of collections) {
    const colReqs = allRequests(col, byId);
    rows.push(score(col.id, 'collection', col.name, 0, colReqs, collections, latest, sentIds));

    // folder gốc (không có cha) rồi đệ quy con để bảng đọc theo đúng cây sidebar
    const parentOf = new Map<string, string>();
    for (const f of col.folders ?? []) {
      for (const cid of f.folderIds ?? []) parentOf.set(cid, f.id);
    }
    const roots = (col.folders ?? []).filter((f) => !parentOf.has(f.id));
    const push = (f: Folder, depth: number) => {
      rows.push(score(`${col.id}/${f.id}`, 'folder', f.name, depth, requestsInFolder(col, f, byId), collections, latest, sentIds));
      for (const c of childFolders(col, f)) push(c, depth + 1);
    };
    for (const f of roots) push(f, 1);
  }

  const sum = rows.filter((r) => r.kind === 'collection');
  const total = sum.reduce((a, r) => a + r.total, 0);
  const withTests = sum.reduce((a, r) => a + r.withTests, 0);
  return {
    rows,
    summary: {
      total,
      withTests,
      ownTests: sum.reduce((a, r) => a + r.ownTests, 0),
      neverRun: sum.reduce((a, r) => a + r.neverRun, 0),
      lastFailed: sum.reduce((a, r) => a + r.lastFailed, 0),
      pct: total === 0 ? 0 : Math.round((withTests / total) * 100),
      collections: sum.length,
    },
  };
}

/** Tô màu theo % — cùng một thang dùng cho cả bảng và thanh tiến trình. */
export function coverageTone(pct: number): 'good' | 'warn' | 'bad' | 'empty' {
  if (pct <= 0) return 'empty';
  if (pct >= 80) return 'good';
  if (pct >= 50) return 'warn';
  return 'bad';
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV có BOM để Excel mở trực tiếp (đúng quy ước xuất file của ReqX). */
export function coverageCsv(res: CoverageResult): string {
  const head = ['Level', 'Tên', 'Request', 'Có test riêng', 'Chỉ nhờ kế thừa', 'Độ phủ %', 'Chưa chạy lần nào', 'Fail ở lần chạy gần nhất'];
  const lines = [head.join(',')];
  for (const r of res.rows) {
    lines.push(
      [r.kind === 'collection' ? 'Collection' : 'Folder', ' '.repeat(Math.max(0, r.depth - 1)) + r.name, r.total, r.ownTests, r.inheritedOnly, r.pct, r.neverRun, r.lastFailed]
        .map(csvCell)
        .join(','),
    );
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
