import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../stores/app';
import { useFlowStore } from '../stores/flow';
import { useRequestStore } from '../stores/request';
import { useTranslation } from '../stores/language';
import { runFlow, sampleRule, parseFlowJson, FLOW_JSON_SAMPLE, analyzeFlow, buildReqxFlowExport, parseReqxFlowFile, mergeReqxImport, type FlowStepResult } from '../lib/flow';
import { collectRequests } from '../lib/runner';
import { confirmUntrustedScripts } from '../lib/scripts';
import { importPostmanCollection } from '../lib/postman-io';
import { recordManualFlowRun } from '../lib/flow-runs';
import ScheduleBodyModal from './ScheduleBodyModal';
import FlowTimelineView from './FlowTimelineView';
import type { ApiRequest, Collection, ExtractFrom, StepConditionOp } from '../types/api';

const FROM_OPTS: { id: ExtractFrom; label: string; hint: string }[] = [
  { id: 'body-json', label: 'JSON body', hint: 'vd data.access_token (mảng: items.0.id)' },
  { id: 'header', label: 'Header', hint: 'vd x-request-id' },
  { id: 'status', label: 'Status', hint: 'lấy status code, bỏ trống path' },
  { id: 'body-text', label: 'Text/Regex', hint: 'regex, lấy group 1 — dùng cho XML/text' },
];

/** Tên request kèm folder để hiện trong dropdown chọn step. */
function requestOptions(col: Collection, requests: Record<string, ApiRequest>): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const id of col.rootRequestIds) {
    const r = requests[id];
    if (r) out.push({ id, label: `${r.method} ${r.name}` });
  }
  for (const f of col.folders) {
    for (const id of f.requestIds) {
      const r = requests[id];
      if (r) out.push({ id, label: `📁${f.name} · ${r.method} ${r.name}` });
    }
  }
  return out;
}

