import { useMemo, useState } from 'react';
import { useAppStore, type VarsSnapshot } from '../stores/app';
import { useRequestStore } from '../stores/request';
import { applyExtraction, collectCandidates, collectVarUsages, looksLikeSecretName, type Candidate } from '../lib/extract-vars';
import type { Collection, Folder } from '../types/api';

type ScopeKind = 'open' | 'folder' | 'collection' | 'all';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** Giá trị sentinel của ô "Ghi vào" = biến dùng chung (Globals) thay vì một môi trường cụ thể */
const GLOBALS_TARGET = '__globals__';

/** Mọi request trong collection (root + mọi folder, kể cả folder lồng nhau) */
function collectionReqIds(col: Collection): string[] {
  return [...col.rootRequestIds, ...col.folders.flatMap((f) => f.requestIds)];
}

/** Folder + toàn bộ folder con của nó */
function folderReqIds(folders: Folder[], rootId: string): string[] {
  const out: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const f = folders.find((x) => x.id === id);
    if (!f) continue;
    out.push(...f.requestIds);
    stack.push(...(f.folderIds ?? []));
  }
  return out;
}

/**
 * Hộp "Tạo biến môi trường từ request": quét giá trị lặp lại trong phạm vi chọn,
 * duyệt danh sách ứng viên (đổi tên, chọn/bỏ, đánh dấu secret) rồi ghi hàng loạt.
 */
