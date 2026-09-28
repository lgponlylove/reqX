import { useMemo, useRef, useState } from 'react';
import { useAppStore } from '../stores/app';
import { useFlowStore } from '../stores/flow';
import { runRequestList, runCollectionWithData, type RunItemResult, type DataIterationResult } from '../lib/runner';
import { parseDataFile, rowSummary } from '../lib/datafile';
import { confirmUntrustedScripts } from '../lib/scripts';
import { collectRequestVars } from '../lib/flow';
import { summarize } from '../lib/scheduleEngine';
import { saveBodies, pruneBodies } from '../lib/bodyStore';
import Scheduler from './Scheduler';
import ScheduleBodyModal from './ScheduleBodyModal';
import type { ApiRequest } from '../types/api';

/** Panel chạy cả collection/folder: tuần tự từng request kèm pre-request + tests. */
export default function Runner() {
  const { collections, dirs, requests, environments, activeEnvId, globals, setEnvVar, setGlobal } = useAppStore();
  const { runs, pushRun, clearRuns } = useFlowStore();
  const [colId, setColId] = useState(collections[0]?.id ?? '');
  const [folderId, setFolderId] = useState<string>('all');
  const [delayMs, setDelayMs] = useState(0);
  const [timeoutS, setTimeoutS] = useState(30);
  const [stopOnError, setStopOnError] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunItemResult[]>([]);
  // Data-driven (Postman: data file): mỗi dòng = 1 iteration chạy hết scope
  const [dataFile, setDataFile] = useState<{ name: string; rows: Record<string, string>[]; columns: string[] } | null>(null);
  const [dataError, setDataError] = useState('');
  const [iterations, setIterations] = useState<DataIterationResult[]>([]);
  const [maxRows, setMaxRows] = useState(0); // 0 = chạy hết
  const [total, setTotal] = useState(0);
  const [viewing, setViewing] = useState<{ key: string; name: string; status?: number; ct?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const col = collections.find((c) => c.id === colId);
  const list: ApiRequest[] = useMemo(() => {
    if (!col) return [];
    const scopes =
      folderId === 'all'
        ? [...col.rootRequestIds, ...col.folders.flatMap((f) => f.requestIds)]
        : folderId === 'root'
          ? col.rootRequestIds
          : (col.folders.find((f) => f.id === folderId)?.requestIds ?? []);
    return scopes.map((id) => requests[id]).filter(Boolean);
  }, [col, folderId, requests]);

  /** Biến {{x}} nào không có ở env/globals → Runner gửi đi nguyên văn (toàn lỗi kiểu 401). */
  const knownVars = useMemo(() => {
    const env = environments.find((e) => e.id === activeEnvId)?.variables ?? {};
    // Cột data file cũng cấp biến (data thắng env khi chạy)
    return new Set([...Object.keys(env), ...Object.keys(globals), ...(dataFile?.columns ?? [])]);
  }, [environments, activeEnvId, globals, dataFile]);
  const missingOf = (req: ApiRequest) => collectRequestVars(req).filter((v) => !knownVars.has(v));
  const blocked = useMemo(() => list.filter((r) => missingOf(r).length > 0), [list, knownVars]);
  const [skipMissing, setSkipMissing] = useState(true);
  const [skippedInfo, setSkippedInfo] = useState<{ n: number; names: string[] }>({ n: 0, names: [] });
  const dataRows = dataFile ? (maxRows > 0 ? dataFile.rows.slice(0, maxRows) : dataFile.rows) : [];
  const runCount = skipMissing ? list.length - blocked.length : list.length;
  const dataTotal = dataRows.length * runCount;

  const okCount = results.filter((r) => r.ok).length;
  const passTests = results.reduce((a, r) => a + r.testsPassed, 0);
  const totalTests = results.reduce((a, r) => a + r.testsTotal, 0);
  const totalTime = results.reduce((a, r) => a + (r.timeMs ?? 0), 0);

  const scopeName =
    folderId === 'all' ? 'Tất cả'
    : folderId === 'root' ? 'Ngoài thư mục'
    : `📁 ${col?.folders.find((f) => f.id === folderId)?.name ?? '?'}`;
  const refId = `${colId}:${folderId}`;
  const colRuns = runs.filter((r) => r.kind === 'collection' && r.refId === refId);
  const fmtTime = (t: number) => new Date(t).toLocaleString('vi-VN');

  const onPickDataFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseDataFile(String(reader.result ?? ''), f.name);
      if (parsed.error || parsed.rows.length === 0) {
        setDataFile(null);
        setDataError(parsed.error ?? 'File không có dòng dữ liệu!');
        return;
      }
      setDataError('');
      setDataFile({ name: f.name, rows: parsed.rows, columns: parsed.columns });
      setIterations([]);
    };
    reader.readAsText(f);
  };

  const start = async () => {
    if (!col || list.length === 0 || running) return;
    const runList = skipMissing ? list.filter((r) => missingOf(r).length === 0) : list;
    setSkippedInfo({
      n: list.length - runList.length,
      names: list.filter((r) => !runList.includes(r)).map((r) => r.name || r.url),
    });
    if (runList.length === 0) return; // tất cả đều thiếu biến → không chạy gì
    // Script từ file import (chưa rõ nguồn gốc) → hỏi trước khi chạy hàng loạt
    if (!confirmUntrustedScripts(runList, `Collection “${col.name}” • ${scopeName}`)) return;
    setRunning(true);
    setResults([]);
    setIterations([]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const hooks = {
      getVars: () => {
        const s = useAppStore.getState();
        return {
          envVars: { ...(s.environments.find((e) => e.id === s.activeEnvId)?.variables ?? {}) },
          globals: { ...s.globals },
        };
      },
      setEnv: (k: string, v: string) => {
        const id = useAppStore.getState().activeEnvId;
        if (id) useAppStore.getState().setEnvVar(id, k, v);
      },
      setGlobal: (k: string, v: string) => useAppStore.getState().setGlobal(k, v),
    };
    const t0 = performance.now();
    const at = Date.now();

    // ── Chế độ data file: mỗi dòng = 1 iteration chạy hết scope ──
    if (dataFile) {
      const rows = maxRows > 0 ? dataFile.rows.slice(0, maxRows) : dataFile.rows;
      setTotal(rows.length * runList.length);
      const iters = await runCollectionWithData(runList, rows, hooks, {
        timeoutMs: timeoutS * 1000,
        delayMs,
        stopOnError,
        signal: ctrl.signal,
        onIteration: (it) => setIterations((prev) => [...prev, it]),
      });
      const flat: RunItemResult[] = iters.flatMap((it) =>
        it.items.map((r) => ({ ...r, name: `#${it.rowIndex + 1} ${r.name}` })),
      );
      const { steps, bodies } = summarize(`manual-col:${refId}`, at, flat);
      await saveBodies(bodies);
      pushRun({
        kind: 'collection',
        refId,
        refName: `${col.name} • ${scopeName} • data ${dataFile.name} (${iters.length} dòng)`,
        at,
        ok: iters.filter((x) => x.ok).length,
        total: iters.length,
        timeMs: Math.round(performance.now() - t0),
        stopped: ctrl.signal.aborted || undefined,
        steps,
      });
      void pruneBodies(
        `manual-col:${refId}`,
        new Set(useFlowStore.getState().runs.filter((r) => r.kind === 'collection' && r.refId === refId).map((r) => r.at)),
      );
      setRunning(false);
      abortRef.current = null;
      return;
    }

    const collected: RunItemResult[] = [];
    setTotal(runList.length);
    await runRequestList(runList, hooks, {
      timeoutMs: timeoutS * 1000,
      delayMs,
      stopOnError,
      signal: ctrl.signal,
      onItem: (r) => {
        collected.push(r);
        setResults((prev) => [...prev, r]);
      },
    });
    const { steps, bodies } = summarize(`manual-col:${refId}`, at, collected);
    await saveBodies(bodies);
    pushRun({
      kind: 'collection',
      refId,
      refName: `${col.name} • ${scopeName}`,
      at,
      ok: collected.filter((r) => r.ok).length,
      total: collected.length,
      timeMs: Math.round(performance.now() - t0),
      stopped: ctrl.signal.aborted || undefined,
      steps,
    });
    void pruneBodies(
      `manual-col:${refId}`,
      new Set(useFlowStore.getState().runs.filter((r) => r.kind === 'collection' && r.refId === refId).map((r) => r.at)),
    );
    setRunning(false);
    abortRef.current = null;
  };

  const stop = () => abortRef.current?.abort();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Collection
          <select
            value={colId}
            onChange={(e) => { setColId(e.target.value); setFolderId('all'); setResults([]); setIterations([]); setSkippedInfo({ n: 0, names: [] }); }}
            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5"
          >
            {collections.map((c) => {
              const d = dirs.find((x) => x.collectionIds.includes(c.id));
              return <option key={c.id} value={c.id}>{d ? `${d.name} / ${c.name}` : c.name}</option>;
            })}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Phạm vi
          <select
            value={folderId}
            onChange={(e) => { setFolderId(e.target.value); setResults([]); setIterations([]); setSkippedInfo({ n: 0, names: [] }); }}
            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5"
          >
            <option value="all">Tất cả ({list.length})</option>
            <option value="root">Ngoài thư mục ({col?.rootRequestIds.length ?? 0})</option>
            {col?.folders.map((f) => (
              <option key={f.id} value={f.id}>📁 {f.name} ({f.requestIds.length})</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Nghỉ giữa requests (ms)
          <input
            type="number" min={0} step={100} value={delayMs}
            onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))}
            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 w-28"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Timeout (s)
          <input
            type="number" min={5} max={300} value={timeoutS}
            onChange={(e) => setTimeoutS(Math.min(300, Math.max(5, Number(e.target.value) || 30)))}
            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 w-24"
          />
        </label>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={stopOnError} onChange={(e) => setStopOnError(e.target.checked)} />
          Dừng khi lỗi
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Data file (.csv/.json)
          <span className="flex items-center gap-2">
            <input
              type="file" accept=".csv,.json"
              onChange={(e) => onPickDataFile(e.target.files?.[0])}
              className="text-xs text-slate-400 file:bg-slate-800 file:border file:border-slate-700 file:rounded file:px-2 file:py-1 file:text-xs file:text-slate-200"
            />
            {dataFile && (
              <button
                onClick={() => { setDataFile(null); setDataError(''); setIterations([]); }}
                className="text-xs text-slate-500 hover:text-red-300"
              >
                ✕ Bỏ
              </button>
            )}
          </span>
        </label>
        {dataFile && (
          <label className="flex flex-col gap-1 text-sm">
            Số dòng (0=hết)
            <input
              type="number" min={0} max={dataFile.rows.length} value={maxRows}
              onChange={(e) => setMaxRows(Math.max(0, Number(e.target.value) || 0))}
              className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 w-24"
            />
          </label>
        )}
        <div className="flex gap-2 pb-0.5">
          {!running ? (
            <button
              onClick={start}
              disabled={!col || runCount === 0 || (dataFile != null && dataRows.length === 0)}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded px-4 py-1.5 font-semibold"
            >
              {dataFile ? `▶ Chạy data (${dataRows.length} dòng × ${runCount} req)` : `▶ Chạy (${runCount})`}
            </button>
          ) : (
            <button onClick={stop} className="bg-red-600 hover:bg-red-500 rounded px-4 py-1.5 font-semibold">
              ⏹ Dừng
            </button>
          )}
        </div>
      </div>

      {dataError && (
        <p className="text-xs text-red-400">Data file lỗi: {dataError}</p>
      )}
      {dataFile && (
        <div className="text-xs bg-violet-950/50 border border-violet-800 rounded px-3 py-2">
          <span className="font-semibold text-violet-300">📄 {dataFile.name}</span>
          <span className="text-violet-200/80"> — {dataFile.rows.length} dòng, cột: {dataFile.columns.join(', ')}</span>
          <ul className="mt-1 ml-4 list-disc text-violet-200/70 font-mono">
            {dataFile.rows.slice(0, 3).map((r, i) => (
              <li key={i}>#{i + 1} {rowSummary(r, dataFile.columns)}</li>
            ))}
            {dataFile.rows.length > 3 && <li>…và {dataFile.rows.length - 3} dòng nữa</li>}
          </ul>
          <p className="mt-1 text-violet-200/60">
            Mỗi dòng = 1 iteration chạy hết scope. Cột thắng env cùng tên; script đọc qua <span className="font-mono">pm.iterationData.get('tên_cột')</span>.
          </p>
        </div>
      )}

      <p className="text-xs text-slate-500">
        Môi trường: <b>{environments.find((e) => e.id === activeEnvId)?.name ?? '—'}</b> •
        biến do script set (pm.environment.set) được giữ lại giữa các request — tiện chuỗi login → dùng token.
        Biến do <b>flow trích</b> thì ở đây không có — request nào cần sẽ bị bỏ qua (xem cảnh báo dưới).
      </p>

      {blocked.length > 0 && (
        <div className="text-xs bg-amber-950/60 border border-amber-800 rounded px-3 py-2">
          <label className="flex items-center gap-2 font-semibold text-amber-300 cursor-pointer">
            <input type="checkbox" checked={skipMissing} onChange={(e) => setSkipMissing(e.target.checked)} />
            Bỏ qua {blocked.length} request thiếu biến {'{{...}}'} (chạy cũng lỗi) — muốn chạy thì sang tab Flow hoặc chuột phải vào collection 
          </label>
          <ul className="mt-1 ml-6 list-disc text-amber-200/90">
            {blocked.map((r) => (
              <li key={r.id}>
                {r.name} — thiếu: {missingOf(r).map((v) => `{{${v}}}`).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(results.length > 0 || running) && !dataFile && (
        <div className="text-sm bg-slate-950 border border-slate-800 rounded px-3 py-2 flex flex-wrap gap-x-4 gap-y-1">
          <span>Tiến độ: <b>{results.length}/{total}</b></span>
          <span>Request OK: <b className="text-emerald-400">{okCount}</b>/{results.length}</span>
          <span>Tests: <b className="text-emerald-400">{passTests}</b>/{totalTests}</span>
          <span>Tổng thời gian: <b>{totalTime}ms</b></span>
          {skippedInfo.n > 0 && (
            <span title={skippedInfo.names.join(', ')}>
              Bỏ qua thiếu biến: <b className="text-amber-300">{skippedInfo.n}</b>
            </span>
          )}
        </div>
      )}

      {dataFile && (iterations.length > 0 || running) && (
        <div className="text-sm bg-slate-950 border border-slate-800 rounded px-3 py-2 flex flex-wrap gap-x-4 gap-y-1">
          <span>Tiến độ: <b>{iterations.reduce((a, x) => a + x.items.length, 0)}/{dataTotal}</b></span>
          <span>Iteration OK: <b className="text-emerald-400">{iterations.filter((x) => x.ok).length}</b>/{iterations.length}</span>
          <span>Tests: <b className="text-emerald-400">{iterations.reduce((a, x) => a + x.passedTests, 0)}</b>/{iterations.reduce((a, x) => a + x.totalTests, 0)}</span>
          <span>Tổng thời gian: <b>{iterations.reduce((a, x) => a + x.timeMs, 0)}ms</b></span>
        </div>
      )}

      {dataFile && (
        <div className="flex flex-col gap-1.5">
          {iterations.map((it) => (
            <details key={it.rowIndex} className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm">
              <summary className="cursor-pointer">
                <span className="mr-1">{it.ok ? '✅' : '❌'}</span>
                <b>Dòng #{it.rowIndex + 1}</b>
                <span className="text-slate-400 font-mono text-xs ml-2">{rowSummary(it.row, dataFile.columns)}</span>
                <span className="text-slate-500 text-xs ml-2">
                  {it.items.filter((r) => r.ok).length}/{it.items.length} req • {it.passedTests}/{it.totalTests} tests • {it.timeMs}ms
                </span>
              </summary>
              <ul className="mt-1.5 ml-2 flex flex-col gap-1 border-l border-slate-800 pl-2 text-xs">
                {it.items.map((r, j) => (
                  <li key={j}>
                    <span className="mr-1">{r.ok ? '✅' : '❌'}</span>
                    <span className="font-mono font-bold text-sky-300">{r.method}</span>{' '}{r.name}
                    {r.status != null && <span className="text-slate-500"> → {r.status}</span>}
                    {r.testsTotal > 0 && <span className={r.testsPassed === r.testsTotal ? 'text-emerald-400' : 'text-red-400'}> tests {r.testsPassed}/{r.testsTotal}</span>}
                    {r.error && <span className="text-red-400"> — {r.error}</span>}
                  </li>
                ))}
              </ul>
            </details>
          ))}
          {running && (
            <p className="text-sm text-slate-400 animate-pulse">Đang chạy dòng {iterations.length + 1}/{dataRows.length}…</p>
          )}
          {!running && iterations.length === 0 && (
            <p className="text-sm text-slate-500">Chưa chạy. Nạp file data → bấm ▶.</p>
          )}
        </div>
      )}
      {!dataFile && (
      <div className="flex flex-col gap-1.5">
        {results.map((r, i) => (
          <div key={`${r.requestId}-${i}`} className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span>{r.ok ? '✅' : '❌'}</span>
              <span className="font-mono font-bold text-sky-300">{r.method}</span>
              <span className="font-medium">{r.name}</span>
              {r.status != null && <span className="text-slate-400">→ {r.status}</span>}
              {r.timeMs != null && <span className="text-slate-500">{r.timeMs}ms</span>}
              {r.testsTotal > 0 && (
                <span className={r.testsPassed === r.testsTotal ? 'text-emerald-400' : 'text-red-400'}>
                  tests {r.testsPassed}/{r.testsTotal}
                </span>
              )}
            </div>
            {r.error && <p className="text-red-400 text-xs mt-1 font-mono break-all">{r.error}</p>}
          </div>
        ))}
        {running && results.length < total && (
          <p className="text-sm text-slate-400 animate-pulse">Đang chạy {results.length + 1}/{total}…</p>
        )}
        {!running && results.length === 0 && (
          <p className="text-sm text-slate-500">Chưa chạy. Chọn collection → bấm ▶.</p>
        )}
      </div>
      )}

      {colRuns.length > 0 && (
        <div className="border-t border-slate-800 pt-3">
          <div className="flex items-center gap-2 mb-1.5">
            <h4 className="text-sm font-semibold">Lịch sử chạy tay ({colRuns.length})</h4>
            <button
              onClick={() => { if (confirm(`Xóa lịch sử chạy của “${col?.name} • ${scopeName}”?`)) clearRuns('collection', refId); }}
              className="text-xs text-slate-500 hover:text-red-300"
            >
              Xóa hết
            </button>
          </div>
          {colRuns.map((rec) => (
            <details key={rec.id} className="bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-sm mb-1.5">
              <summary className="cursor-pointer font-mono text-xs">
                {fmtTime(rec.at)} — OK{' '}
                <b className={rec.ok === rec.total ? 'text-emerald-400' : 'text-red-400'}>{rec.ok}/{rec.total}</b>
                {' '}• {rec.timeMs}ms{rec.stopped ? ' • dừng giữa chừng' : ''} ▸
              </summary>
              <ul className="mt-1.5 ml-2 flex flex-col gap-1 border-l border-slate-800 pl-2 text-xs">
                {rec.steps.map((st, i) => (
                  <li key={i}>
                    <span className="mr-1">{st.ok ? '✅' : '❌'}</span>
                    #{i + 1} {st.name}
                    {st.status !== undefined && <span className="text-slate-500"> {st.status}</span>}
                    {st.timeMs !== undefined && <span className="text-slate-600"> {st.timeMs}ms</span>}
                    {st.error && <span className="text-red-400"> — {st.error}</span>}
                    {st.bodyKey ? (
                      <button
                        onClick={() => setViewing({ key: st.bodyKey!, name: st.name, status: st.status, ct: st.contentType })}
                        className="block mt-0.5 text-sky-400 hover:text-sky-300"
                      >
                        📄 Xem body
                      </button>
                    ) : st.bodyOmitted ? (
                      <span className="block text-slate-600">(body quá to, không lưu)</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
      {viewing && (
        <ScheduleBodyModal
          bodyKey={viewing.key}
          stepName={viewing.name}
          status={viewing.status}
          contentType={viewing.ct}
          onClose={() => setViewing(null)}
        />
      )}

      <hr className="border-slate-800" />
      <h2 className="font-semibold">⏰ Chạy theo lịch</h2>
      <Scheduler />
    </div>
  );
}