/** Chuỗi request: step tham chiếu request có sẵn, trích giá trị truyền sang step sau. */
export default function Flow({ onGoBuilder }: { onGoBuilder?: () => void }) {
  const { collections, dirs, requests, environments, activeEnvId, globals, envSecrets, globalSecrets } = useAppStore();
  const { t } = useTranslation();
  const {
    flows, activeFlowId, addFlow, renameFlow, deleteFlow, setActiveFlow,
    addStep, updateStep, removeStep, moveStep, addRule, updateRule, removeRule, importFlow,
    runs, clearRuns, runSignal, consumeRunSignal,
  } = useFlowStore();
  const [flowName, setFlowName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [timeoutS, setTimeoutS] = useState(30);
  const [delayMs, setDelayMs] = useState(0);
  const [stopOnError, setStopOnError] = useState(true);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<FlowStepResult[]>([]);
  const [resultViewMode, setResultViewMode] = useState<'timeline' | 'list'>('timeline');
  const [flowVars, setFlowVars] = useState<Record<string, string>>({});
  const [openRules, setOpenRules] = useState<Record<string, boolean>>({});
  const [openConditions, setOpenConditions] = useState<Record<string, boolean>>({});
  const [openRetries, setOpenRetries] = useState<Record<string, boolean>>({});
  const [viewing, setViewing] = useState<{ key: string; name: string; status?: number; ct?: string } | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [fromColId, setFromColId] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  const [wizName, setWizName] = useState('');
  const [wizColId, setWizColId] = useState('');
  const [wizPicked, setWizPicked] = useState<string[]>([]);
  const [wizVars, setWizVars] = useState<Record<string, string>>({});
  const [wizMsg, setWizMsg] = useState('');
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const abortRef = useRef<AbortController | null>(null);

  const flow = flows.find((f) => f.id === activeFlowId) ?? flows[0] ?? null;
  const activeSteps = flow?.steps.filter((s) => !s.disabled).length ?? 0;

  const start = async () => {
    if (!flow || activeSteps === 0 || running) return;
    // Script từ file import (chưa rõ nguồn gốc) → hỏi trước khi chạy hàng loạt
    const stepReqs = flow.steps.flatMap((s) => {
      const r = requests[s.requestId];
      return r ? [r] : [];
    });
    if (!confirmUntrustedScripts(stepReqs, `Flow “${flow.name}”`, collections)) return;
    setRunning(true);
    setResults([]);
    setFlowVars({});
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const baseHooks = {
      getVars: () => {
        const s = useAppStore.getState();
        return {
          envVars: { ...(s.environments.find((e) => e.id === s.activeEnvId)?.variables ?? {}) },
          globals: { ...s.globals },
        };
      },
      setGlobal: (k: string, v: string) => useAppStore.getState().setGlobal(k, v),
    };
    const t0 = performance.now();
    const { results: out, flowVars: vars } = await runFlow(flow, requests, baseHooks, {
      timeoutMs: timeoutS * 1000,
      delayMs,
      stopOnError,
      collections,
      signal: ctrl.signal,
      onStep: (r) => setResults((prev) => [...prev, r]),
    });
    const at = Date.now();
    await recordManualFlowRun(flow.id, flow.name, at, out, performance.now() - t0, ctrl.signal.aborted || undefined);
    setResults(out);
    setFlowVars(vars);
    setRunning(false);
    abortRef.current = null;
  };

  const okCount = results.filter((r) => r.ok).length;
  const flowRuns = flow ? runs.filter((r) => r.kind === 'flow' && r.refId === flow.id) : [];
  const fmtTime = (t: number) => new Date(t).toLocaleString('vi-VN');

  // Chuột phải collection ở Sidebar → "Chạy flow": nhảy sang tab này và chạy luôn
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    if (!runSignal || !flow || runSignal.flowId !== flow.id || running) return;
    consumeRunSignal();
    void startRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSignal, flow?.id, running]);

  /** Biến {{x}} dùng mà không có ở env/globals và không step nào trước đó trích ra. */
  const varIssues = useMemo(() => {
    if (!flow) return [];
    const env = environments.find((e) => e.id === activeEnvId);
    const envVars = {
      ...(env?.variables ?? {}),
      ...Object.fromEntries((activeEnvId ? envSecrets[activeEnvId] ?? [] : []).map((k) => [k, ''])),
    };
    const allGlobals = {
      ...globals,
      ...Object.fromEntries((globalSecrets ?? []).map((k) => [k, ''])),
    };
    return analyzeFlow(flow, requests, { envVars, globals: allGlobals });
  }, [flow, requests, environments, activeEnvId, globals, envSecrets, globalSecrets]);

  /** Step gần nhất TRƯỚC index cho trước (để gắn rule trích). */
  const prevStepFor = (index: number) => {
    if (!flow) return null;
    for (let i = index - 1; i >= 0; i--) {
      const st = flow.steps[i];
      if (!st.disabled && requests[st.requestId]) return st;
    }
    return null;
  };

  /** Thêm nhanh rule body-json name=path=var (đúng cho response JSON phẳng). */
  const quickAddRules = (targetId: string, vars: string[]) => {
    if (!flow) return;
    for (const v of vars) addRule(flow.id, targetId, { ...sampleRule(), name: v, path: v });
    setOpenRules((p) => ({ ...p, [targetId]: true }));
  };

  /** Tìm collection chứa request (để import JSON chỉ cần requestId). */
  const collectionOf = (requestId: string) =>
    collections.find((c) => c.rootRequestIds.includes(requestId) || c.folders.some((f) => f.requestIds.includes(requestId)))?.id;

  const doImportJson = () => {
    const { data, warnings, error } = parseFlowJson(importText, requests);
    if (data) {
      importFlow(data, collectionOf);
      setImportMsg(`✅ Đã tạo flow “${data.name}” (${data.steps.length} steps)${warnings.length ? ` • ⚠ ${warnings.join(' | ')}` : ''}`);
      setImportText('');
      return;
    }
    // Không phải flow JSON? Thử hiểu là collection Postman (có `item`) → import luôn + tạo flow 1 bước
    let raw: unknown;
    try {
      raw = JSON.parse(importText);
    } catch {
      setImportMsg(`❌ ${error ?? 'JSON sai cú pháp'}`);
      return;
    }
    // File ReqX gộp (requests + flow + curl) → so khớp request đã có, thiếu mới tạo thêm
    if (raw && typeof raw === 'object' && (raw as { kind?: unknown }).kind === 'reqx-flow') {
      const { data: rd, warnings: rw, error: re } = parseReqxFlowFile(raw);
      if (re || !rd) {
        setImportMsg(`❌ ${re ?? 'file lỗi'}`);
        return;
      }
      const merged = mergeReqxImport(rd, requests);
      const parts: string[] = [];
      if (merged.reused.length > 0) parts.push(`dùng lại ${merged.reused.length} request đã có (${merged.reused.slice(0, 5).join(', ')}${merged.reused.length > 5 ? '…' : ''})`);
      if (merged.collection) {
        useAppStore.getState().importData(merged.collection, merged.requests);
        parts.push(`thêm mới ${merged.requests.length} request vào collection “${merged.collection.name}”`);
      }
      importFlow(merged.flowData, collectionOf);
      setImportMsg(`✅ Đã tạo flow “${merged.flowData.name}” (${merged.flowData.steps.length} steps) • ${parts.join(' • ') || 'không có gì mới'}${rw.length ? ` • ⚠ ${rw.join(' | ')}` : ''}`);
      setImportText('');
      return;
    }
    if (raw && typeof raw === 'object' && Array.isArray((raw as { item?: unknown }).item)) {
      try {
        const { collection: col, requests: reqs } = importPostmanCollection(raw);
        const byId = Object.fromEntries(reqs.map((r) => [r.id, r]));
        const list = collectRequests(col, byId, 'all');
        if (list.length === 0) {
          setImportMsg('❌ Collection này không có request nào');
          return;
        }
        useAppStore.getState().importData(col, reqs);
        importFlow(
          { name: `${col.name} (flow)`, steps: list.map((r) => ({ requestId: r.id, extract: [] })) },
          () => col.id,
        );
        setImportMsg(`✅ Đã import collection “${col.name}” + tạo flow (${list.length} steps — thêm rule trích bằng nút ⎋)`);
        setImportText('');
      } catch (e) {
        setImportMsg(`❌ Collection lỗi: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    setImportMsg(`❌ ${error ?? 'lỗi không rõ'}`);
  };

  const doFromCollection = () => {
    const col = collections.find((c) => c.id === fromColId);
    if (!col) return;
    const list = collectRequests(col, requests, 'all');
    if (list.length === 0) {
      setImportMsg('❌ Collection này chưa có request');
      return;
    }
    importFlow(
      { name: `${col.name} (flow)`, steps: list.map((r) => ({ requestId: r.id, extract: [] })) },
      collectionOf,
    );
    setImportMsg(`✅ Đã tạo flow từ “${col.name}” (${list.length} steps — thêm rule trích bằng nút ⎋)`);
  };

  /** 🧙 Wizard cho người mới: tick request theo thứ tự → gõ tên biến cần trích → xong, không cần JSON. */
  const wizCol = collections.find((c) => c.id === wizColId) ?? null;
  const wizList = wizCol ? collectRequests(wizCol, requests, 'all') : [];
  const toggleWizPick = (id: string) =>
    setWizPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const doWizardCreate = () => {
    if (!wizCol) {
      setWizMsg('❌ Chọn collection ở bước 2 trước');
      return;
    }
    const picked = wizPicked.filter((id) => requests[id]);
    if (picked.length === 0) {
      setWizMsg('❌ Tick ít nhất 1 request ở bước 2');
      return;
    }
    const varsOf = (id: string) =>
      (wizVars[id] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const name = wizName.trim() || `${wizCol.name} (flow)`;
    importFlow(
      {
        name,
        steps: picked.map((id) => ({
          requestId: id,
          extract: varsOf(id).map((v) => ({ name: v, from: 'body-json' as const, path: v })),
        })),
      },
      collectionOf,
    );
    setWizMsg(`✅ Đã tạo flow “${name}” (${picked.length} steps). Muốn trích sâu (vd data.token)? Mở step, bấm ⎋ rồi sửa ô path.`);
    setWizPicked([]);
    setWizVars({});
  };

  /** Mở modal export (hiện JSON + tải file) — clipboard trong Tauri hay bị chặn nên không copy trực tiếp nữa. */
  const doExport = () => {
    if (!flow) return;
    // curl export giữ nguyên {{var}} (resolve với env rỗng) để máy khác dùng được
    setExportJson(JSON.stringify(buildReqxFlowExport(flow, requests), null, 2));
    setCopied('idle');
  };

  const copyExport = async () => {
    if (!exportJson) return;
    try {
      await navigator.clipboard.writeText(exportJson);
      setCopied('ok');
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = exportJson;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        setCopied('ok');
      } catch {
        setCopied('fail');
      }
    }
    setTimeout(() => setCopied((c) => (c === 'fail' ? c : 'idle')), 2000);
  };

  const downloadExport = () => {
    if (!exportJson || !flow) return;
    const blob = new Blob([exportJson], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${flow.name}.reqx-flow.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Chọn + CRUD flow */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Flow
          <select
            value={flow?.id ?? ''}
            onChange={(e) => { setActiveFlow(e.target.value || null); setResults([]); setFlowVars({}); }}
            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 min-w-48"
          >
            {flows.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.steps.length})</option>)}
            {flows.length === 0 && <option value="">{t.flow.selectFlow}</option>}
          </select>
        </label>
        <div className="flex gap-1">
          <input
            value={flowName}
            onChange={(e) => setFlowName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && flowName.trim()) { addFlow(flowName); setFlowName(''); } }}
            placeholder={t.flow.newFlowPlaceholder}
            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-sm w-36"
          />
          <button onClick={() => { if (flowName.trim()) { addFlow(flowName); setFlowName(''); } }} className="bg-emerald-700 hover:bg-emerald-600 rounded px-2.5 py-1.5 text-sm">＋</button>
        </div>
        {flow && (
          <>
            {editingName ? (
              <input
                autoFocus defaultValue={flow.name}
                onBlur={(e) => { renameFlow(flow.id, e.target.value); setEditingName(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="bg-slate-900 border border-emerald-600 rounded px-2 py-1.5 text-sm w-40"
              />
            ) : (
              <button onClick={() => setEditingName(true)} title={t.flow.renameTitle} className="bg-slate-800 hover:bg-slate-700 rounded px-2.5 py-1.5 text-sm">✎</button>
            )}
            <button
              onClick={() => { if (confirm(t.flow.deleteConfirm.replace('{name}', flow.name)) && flow) deleteFlow(flow.id); }}
              title={t.flow.deleteTitle}
              className="bg-slate-800 hover:bg-red-800 rounded px-2.5 py-1.5 text-sm"
            >
              🗑 {t.common.delete}
            </button>
          </>
        )}
        <div className="flex gap-1 pb-1">
          <button onClick={() => { setShowImport((v) => !v); setImportMsg(''); }} className="bg-slate-800 hover:bg-slate-700 rounded px-2.5 py-1.5 text-sm">{t.flow.importButton}</button>
          <button onClick={() => { setShowWizard((v) => !v); setWizMsg(''); }} title={t.flow.wizardTitle} className="bg-slate-800 hover:bg-slate-700 rounded px-2.5 py-1.5 text-sm">{t.flow.wizardButton}</button>
          {flow && (
            <button onClick={doExport} title={t.flow.exportTitle} className="bg-slate-800 hover:bg-slate-700 rounded px-2.5 py-1.5 text-sm">{t.flow.exportButton}</button>
          )}
        </div>
        {exportJson !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setExportJson(null)}>
            <div className="bg-slate-900 border border-slate-700 rounded max-w-2xl w-full flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800 text-sm">
                <b>
                  ⤴ Export “{flow?.name}”
                  {flow && (
                    <span className="font-normal text-slate-400">
                      {' '}({flow.steps.length} steps • {flow.steps.reduce((a, s) => a + s.extract.length, 0)} rules)
                    </span>
                  )}
                </b>
                <span className="ml-auto flex gap-1.5">
                  <button onClick={copyExport} className="bg-slate-800 hover:bg-slate-700 rounded px-2.5 py-1 text-xs">
                    {copied === 'ok' ? t.common.copied : copied === 'fail' ? 'Copy error' : t.common.copy}
                  </button>
                  <button onClick={downloadExport} className="bg-emerald-700 hover:bg-emerald-600 rounded px-2.5 py-1 text-xs">{t.flow.downloadJson}</button>
                  <button onClick={() => setExportJson(null)} className="bg-slate-800 hover:bg-slate-700 rounded px-2.5 py-1 text-xs">✕</button>
                </span>
              </div>
              <textarea
                readOnly
                value={exportJson}
                rows={16}
                spellCheck={false}
                onFocus={(e) => e.target.select()}
                className="m-3 bg-slate-950 border border-slate-700 rounded p-2 font-mono text-xs"
              />
            </div>
          </div>
        )}
      </div>

      {/* Panel import */}
      {showImport && (
        <div className="border border-slate-700 rounded p-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              {t.flow.fromCollection}
              <span className="flex gap-1">
                <select
                  value={fromColId}
                  onChange={(e) => setFromColId(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm max-w-56"
                >
                  <option value="">{t.flow.selectCollection}</option>
                  {collections.map((c) => {
                    const d = dirs.find((x) => x.collectionIds.includes(c.id));
                    return <option key={c.id} value={c.id}>{d ? `${d.name} / ${c.name}` : c.name}</option>;
                  })}
                </select>
                <button onClick={doFromCollection} disabled={!fromColId} className="bg-emerald-700 hover:bg-emerald-600 rounded px-2.5 py-1.5 text-sm disabled:opacity-40">{t.flow.create}</button>
              </span>
            </label>
            <button onClick={() => setImportText(FLOW_JSON_SAMPLE)} className="bg-slate-800 hover:bg-slate-700 rounded px-2.5 py-1.5 text-sm">{t.flow.sampleJson}</button>
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={t.flow.importJsonPlaceholder}
            rows={6}
            spellCheck={false}
            className="bg-slate-950 border border-slate-700 rounded p-2 font-mono text-xs w-full"
          />
          <div className="flex items-center gap-2">
            <button onClick={doImportJson} disabled={!importText.trim()} className="bg-emerald-700 hover:bg-emerald-600 rounded px-3 py-1.5 text-sm disabled:opacity-40">{t.flow.createFromJson}</button>
            {importMsg && <span className="text-xs">{importMsg}</span>}
          </div>
          <p className="text-[11px] text-slate-500">
            {t.flow.importHelp}
          </p>
        </div>
      )}

      {/* Panel wizard cho người mới */}
      {showWizard && (
        <div className="border border-emerald-800 rounded p-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1 text-sm">
            <b>{t.flow.wizStep1}</b>
            <input
              value={wizName}
              onChange={(e) => setWizName(e.target.value)}
              placeholder={t.flow.wizStep1Placeholder}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm max-w-96"
            />
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <b>{t.flow.wizStep2}</b>
            <select
              value={wizColId}
              onChange={(e) => { setWizColId(e.target.value); setWizPicked([]); setWizVars({}); }}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm max-w-96"
            >
              <option value="">{t.flow.selectCollection}</option>
              {collections.map((c) => {
                const d = dirs.find((x) => x.collectionIds.includes(c.id));
                return <option key={c.id} value={c.id}>{d ? `${d.name} / ${c.name}` : c.name}</option>;
              })}
            </select>
            {wizCol && (
              <div className="flex flex-col gap-1 border border-slate-800 rounded p-2 max-h-56 overflow-auto">
                {wizList.length === 0 && <span className="text-slate-500 text-xs">{t.flow.wizEmptyCol}</span>}
                {wizList.map((r) => {
                  const on = wizPicked.includes(r.id);
                  return (
                    <div key={r.id} className={`flex flex-col gap-1 rounded px-2 py-1 ${on ? 'bg-emerald-950' : ''}`}>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={on} onChange={() => toggleWizPick(r.id)} className="accent-emerald-600" />
                        {on && <span className="font-mono text-xs text-emerald-400">#{wizPicked.indexOf(r.id) + 1}</span>}
                        <span className="font-mono text-xs text-slate-400 w-12">{r.method}</span>
                        <span className={on ? '' : 'text-slate-300'}>{r.name}</span>
                      </label>
                      {on && (
                        <input
                          value={wizVars[r.id] ?? ''}
                          onChange={(e) => setWizVars((p) => ({ ...p, [r.id]: e.target.value }))}
                          placeholder={t.flow.wizVarPlaceholder}
                          className="ml-6 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="text-sm">
            <b>{t.flow.wizStep3}</b>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {t.flow.wizStep3Help}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={doWizardCreate} className="bg-emerald-700 hover:bg-emerald-600 rounded px-3 py-1.5 text-sm">{t.flow.wizCreateButton}</button>
            {wizMsg && <span className="text-xs">{wizMsg}</span>}
          </div>
        </div>
      )}

      {!flow ? (
        <p className="text-slate-400 text-sm">{t.flow.emptyFlowPrompt}</p>
      ) : (
        <>
          {/* Danh sách steps */}
          <div className="flex flex-col gap-2">
            {flow.steps.map((st, i) => {
              const col = collections.find((c) => c.id === st.collectionId);
              const opts = col ? requestOptions(col, requests) : [];
              const req = requests[st.requestId];
              const showRules = openRules[st.id] ?? st.extract.length > 0;
              const showCondition = !!openConditions[st.id];
              const showRetry = !!openRetries[st.id];
              return (
                <div key={st.id} className={`border rounded p-2.5 flex flex-col gap-2 ${st.disabled ? 'border-slate-800 opacity-50' : 'border-slate-700'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-500 w-6">#{i + 1}</span>
                    <select
                      value={st.collectionId}
                      onChange={(e) => {
                        const nc = collections.find((c) => c.id === e.target.value);
                        const first = nc ? requestOptions(nc, requests)[0]?.id ?? '' : '';
                        updateStep(flow.id, st.id, { collectionId: e.target.value, requestId: first });
                      }}
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm max-w-52"
                    >
                      {collections.map((c) => {
                        const d = dirs.find((x) => x.collectionIds.includes(c.id));
                        return <option key={c.id} value={c.id}>{d ? `${d.name} / ${c.name}` : c.name}</option>;
                      })}
                    </select>
                    <select
                      value={st.requestId}
                      onChange={(e) => updateStep(flow.id, st.id, { requestId: e.target.value })}
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm flex-1 min-w-40"
                    >
                      <option value="">{t.flow.selectRequest}</option>
                      {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                    {!req && st.requestId !== '' && <span className="text-red-400 text-xs">{t.flow.requestDeleted}</span>}
                    {req && (
                      <button
                        onClick={() => { useRequestStore.getState().load(req); onGoBuilder?.(); }}
                        title={t.flow.editInBuilderTitle}
                        className="rounded px-2 py-1 text-xs bg-slate-800 hover:bg-sky-800 shrink-0"
                      >
                        {t.flow.editInBuilder}
                      </button>
                    )}
                    <button
                      onClick={() => setOpenRules((p) => ({ ...p, [st.id]: !showRules }))}
                      title={t.flow.extractRuleTitle}
                      className={`rounded px-2 py-1 text-xs ${st.extract.length > 0 ? 'bg-emerald-800' : 'bg-slate-800 hover:bg-slate-700'}`}
                    >
                      ⎋ {st.extract.length}
                    </button>
                    <button
                      onClick={() => setOpenConditions((p) => ({ ...p, [st.id]: !showCondition }))}
                      title="Cấu hình rẽ nhánh theo điều kiện"
                      className={`rounded px-2 py-1 text-xs flex items-center gap-1 ${
                        st.condition?.enabled ? 'bg-sky-800 text-sky-200 font-bold' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      <span>🔀</span>
                      <span>{st.condition?.enabled ? 'Rẽ nhánh' : 'Điều kiện'}</span>
                    </button>
                    <button
                      onClick={() => setOpenRetries((p) => ({ ...p, [st.id]: !showRetry }))}
                      title="Cấu hình tự động chạy lại khi lỗi"
                      className={`rounded px-2 py-1 text-xs flex items-center gap-1 ${
                        st.retry?.enabled ? 'bg-amber-800 text-amber-200 font-bold' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      <span>🔄</span>
                      <span>{st.retry?.enabled ? `x${st.retry.maxAttempts}` : 'Retry'}</span>
                    </button>
                    {st.extract.length > 0 && !showRules && (
                      <span title="Extracted vars" className="text-[11px] font-mono text-emerald-400 truncate max-w-44">
                        → {st.extract.map((r) => `{{${r.name}}}`).join(' ')}
                      </span>
                    )}
                    <button onClick={() => updateStep(flow.id, st.id, { disabled: !st.disabled })} title={t.flow.toggleStepTitle} className="rounded px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700">
                      {st.disabled ? '⏸' : '▶'}
                    </button>
                    <button onClick={() => moveStep(flow.id, st.id, -1)} disabled={i === 0} className="rounded px-1.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-30">▲</button>
                    <button onClick={() => moveStep(flow.id, st.id, 1)} disabled={i === flow.steps.length - 1} className="rounded px-1.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-30">▼</button>
                    <button onClick={() => removeStep(flow.id, st.id)} title={t.flow.deleteStepTitle} className="rounded px-1.5 py-1 text-xs bg-slate-800 hover:bg-red-800">✕</button>
                  </div>
                  {showRules && (
                    <div className="ml-8 flex flex-col gap-1.5 border-l-2 border-emerald-800 pl-3">
                      {st.extract.map((r) => (
                        <div key={r.id} className="flex flex-wrap items-center gap-1.5 text-sm">
                          <span className="text-slate-500 text-xs">{'{{'}</span>
                          <input
                            value={r.name}
                            onChange={(e) => updateRule(flow.id, st.id, r.id, { name: e.target.value })}
                            placeholder="var_name"
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm w-28 font-mono"
                          />
                          <span className="text-slate-500 text-xs">{'}}'} =</span>
                          <select
                            value={r.from}
                            onChange={(e) => updateRule(flow.id, st.id, r.id, { from: e.target.value as ExtractFrom })}
                            className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-sm"
                          >
                            {FROM_OPTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                          </select>
                          <input
                            value={r.path}
                            onChange={(e) => updateRule(flow.id, st.id, r.id, { path: e.target.value })}
                            placeholder={FROM_OPTS.find((o) => o.id === r.from)?.hint}
                            disabled={r.from === 'status'}
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm flex-1 min-w-32 font-mono disabled:opacity-40"
                          />
                          <button onClick={() => removeRule(flow.id, st.id, r.id)} className="text-slate-500 hover:text-red-400 text-xs px-1">✕</button>
                        </div>
                      ))}
                      <button onClick={() => addRule(flow.id, st.id, sampleRule())} className="self-start text-xs text-emerald-400 hover:text-emerald-300">{t.flow.addRule}</button>
                      <p className="text-[11px] text-slate-500">{t.flow.ruleHelp}</p>
                    </div>
                  )}

                  {/* Condition & Branching Panel */}
                  {showCondition && (
                    <div className="ml-8 flex flex-col gap-2 border-l-2 border-sky-800 pl-3 bg-sky-950/20 p-2.5 rounded-r">
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-sky-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={st.condition?.enabled ?? false}
                            onChange={(e) => updateStep(flow.id, st.id, {
                              condition: {
                                enabled: e.target.checked,
                                varName: st.condition?.varName ?? '',
                                operator: st.condition?.operator ?? '==',
                                value: st.condition?.value ?? '',
                                onFalse: st.condition?.onFalse ?? 'skip',
                                jumpStepId: st.condition?.jumpStepId,
                              }
                            })}
                            className="rounded text-sky-500"
                          />
                          <span>Kiểm tra điều kiện trước khi chạy (Pre-condition)</span>
                        </label>
                      </div>
                      {st.condition?.enabled && (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-slate-400">Nếu biến</span>
                          <div className="flex items-center">
                            <span className="text-slate-500 font-mono text-xs">{'{{'}</span>
                            <input
                              value={st.condition.varName}
                              onChange={(e) => updateStep(flow.id, st.id, {
                                condition: { ...st.condition!, varName: e.target.value }
                              })}
                              placeholder="var_name"
                              className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs w-28 font-mono text-sky-300"
                            />
                            <span className="text-slate-500 font-mono text-xs">{'}}'}</span>
                          </div>
                          <select
                            value={st.condition.operator}
                            onChange={(e) => updateStep(flow.id, st.id, {
                              condition: { ...st.condition!, operator: e.target.value as StepConditionOp }
                            })}
                            className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs font-mono"
                          >
                            <option value="==">== (Bằng)</option>
                            <option value="!=">!= (Khác)</option>
                            <option value="contains">chứa (contains)</option>
                            <option value=">">&gt; (Lớn hơn)</option>
                            <option value="<">&lt; (Nhỏ hơn)</option>
                            <option value="exists">có giá trị (exists)</option>
                            <option value="empty">rỗng (empty)</option>
                          </select>
                          {st.condition.operator !== 'exists' && st.condition.operator !== 'empty' && (
                            <input
                              value={st.condition.value}
                              onChange={(e) => updateStep(flow.id, st.id, {
                                condition: { ...st.condition!, value: e.target.value }
                              })}
                              placeholder="giá trị so sánh"
                              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs w-32 font-mono"
                            />
                          )}
                          <span className="text-slate-400">Nếu SAI:</span>
                          <select
                            value={st.condition.onFalse ?? 'skip'}
                            onChange={(e) => updateStep(flow.id, st.id, {
                              condition: { ...st.condition!, onFalse: e.target.value as 'skip' | 'jump' }
                            })}
                            className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs"
                          >
                            <option value="skip">Bỏ qua bước này (Skip)</option>
                            <option value="jump">Nhảy tới bước (Jump)</option>
                          </select>
                          {st.condition.onFalse === 'jump' && (
                            <select
                              value={st.condition.jumpStepId ?? ''}
                              onChange={(e) => updateStep(flow.id, st.id, {
                                condition: { ...st.condition!, jumpStepId: e.target.value }
                              })}
                              className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs max-w-44"
                            >
                              <option value="">-- Chọn bước nhảy tới --</option>
                              {flow.steps.filter((s) => s.id !== st.id).map((s, sIdx) => {
                                const reqObj = requests[s.requestId];
                                return <option key={s.id} value={s.id}>#{sIdx + 1} {reqObj?.name ?? s.id}</option>;
                              })}
                            </select>
                          )}
                        </div>
                      )}

                      {/* Post-execution branching jumps */}
                      <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-sky-900/40 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="text-emerald-400 font-medium">Khi Thành công (OK):</span>
                          <select
                            value={st.onSuccessJump ?? ''}
                            onChange={(e) => updateStep(flow.id, st.id, { onSuccessJump: e.target.value || undefined })}
                            className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs max-w-40"
                          >
                            <option value="">Tiếp tục bước kế</option>
                            {flow.steps.filter((s) => s.id !== st.id).map((s, sIdx) => {
                              const reqObj = requests[s.requestId];
                              return <option key={s.id} value={s.id}>Nhảy tới #{sIdx + 1} {reqObj?.name ?? s.id}</option>;
                            })}
                          </select>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className="text-rose-400 font-medium">Khi Thất bại (Lỗi):</span>
                          <select
                            value={st.onFailJump ?? ''}
                            onChange={(e) => updateStep(flow.id, st.id, { onFailJump: e.target.value || undefined })}
                            className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs max-w-40"
                          >
                            <option value="">Dừng flow / kế tiếp</option>
                            {flow.steps.filter((s) => s.id !== st.id).map((s, sIdx) => {
                              const reqObj = requests[s.requestId];
                              return <option key={s.id} value={s.id}>Nhảy tới #{sIdx + 1} {reqObj?.name ?? s.id}</option>;
                            })}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Retry Configuration Panel */}
                  {showRetry && (
                    <div className="ml-8 flex flex-col gap-2 border-l-2 border-amber-800 pl-3 bg-amber-950/20 p-2.5 rounded-r">
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-amber-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={st.retry?.enabled ?? false}
                            onChange={(e) => updateStep(flow.id, st.id, {
                              retry: {
                                enabled: e.target.checked,
                                maxAttempts: st.retry?.maxAttempts ?? 3,
                                delayMs: st.retry?.delayMs ?? 1000,
                              }
                            })}
                            className="rounded text-amber-500"
                          />
                          <span>Tự động thử lại khi gặp lỗi (Retry on Failure)</span>
                        </label>
                      </div>
                      {st.retry?.enabled && (
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          <label className="flex items-center gap-1.5">
                            <span className="text-slate-400">Số lần chạy tối đa:</span>
                            <input
                              type="number"
                              min={2}
                              max={10}
                              value={st.retry.maxAttempts}
                              onChange={(e) => updateStep(flow.id, st.id, {
                                retry: { ...st.retry!, maxAttempts: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)) }
                              })}
                              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs w-16 font-mono text-amber-300"
                            />
                            <span className="text-slate-500">(gốc + thử lại)</span>
                          </label>
                          <label className="flex items-center gap-1.5">
                            <span className="text-slate-400">Thời gian chờ giữa các lần:</span>
                            <input
                              type="number"
                              min={0}
                              step={500}
                              value={st.retry.delayMs}
                              onChange={(e) => updateStep(flow.id, st.id, {
                                retry: { ...st.retry!, delayMs: Math.max(0, parseInt(e.target.value, 10) || 0) }
                              })}
                              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs w-20 font-mono text-amber-300"
                            />
                            <span className="text-slate-500">ms</span>
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const nc = collections[0];
                  const first = nc ? requestOptions(nc, requests)[0]?.id ?? '' : '';
                  if (nc) addStep(flow.id, nc.id, first);
                }}
                disabled={collections.length === 0}
                className="bg-slate-800 hover:bg-slate-700 rounded px-3 py-1.5 text-sm disabled:opacity-40"
              >
                {t.flow.addStep}
              </button>
              {collections.length === 0 && <span className="text-amber-400 text-xs self-center">{t.flow.needCollection}</span>}
            </div>
          </div>

          {/* Cảnh báo biến thiếu — nguyên nhân 401 thường gặp nhất */}
          {varIssues.length > 0 && (
            <div className="border border-amber-700 bg-amber-950/40 rounded p-3 flex flex-col gap-1.5 text-sm">
              <p className="font-semibold text-amber-300">{t.flow.missingVarsWarning}</p>
              {varIssues.map((iss) => {
                const target = prevStepFor(iss.stepIndex);
                return (
                  <div key={iss.stepIndex} className="flex flex-wrap items-center gap-2 text-xs">
                    <span>
                      {t.flow.stepUses.replace('{step}', String(iss.stepIndex + 1)).replace('{name}', iss.stepName)}{' '}
                      {iss.vars.map((v, i) => (
                        <span key={v}>{i > 0 && ', '}<code className="font-mono text-amber-200">{`{{${v}}}`}</code></span>
                      ))}
                    </span>
                    {target ? (
                      <button
                        onClick={() => quickAddRules(target.id, iss.vars)}
                        className="bg-amber-700 hover:bg-amber-600 rounded px-2 py-1 text-xs"
                      >
                        {t.flow.addRuleToStep.replace('{step}', String(flow!.steps.indexOf(target) + 1))}
                      </button>
                    ) : (
                      <span className="text-slate-400">{t.flow.addEnvOrPreScript}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Chạy */}
          <div className="flex flex-wrap items-end gap-3 border-t border-slate-800 pt-3">
            <label className="flex flex-col gap-1 text-sm">
              {t.flow.timeout}
              <input type="number" min={5} max={300} value={timeoutS} onChange={(e) => setTimeoutS(Math.min(300, Math.max(5, Number(e.target.value) || 30)))} className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 w-24" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t.flow.delay}
              <input type="number" min={0} step={100} value={delayMs} onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))} className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 w-28" />
            </label>
            <label className="flex items-center gap-1.5 text-sm pb-2">
              <input type="checkbox" checked={stopOnError} onChange={(e) => setStopOnError(e.target.checked)} />
              {t.flow.stopOnError}
            </label>
            {!running ? (
              <button onClick={start} disabled={activeSteps === 0} className="bg-emerald-700 hover:bg-emerald-600 rounded px-4 py-1.5 text-sm font-semibold disabled:opacity-40">
                {t.flow.runFlow.replace('{count}', String(activeSteps))}
              </button>
            ) : (
              <button onClick={() => abortRef.current?.abort()} className="bg-red-700 hover:bg-red-600 rounded px-4 py-1.5 text-sm font-semibold">⏹ {t.flow.stop}</button>
            )}
            {results.length > 0 && (
              <div className="flex items-center gap-3 ml-auto pb-1">
                <span className="text-sm">OK <b className={okCount === results.length ? 'text-emerald-400' : 'text-red-400'}>{okCount}/{results.length}</b></span>
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded p-0.5 text-xs">
                  <button
                    onClick={() => setResultViewMode('timeline')}
                    className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1.5 ${
                      resultViewMode === 'timeline'
                        ? 'bg-sky-600 text-white font-medium shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span>⏱️</span>
                    <span>Timeline</span>
                  </button>
                  <button
                    onClick={() => setResultViewMode('list')}
                    className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1.5 ${
                      resultViewMode === 'list'
                        ? 'bg-sky-600 text-white font-medium shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span>📋</span>
                    <span>Danh sách</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Kết quả */}
          {results.length > 0 && (
            resultViewMode === 'timeline' ? (
              <FlowTimelineView results={results} />
            ) : (
              <div className="flex flex-col gap-1.5">
                {results.map((r, i) => (
                  <div key={`${r.stepId}-${i}`} className={`border rounded px-3 py-2 text-sm ${r.ok ? 'border-slate-800' : 'border-red-800'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{r.skipped ? '⏭' : r.ok ? '✅' : '❌'}</span>
                      <b>#{i + 1} {r.name}</b>
                      {r.status !== undefined && <span className="font-mono text-xs text-slate-400">{r.status}</span>}
                      {r.timeMs !== undefined && <span className="font-mono text-xs text-slate-500">{r.timeMs}ms</span>}
                      {r.error && <span className="text-red-400 text-xs font-mono">{r.error}</span>}
                    </div>
                    {r.extracted.length > 0 && (
                      <div className="mt-1.5 flex flex-col gap-0.5 font-mono text-xs">
                        {r.extracted.map((e) => (
                          <div key={e.name} className="flex gap-2">
                            <span className="text-emerald-400 shrink-0">{`{{${e.name}}}`}</span>
                            <span className="text-slate-300 break-all">{e.value.length > 120 ? `${e.value.slice(0, 120)}…` : e.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {r.extractErrors.map((e, j) => (
                      <p key={j} className="text-amber-400 text-xs mt-1">⚠ trích “{e.rule}”: {e.message}</p>
                    ))}
                    {r.logs.length > 0 && (
                      <details className="mt-1 text-xs text-slate-500">
                        <summary className="cursor-pointer">logs ({r.logs.length})</summary>
                        <pre className="whitespace-pre-wrap font-mono mt-1">{r.logs.join('\n')}</pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {/* Biến flow live */}
          {Object.keys(flowVars).length > 0 && (
            <div className="border border-emerald-900 rounded p-3">
              <p className="text-xs font-semibold text-emerald-400 mb-1.5">{t.flow.liveVarsTitle.replace('{count}', String(Object.keys(flowVars).length))}</p>
              <div className="grid gap-0.5 font-mono text-xs max-h-40 overflow-auto">
                {Object.entries(flowVars).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-emerald-400 shrink-0">{k}</span>
                    <span className="text-slate-300 break-all">{v.length > 100 ? `${v.slice(0, 100)}…` : v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lịch sử chạy tay (20 lần/flow, body xem lại được) */}
          {flowRuns.length > 0 && (
            <div className="border-t border-slate-800 pt-3">
              <div className="flex items-center gap-2 mb-1.5">
                <h4 className="text-sm font-semibold">{t.runner.historyTitle} ({flowRuns.length})</h4>
                <button
                  onClick={() => { if (flow && confirm(t.runner.clearHistoryConfirm.replace('{name}', flow.name))) clearRuns('flow', flow.id); }}
                  className="text-xs text-slate-500 hover:text-red-300"
                >
                  {t.runner.clearHistory}
                </button>
              </div>
              {flowRuns.map((rec) => (
                <details key={rec.id} className="border border-slate-800 rounded px-3 py-1.5 text-sm mb-1.5">
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
                        {st.extracted?.map((e) => (
                          <span key={e.name} className="block font-mono text-emerald-500/90">
                            {`{{${e.name}}}`} = {e.value}
                          </span>
                        ))}
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
        </>
      )}
    </div>
  );
}