export default function ExtractVarsDialog({
  initialCollectionId,
  initialFolderId,
  onClose,
}: {
  initialCollectionId?: string;
  initialFolderId?: string;
  onClose: () => void;
}) {
  const { collections, requests, environments, activeEnvId, globals, addEnvVars, addGlobals, setRequestsBulk, restoreVarState } = useAppStore();
  const currentReq = useRequestStore((s) => s.current);

  const [scope, setScope] = useState<ScopeKind>(initialFolderId ? 'folder' : initialCollectionId ? 'collection' : 'open');
  const [colId, setColId] = useState(initialCollectionId ?? collections[0]?.id ?? '');
  const [folderId, setFolderId] = useState(initialFolderId ?? '');
  const [scanned, setScanned] = useState<{ list: Candidate[]; ids: string[] } | null>(null);
  const [picks, setPicks] = useState<Record<string, { name: string; on: boolean; secret: boolean }>>({});
  const [missingEdits, setMissingEdits] = useState<Record<string, { on: boolean; value: string; secret: boolean }>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [envId, setEnvId] = useState(activeEnvId ?? '');
  const [newEnvName, setNewEnvName] = useState('');
  const [done, setDone] = useState<{ vars: number; positions: number; touched: number; recreated: number } | null>(null);
  const [snapshot, setSnapshot] = useState<VarsSnapshot | null>(null);
  const [undone, setUndone] = useState(false);

  const col = collections.find((c) => c.id === colId);
  const scopeIds = scanned?.ids ?? [];
  const toGlobals = envId === GLOBALS_TARGET;
  /** Biến đang có ở đích ghi, dùng để báo xung đột tên */
  const destVars = toGlobals ? globals : (environments.find((e) => e.id === envId)?.variables ?? {});
  const destLabel = toGlobals ? 'Globals dùng chung' : envId ? 'môi trường đã chọn' : 'môi trường mới';

  function idsForScope(): string[] {
    if (scope === 'open') return [currentReq.id];
    if (scope === 'all') return Object.keys(requests);
    if (!col) return [];
    if (scope === 'folder') return folderReqIds(col.folders, folderId || col.folders[0]?.id || '');
    return collectionReqIds(col);
  }

  function scan() {
    const ids = idsForScope().filter((id) => requests[id]);
    const list = collectCandidates(ids.map((id) => requests[id]));
    const init: Record<string, { name: string; on: boolean; secret: boolean }> = {};
    for (const c of list) init[c.value] = { name: c.name, on: c.origin || c.requestCount >= 2, secret: c.looksSecret };
    setPicks(init);
    setMissingEdits({});
    setScanned({ list, ids });
    setDone(null);
    setSnapshot(null);
    setUndone(false);
  }

  const selected = useMemo(() => {
    if (!scanned) return [];
    return scanned.list
      .filter((c) => picks[c.value]?.on)
      .map((c) => ({ candidate: c, name: picks[c.value].name, secret: picks[c.value].secret }));
  }, [scanned, picks]);

  /** Biến `{{x}}` request đang dùng nhưng môi trường đích chưa có — tạo lại được tại đây */
  const missing = useMemo(() => {
    if (!scanned) return [];
    const defined = { ...globals, ...destVars };
    return collectVarUsages(scanned.ids.map((id) => requests[id]).filter(Boolean))
      .filter((u) => !(u.name in defined));
  }, [scanned, globals, destVars, requests]);

  const missingPrefill = (name: string) =>
    environments.find((e) => name in e.variables)?.variables[name] ?? '';

  const editMissing = (name: string) =>
    missingEdits[name] ?? { on: true, value: missingPrefill(name), secret: looksLikeSecretName(name) };

  const addableMissing = missing.filter((m) => editMissing(m.name).on && editMissing(m.name).value.trim());

  /** Tên trùng mà giá trị khác nhau, hoặc tên không hợp lệ — phải sửa mới Apply được */
  const conflicts = useMemo(() => {
    const out: string[] = [];
    const byName = new Map<string, string>();
    for (const s of selected) {
      const n = s.name.trim();
      if (!NAME_RE.test(n)) {
        out.push(`"${n || '(trống)'}" — tên biến phải chữ cái đầu, chỉ gồm a-z 0-9 _ . -`);
        continue;
      }
      const prev = byName.get(n);
      if (prev && prev !== s.candidate.value) out.push(`"${n}" — gán cho 2 giá trị khác nhau`);
      byName.set(n, s.candidate.value);
      if (n in destVars && destVars[n] !== s.candidate.value)
        out.push(`"${n}" — đã có trong ${toGlobals ? 'Globals' : 'môi trường'} với giá trị khác`);
    }
    return [...new Set(out)];
  }, [selected, destVars, toGlobals]);

  function apply() {
    if (!scanned || (selected.length === 0 && addableMissing.length === 0) || conflicts.length) return;
    const st = useAppStore.getState();
    setSnapshot({
      requests: st.requests,
      environments: st.environments,
      envSecrets: st.envSecrets,
      globals: st.globals,
      globalSecrets: st.globalSecrets,
    });

    let targetEnvId = envId;
    if (!toGlobals && !targetEnvId) {
      const name = newEnvName.trim() || 'Extracted';
      st.addEnvironment(name);
      targetEnvId = useAppStore.getState().environments.find((e) => e.name === name)?.id ?? '';
      setEnvId(targetEnvId);
    }

    const values: Record<string, string> = {};
    const secretKeys: string[] = [];
    for (const s of selected) {
      const n = s.name.trim();
      values[n] = s.candidate.value;
      if (s.secret) secretKeys.push(n);
    }
    for (const m of addableMissing) {
      const e = editMissing(m.name);
      values[m.name] = e.value.trim();
      if (e.secret) secretKeys.push(m.name);
    }

    let positions = 0;
    let touched = 0;
    if (selected.length) {
      const res = applyExtraction(st.requests, scopeIds, selected.map((s) => ({ name: s.name.trim(), value: s.candidate.value })));
      positions = res.positions;
      touched = res.touched;
      setRequestsBulk(res.requests);
      useRequestStore.getState().refreshTabs(res.requests);
    }
    if (toGlobals) addGlobals(values, secretKeys);
    else addEnvVars(targetEnvId, values, secretKeys);
    setDone({ vars: Object.keys(values).length, positions, touched, recreated: addableMissing.length });
  }

  function undo() {
    if (!snapshot) return;
    restoreVarState(snapshot);
    useRequestStore.getState().refreshTabs(snapshot.requests);
    setUndone(true);
    setSnapshot(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col bg-slate-900 border border-slate-700 rounded-lg shadow-2xl">
        <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-slate-800">
          <div>
            <h3 className="font-bold">⚡ Tạo biến môi trường từ request</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Quét các giá trị lặp lại (base URL, header, token, field trong body…) rồi thay bằng {'{{ten_bien}}'} hàng loạt.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white px-2" title="Đóng (Esc)">✕</button>
        </div>

        <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center gap-2 text-sm">
          <select
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5"
            value={scope}
            onChange={(e) => setScope(e.target.value as ScopeKind)}
          >
            <option value="open">Request đang mở</option>
            <option value="folder">1 folder trong collection</option>
            <option value="collection">Cả collection</option>
            <option value="all">Toàn bộ app</option>
          </select>
          {scope !== 'open' && scope !== 'all' && (
            <select
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5"
              value={colId}
              onChange={(e) => { setColId(e.target.value); setFolderId(''); }}
            >
              {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {scope === 'folder' && col && (
            <select
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5"
              value={folderId || col.folders[0]?.id || ''}
              onChange={(e) => setFolderId(e.target.value)}
            >
              {col.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
          <button onClick={scan} className="bg-emerald-700 hover:bg-emerald-600 font-bold rounded px-3 py-1.5">
            🔍 Quét
          </button>
          {scanned && (
            <span className="text-xs text-slate-500">
              {scanned.ids.length} request · {scanned.list.length} ứng viên
              {missing.length > 0 && <span className="text-amber-400"> · {missing.length} biến thiếu</span>}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-auto px-4 py-3">
          {!scanned && <p className="text-sm text-slate-500">Chọn phạm vi rồi bấm <b>🔍 Quét</b> để xem danh sách gợi ý.</p>}
          {scanned && scanned.list.length === 0 && (
            <p className="text-sm text-slate-500">
              Không còn giá trị nào để tách trong phạm vi này (giá trị đã thành {'{{biến}}'} hết).
              {missing.length > 0 && ' Xem mục "Biến đang dùng nhưng chưa có ở dưới".'}
            </p>
          )}
          {scanned && scanned.list.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500 sticky top-0 bg-slate-900">
                <tr className="text-left">
                  <th className="w-8 py-1"></th>
                  <th className="w-52 py-1">Tên biến</th>
                  <th className="py-1">Giá trị</th>
                  <th className="w-16 py-1 text-right">Lượt dùng</th>
                  <th className="w-16 py-1 text-center">Secret</th>
                </tr>
              </thead>
              <tbody>
                {scanned.list.map((c) => {
                  const p = picks[c.value];
                  const bad = p?.on && !NAME_RE.test(p.name.trim());
                  return (
                    <tr key={c.value} className="border-t border-slate-800 align-top">
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          checked={!!p?.on}
                          onChange={(e) => setPicks((s) => ({ ...s, [c.value]: { ...p, on: e.target.checked } }))}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          className={`w-full bg-slate-950 border rounded px-2 py-1 font-mono text-xs ${bad ? 'border-red-700' : 'border-slate-700'}`}
                          value={p?.name ?? c.name}
                          onChange={(e) => setPicks((s) => ({ ...s, [c.value]: { ...p, name: e.target.value } }))}
                        />
                        <span className="text-[10px] text-slate-500">
                          {c.origin ? 'base URL' : `${c.occurrences[0]?.field} · ${c.occurrences[0]?.label}`}
                          {c.requestCount > 1 ? ` · ${c.requestCount} request` : ''}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          readOnly
                          type={p?.secret && !reveal[c.value] ? 'password' : 'text'}
                          className="w-full bg-slate-950/60 border border-slate-800 rounded px-2 py-1 font-mono text-xs"
                          value={c.value}
                        />
                        <button
                          onClick={() => setReveal((r) => ({ ...r, [c.value]: !r[c.value] }))}
                          className="text-[10px] text-slate-500 hover:text-slate-300"
                        >
                          {reveal[c.value] ? '🙈 ẩn' : '👁️ hiện'}
                        </button>
                      </td>
                      <td className="py-1.5 text-right text-slate-400">{c.occurrences.length}×</td>
                      <td className="py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={!!p?.secret}
                          onChange={(e) => setPicks((s) => ({ ...s, [c.value]: { ...p, secret: e.target.checked } }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {scanned && missing.length > 0 && (
            <div className="mt-4 border border-amber-900/50 bg-amber-950/10 rounded-lg p-3">
              <h4 className="text-sm font-bold text-amber-400">
                ⚠ {missing.length} biến request đang dùng nhưng chưa có trong{' '}
                {destLabel}
              </h4>
              <p className="text-xs text-slate-500 mb-2">
                Đây là các biến đã tách ra rồi bị xoá (hoặc collection import từ Postman thiếu biến). Điền giá trị rồi bấm
                Áp dụng để tạo lại, không cần tách lại từ đầu.
              </p>
              <div className="flex flex-col gap-1.5">
                {missing.map((m) => {
                  const e = editMissing(m.name);
                  return (
                    <div key={m.name} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={e.on}
                        onChange={(ev) => setMissingEdits((s) => ({ ...s, [m.name]: { ...e, on: ev.target.checked } }))}
                      />
                      <span className="w-44 shrink-0 font-mono text-xs text-amber-300 truncate" title={m.name}>{'{{'}{m.name}{'}}'}</span>
                      <input
                        type={e.secret ? 'password' : 'text'}
                        className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-xs"
                        placeholder="Giá trị cho biến này…"
                        value={e.value}
                        onChange={(ev) => setMissingEdits((s) => ({ ...s, [m.name]: { ...e, value: ev.target.value } }))}
                      />
                      <span className="w-14 shrink-0 text-right text-[11px] text-slate-500" title={`${m.occurrences} lượt trong ${m.requestCount} request`}>
                        {m.requestCount} req
                      </span>
                      <label className="text-[11px] text-slate-400 flex items-center gap-1 shrink-0" title="Secret: không lưu giá trị ra ổ cứng">
                        <input
                          type="checkbox"
                          checked={e.secret}
                          onChange={(ev) => setMissingEdits((s) => ({ ...s, [m.name]: { ...e, secret: ev.target.checked } }))}
                        />
                        🔒
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-800 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500 text-xs">Ghi vào:</span>
          <select
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5"
            value={envId}
            onChange={(e) => setEnvId(e.target.value)}
          >
            <option value="">— tạo môi trường mới —</option>
            <option value={GLOBALS_TARGET}>🔑 Dùng chung (Globals)</option>
            {environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          {envId === '' && (
            <input
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 w-40"
              placeholder="Tên môi trường mới…"
              value={newEnvName}
              onChange={(e) => setNewEnvName(e.target.value)}
            />
          )}
          <div className="flex-1" />
          {done ? (
            <>
              <span className="text-emerald-400 text-xs">
                {undone
                  ? 'Đã hoàn tác.'
                  : `Đã tạo ${done.vars} biến` +
                    (done.recreated ? ` (${done.recreated} tạo lại)` : '') +
                    (done.positions ? ` · thay ${done.positions} vị trí ở ${done.touched} request` : '') + '.'}
              </span>
              {!undone && snapshot && (
                <button onClick={undo} className="bg-slate-700 hover:bg-slate-600 rounded px-3 py-1.5 text-xs">
                  ↩ Hoàn tác
                </button>
              )}
              <button onClick={onClose} className="bg-slate-800 hover:bg-slate-700 rounded px-3 py-1.5">Đóng</button>
            </>
          ) : (
            <>
              {conflicts.length > 0 && (
                <span className="text-red-400 text-xs" title={conflicts.join('\n')}>
                  ⚠ {conflicts[0]}{conflicts.length > 1 ? ` (+${conflicts.length - 1} lỗi khác)` : ''}
                </span>
              )}
              <button
                onClick={apply}
                disabled={selected.length + addableMissing.length === 0 || conflicts.length > 0}
                className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 font-bold rounded px-4 py-1.5"
              >
                Áp dụng {selected.length + addableMissing.length ? `(${selected.length + addableMissing.length})` : ''}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
