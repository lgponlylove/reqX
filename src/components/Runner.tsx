import { useMemo, useRef, useState } from 'react';
import { useAppStore } from '../stores/app';
import { useFlowStore } from '../stores/flow';
import { useTranslation, useLanguageStore } from '../stores/language';
import { runRequestList, runCollectionWithData, type RunItemResult, type DataIterationResult, type TeardownOutcome } from '../lib/runner';
import { parseDataFile, parseDataFileAsync, rowSummary } from '../lib/datafile';
import { confirmUntrustedScripts } from '../lib/scripts';
import { collectRequestVars } from '../lib/flow';
import { summarize } from '../lib/scheduleEngine';
import { saveBodies, pruneBodies } from '../lib/bodyStore';
import Scheduler from './Scheduler';
import ScheduleBodyModal from './ScheduleBodyModal';
import type { ApiRequest } from '../types/api';

/** Panel chạy cả collection/folder: tuần tự từng request kèm pre-request + tests. */
export default function Runner() {
  const { collections, dirs, requests, environments, activeEnvId, globals, envSecrets, globalSecrets, setEnvVar, setGlobal } = useAppStore();
  const { runs, pushRun, clearRuns } = useFlowStore();
  const { t } = useTranslation();
  const { language } = useLanguageStore();
  const [colId, setColId] = useState(collections[0]?.id ?? '');
  const [folderId, setFolderId] = useState<string>('all');
  const [delayMs, setDelayMs] = useState(0);
  const [timeoutS, setTimeoutS] = useState(30);
  const [stopOnError, setStopOnError] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunItemResult[]>([]);
  /** Script dọn dẹp của collection — data file thì 1 mục cho mỗi vòng. */
  const [teardowns, setTeardowns] = useState<TeardownOutcome[]>([]);
  // Data-driven (Postman: data file): mỗi dòng = 1 iteration chạy hết scope
  const [dataFile, setDataFile] = useState<{
    name: string;
    rows: Record<string, string>[];
    columns: string[];
    sheets?: string[];
    selectedSheet?: string;
    rawBuffer?: ArrayBuffer;
  } | null>(null);
  const [dataError, setDataError] = useState('');
  const [iterations, setIterations] = useState<DataIterationResult[]>([]);
  const [maxRows, setMaxRows] = useState(0); // 0 = chạy hết
  const [total, setTotal] = useState(0);
  const [contractTestingEnabled, setContractTestingEnabled] = useState(false);
  const [contractSpec, setContractSpec] = useState<{ name: string; spec: any } | null>(null);
  const [contractError, setContractError] = useState('');
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
    const activeSec = activeEnvId ? envSecrets[activeEnvId] ?? [] : [];
    return new Set([...Object.keys(env), ...activeSec, ...Object.keys(globals), ...(globalSecrets ?? []), ...(dataFile?.columns ?? [])]);
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
    folderId === 'all' ? t.runner.scopeAll
    : folderId === 'root' ? t.runner.scopeRoot
    : `📁 ${col?.folders.find((f) => f.id === folderId)?.name ?? '?'}`;
  const refId = `${colId}:${folderId}`;
  const colRuns = runs.filter((r) => r.kind === 'collection' && r.refId === refId);
  const fmtTime = (t: number) => new Date(t).toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US');

  const onPickDataFile = (f: File | undefined) => {
    if (!f) return;
    const isXlsx = f.name.toLowerCase().endsWith('.xlsx');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const raw = reader.result;
        if (!raw) return;
        const parsed = await parseDataFileAsync(raw, f.name);
        if (parsed.error || parsed.rows.length === 0) {
          setDataFile(null);
          setDataError(parsed.error ?? 'File không có dòng dữ liệu!');
          return;
        }
        setDataError('');
        setDataFile({
          name: f.name,
          rows: parsed.rows,
          columns: parsed.columns,
          sheets: parsed.sheets,
          selectedSheet: parsed.selectedSheet,
          rawBuffer: isXlsx && raw instanceof ArrayBuffer ? raw : undefined,
        });
        setIterations([]);
      } catch (err) {
        setDataFile(null);
        setDataError(err instanceof Error ? err.message : String(err));
      }
    };
    if (isXlsx) {
      reader.readAsArrayBuffer(f);
    } else {
      reader.readAsText(f);
    }
  };

  const onSelectExcelSheet = async (sheetName: string) => {
    if (!dataFile || !dataFile.rawBuffer) return;
    try {
      const parsed = await parseDataFileAsync(dataFile.rawBuffer, dataFile.name, sheetName);
      if (parsed.error || parsed.rows.length === 0) {
        setDataError(parsed.error ?? 'Sheet này không có dòng dữ liệu!');
        return;
      }
      setDataError('');
      setDataFile((prev) => prev ? {
        ...prev,
        rows: parsed.rows,
        columns: parsed.columns,
        selectedSheet: sheetName,
      } : null);
      setIterations([]);
    } catch (err) {
      setDataError(err instanceof Error ? err.message : String(err));
    }
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
    if (!confirmUntrustedScripts(runList, `Collection “${col.name}” • ${scopeName}`, collections)) return;
    setRunning(true);
    setResults([]);
    setIterations([]);
    setTeardowns([]);
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
        collections,
        signal: ctrl.signal,
        contractTesting: { enabled: contractTestingEnabled, spec: contractSpec?.spec },
        onIteration: (it) => setIterations((prev) => [...prev, it]),
        onTeardown: (o) => setTeardowns((prev) => [...prev, o]),
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
      collections,
      signal: ctrl.signal,
      contractTesting: { enabled: contractTestingEnabled, spec: contractSpec?.spec },
      onItem: (r) => {
        collected.push(r);
        setResults((prev) => [...prev, r]);
      },
      onTeardown: (o) => setTeardowns((prev) => [...prev, o]),
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
          {t.runner.collection}
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
          {t.runner.scope}
          <select
            value={folderId}
            onChange={(e) => { setFolderId(e.target.value); setResults([]); setIterations([]); setSkippedInfo({ n: 0, names: [] }); }}
            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5"
          >
            <option value="all">{t.runner.scopeAll} ({list.length})</option>
            <option value="root">{t.runner.scopeRoot} ({col?.rootRequestIds.length ?? 0})</option>
            {col?.folders.map((f) => (
              <option key={f.id} value={f.id}>📁 {f.name} ({f.requestIds.length})</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.runner.delay}
          <input
            type="number" min={0} step={100} value={delayMs}
            onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))}
            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 w-28"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.runner.timeout}
          <input
            type="number" min={5} max={300} value={timeoutS}
            onChange={(e) => setTimeoutS(Math.min(300, Math.max(5, Number(e.target.value) || 30)))}
            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 w-24"
          />
        </label>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={stopOnError} onChange={(e) => setStopOnError(e.target.checked)} />
          {t.runner.stopOnError}
        </label>
        <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={contractTestingEnabled}
            onChange={(e) => setContractTestingEnabled(e.target.checked)}
            className="rounded border-slate-700 text-emerald-500 focus:ring-0"
          />
          <span className="font-semibold text-emerald-400">🛡️ Contract Test (OpenAPI)</span>
        </label>
        {contractTestingEnabled && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-slate-300">OpenAPI Spec (Tùy chọn)</span>
            <span className="flex items-center gap-2">
              <input
                type="file"
                accept=".json,.yaml,.yml"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    try {
                      const spec = JSON.parse(String(reader.result ?? ''));
                      setContractSpec({ name: f.name, spec });
                      setContractError('');
                    } catch {
                      setContractError('Không thể đọc file OpenAPI JSON!');
                    }
                  };
                  reader.readAsText(f);
                }}
                className="text-xs text-slate-400 file:bg-slate-800 file:border file:border-slate-700 file:rounded file:px-2 file:py-1 file:text-xs file:text-slate-200"
              />
              {contractSpec && (
                <button
                  type="button"
                  onClick={() => setContractSpec(null)}
                  className="text-xs text-slate-500 hover:text-red-300"
                >
                  Gỡ file
                </button>
              )}
            </span>
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          {t.runner.dataFile}
          <span className="flex items-center gap-2">
            <input
              type="file" accept=".csv,.json,.xlsx"
              onChange={(e) => onPickDataFile(e.target.files?.[0])}
              className="text-xs text-slate-400 file:bg-slate-800 file:border file:border-slate-700 file:rounded file:px-2 file:py-1 file:text-xs file:text-slate-200"
            />
            {dataFile && (
              <button
                onClick={() => { setDataFile(null); setDataError(''); setIterations([]); }}
                className="text-xs text-slate-500 hover:text-red-300"
              >
                {t.runner.removeDataFile}
              </button>
            )}
          </span>
        </label>
        {dataFile && dataFile.sheets && dataFile.sheets.length > 1 && (
          <label className="flex flex-col gap-1 text-sm">
            <span>Sheet</span>
            <select
              value={dataFile.selectedSheet || dataFile.sheets[0]}
              onChange={(e) => onSelectExcelSheet(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200"
            >
              {dataFile.sheets.map((s) => (
                <option key={s} value={s}>📊 {s}</option>
              ))}
            </select>
          </label>
        )}
        {dataFile && (
          <label className="flex flex-col gap-1 text-sm">
            {t.runner.maxRows}
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
              {dataFile ? `▶ ${t.runner.runData} (${dataRows.length} ${t.runner.rows} × ${runCount} req)` : `▶ ${t.runner.run} (${runCount})`}
            </button>
          ) : (
            <button onClick={stop} className="bg-red-600 hover:bg-red-500 rounded px-4 py-1.5 font-semibold">
              ⏹ {t.runner.stop}
            </button>
          )}
        </div>
      </div>

      {contractTestingEnabled && (
        <div className="text-xs bg-emerald-950/40 border border-emerald-800/80 rounded px-3 py-2 flex items-center justify-between">
          <div>
            <span className="font-semibold text-emerald-300">🛡️ Contract Testing đang BẬT: </span>
            <span className="text-emerald-200/90">
              {contractSpec
                ? `Đang áp dụng spec "${contractSpec.name}". Mọi response sẽ được so sánh tự động với OpenAPI schema.`
                : 'Tự động kiểm thử response khớp với schema được khai báo trong request (OpenAPI import / JsonSchema).'}
            </span>
          </div>
          {contractError && <span className="text-rose-400 font-semibold">{contractError}</span>}
        </div>
      )}

      {dataError && (
        <p className="text-xs text-red-400">{t.runner.dataFileError} {dataError}</p>
      )}
      {dataFile && (
        <div className="text-xs bg-violet-950/50 border border-violet-800 rounded px-3 py-2">
          <span className="font-semibold text-violet-300">📄 {dataFile.name}</span>
          <span className="text-violet-200/80"> — {dataFile.rows.length} {t.runner.rows}, {t.runner.columns} {dataFile.columns.join(', ')}</span>
          <ul className="mt-1 ml-4 list-disc text-violet-200/70 font-mono">
            {dataFile.rows.slice(0, 3).map((r, i) => (
              <li key={i}>#{i + 1} {rowSummary(r, dataFile.columns)}</li>
            ))}
            {dataFile.rows.length > 3 && <li>{t.runner.andMoreRows.replace('{count}', String(dataFile.rows.length - 3))}</li>}
          </ul>
          <p className="mt-1 text-violet-200/60">
            {t.runner.iterationDataDesc}
          </p>
        </div>
      )}

      <p className="text-xs text-slate-500">
        {t.runner.envNotice.replace('{env}', environments.find((e) => e.id === activeEnvId)?.name ?? '—')}
      </p>

      {blocked.length > 0 && (
        <div className="text-xs bg-amber-950/60 border border-amber-800 rounded px-3 py-2">
          <label className="flex items-center gap-2 font-semibold text-amber-300 cursor-pointer">
            <input type="checkbox" checked={skipMissing} onChange={(e) => setSkipMissing(e.target.checked)} />
            {t.runner.skipMissingVars.replace('{count}', String(blocked.length)).replace('{vars}', '{{...}}')}
          </label>
          <ul className="mt-1 ml-6 list-disc text-amber-200/90">
            {blocked.map((r) => (
              <li key={r.id}>
                {r.name} — {t.runner.missing} {missingOf(r).map((v) => `{{${v}}}`).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Script dọn dẹp của collection — chạy cuối đợt, KHÔNG tính vào số request pass/fail */}
      {teardowns.length > 0 && (
        <div className="text-xs bg-slate-950 border border-slate-800 rounded px-3 py-2">
          <div className="flex items-center gap-3 flex-wrap">
            <b className="text-slate-300">🧹 Script dọn dẹp «{teardowns[0].collectionName}»</b>
            <span>
              <b className="text-emerald-400">{teardowns.filter((x) => !x.error).length}</b>/{teardowns.length} vòng sạch
            </span>
            {teardowns.some((x) => x.error) && (
              <span className="text-red-400">Lỗi: {teardowns.find((x) => x.error)!.error}</span>
            )}
          </div>
          {teardowns.some((x) => x.logs.length > 0) && (
            <details className="mt-1">
              <summary className="cursor-pointer text-slate-500">
                log console ({teardowns.reduce((a, x) => a + x.logs.length, 0)} dòng)
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-slate-400">
                {teardowns.flatMap((x) => x.logs).join('\n')}
              </pre>
            </details>
          )}
        </div>
      )}

      {(results.length > 0 || running) && !dataFile && (
        <div className="text-sm bg-slate-950 border border-slate-800 rounded px-3 py-2 flex items-center justify-between flex-wrap gap-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>{t.runner.progress} <b>{results.length}/{total}</b></span>
            <span>{t.runner.requestsOk} <b className="text-emerald-400">{okCount}</b>/{results.length}</span>
            <span>{t.runner.testsOk} <b className="text-emerald-400">{passTests}</b>/{totalTests}</span>
            <span>{t.runner.totalTime} <b>{totalTime}ms</b></span>
            {skippedInfo.n > 0 && (
              <span title={skippedInfo.names.join(', ')}>
                {t.runner.skippedMissing} <b className="text-amber-300">{skippedInfo.n}</b>
              </span>
            )}
          </div>

          {!running && results.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  const { saveExportBesideApp } = await import('../lib/response-file');
                  const d = new Date();
                  const pad = (n: number) => String(n).padStart(2, '0');
                  const fname = `reqx-runner-${col?.name || 'collection'}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.csv`;
                  const head = ['#', 'Request Name', 'Method', 'URL', 'Status', 'Time (ms)', 'Tests Passed', 'Tests Total', 'Result', 'Error'];
                  const lines = results.map((r, i) => [
                    i + 1,
                    `"${(r.name || '').replace(/"/g, '""')}"`,
                    r.method,
                    `"${r.url.replace(/"/g, '""')}"`,
                    r.status ?? '',
                    r.timeMs ?? '',
                    r.testsPassed,
                    r.testsTotal,
                    r.ok ? 'PASS' : 'FAIL',
                    `"${(r.error || '').replace(/"/g, '""')}"`,
                  ].join(','));
                  const csv = '\uFEFF' + head.join(',') + '\n' + lines.join('\n');
                  const saved = await saveExportBesideApp(fname, csv);
                  if (!saved) {
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fname;
                    a.click();
                  } else {
                    alert(t.runner.exportedCsvAlert.replace('{path}', saved.path));
                  }
                }}
                className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 font-semibold"
                title={t.runner.exportCsvTitle}
              >
                {t.runner.exportCsv}
              </button>
              <button
                onClick={async () => {
                  const { generateRunnerHtmlReport } = await import('../lib/reporter');
                  const { saveExportBesideApp } = await import('../lib/response-file');
                  const html = generateRunnerHtmlReport({
                    collectionName: col?.name || 'Collection',
                    scopeName,
                    results,
                    totalTimeMs: totalTime,
                    environmentName: environments.find((e) => e.id === activeEnvId)?.name,
                    lang: language,
                  });
                  const d = new Date();
                  const pad = (n: number) => String(n).padStart(2, '0');
                  const slug = (col?.name || 'collection')
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^a-z0-9_-]+/g, '-')
                    .replace(/^-|-$/g, '') || 'collection';
                  const fname = `reqx-runner-report-${slug}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.html`;
                  const saved = await saveExportBesideApp(fname, html);
                  if (!saved) {
                    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fname;
                    a.click();
                  } else {
                    alert(t.runner.exportedHtmlAlert.replace('{path}', saved.path));
                  }
                }}
                className="px-2.5 py-1 rounded bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-slate-950 font-bold text-xs shadow-md shadow-emerald-950 flex items-center gap-1"
                title={t.runner.exportHtmlTitle}
              >
                <span>📄</span>
                <span>{t.runner.exportHtml}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {dataFile && (iterations.length > 0 || running) && (
        <div className="text-sm bg-slate-950 border border-slate-800 rounded px-3 py-2 flex flex-wrap gap-x-4 gap-y-1">
          <span>{t.runner.progress} <b>{iterations.reduce((a, x) => a + x.items.length, 0)}/{dataTotal}</b></span>
          <span>{t.runner.iterationOk} <b className="text-emerald-400">{iterations.filter((x) => x.ok).length}</b>/{iterations.length}</span>
          <span>{t.runner.testsOk} <b className="text-emerald-400">{iterations.reduce((a, x) => a + x.passedTests, 0)}</b>/{iterations.reduce((a, x) => a + x.totalTests, 0)}</span>
          <span>{t.runner.totalTime} <b>{iterations.reduce((a, x) => a + x.timeMs, 0)}ms</b></span>
        </div>
      )}

      {dataFile && (
        <div className="flex flex-col gap-1.5">
          {iterations.map((it) => (
            <details key={it.rowIndex} className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm">
              <summary className="cursor-pointer">
                <span className="mr-1">{it.ok ? '✅' : '❌'}</span>
                <b>{language === 'vi' ? 'Dòng' : 'Row'} #{it.rowIndex + 1}</b>
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
            <p className="text-sm text-slate-400 animate-pulse">{t.runner.runningRow.replace('{current}', String(iterations.length + 1)).replace('{total}', String(dataRows.length))}</p>
          )}
          {!running && iterations.length === 0 && (
            <p className="text-sm text-slate-500">{t.runner.emptyDataPrompt}</p>
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
          <p className="text-sm text-slate-400 animate-pulse">{t.runner.runningPrompt.replace('{current}', String(results.length + 1)).replace('{total}', String(total))}</p>
        )}
        {!running && results.length === 0 && (
          <p className="text-sm text-slate-500">{t.runner.emptyPrompt}</p>
        )}
      </div>
      )}

      {colRuns.length > 0 && (
        <div className="border-t border-slate-800 pt-3">
          <div className="flex items-center gap-2 mb-1.5">
            <h4 className="text-sm font-semibold">{t.runner.historyTitle} ({colRuns.length})</h4>
            <button
              onClick={() => { if (confirm(t.runner.clearHistoryConfirm.replace('{name}', `${col?.name} • ${scopeName}`))) clearRuns('collection', refId); }}
              className="text-xs text-slate-500 hover:text-red-300"
            >
              {t.runner.clearHistory}
            </button>
          </div>
          {colRuns.map((rec) => (
            <details key={rec.id} className="bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-sm mb-1.5">
              <summary className="cursor-pointer font-mono text-xs">
                {fmtTime(rec.at)} — OK{' '}
                <b className={rec.ok === rec.total ? 'text-emerald-400' : 'text-red-400'}>{rec.ok}/{rec.total}</b>
                {' '}• {rec.timeMs}ms{rec.stopped ? t.runner.stoppedMidway : ''} ▸
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
                        {t.runner.viewBody}
                      </button>
                    ) : st.bodyOmitted ? (
                      <span className="block text-slate-600">{t.runner.bodyTooLarge}</span>
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
      <h2 className="font-semibold">{t.runner.scheduleHeader}</h2>
      <Scheduler />
    </div>
  );
}
