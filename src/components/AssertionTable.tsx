import { useMemo, useState } from 'react';
import type { Assertion, AssertionKind, AssertionOp } from '../types/api';
import {
  ASSERTION_KINDS,
  assertionCount,
  compileAssertions,
  extractJsonPaths,
  getQuickTemplates,
  needs,
  opsFor,
} from '../lib/assertions';
import { uid } from '../lib/variables';
import { useTranslation } from '../stores/language';
import { useAppStore } from '../stores/app';

const KINDS = ASSERTION_KINDS;

function blank(kind: AssertionKind = 'status'): Assertion {
  return { id: uid('ax'), enabled: true, kind, target: '', op: (opsFor(kind)[0]?.id ?? 'equal') as AssertionOp, expected: '' };
}

/**
 * Bảng "Điều kiện kiểm thử" — QA/BA thêm câu kiểm tra mà không phải viết JS.
 * Bảng là nguồn thật; ReqX compile thành pm.test khi chạy (script-chain.ts),
 * còn ô "Xem code sinh ra" chỉ để đối chiếu.
 */
export default function AssertionTable({
  value,
  onChange,
}: {
  value: Assertion[];
  onChange: (next: Assertion[]) => void;
}) {
  const { t: i18n } = useTranslation();
  const { response } = useAppStore();
  const a = i18n.assertions;
  const [open, setOpen] = useState(value.length > 0);
  const [showCode, setShowCode] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showFieldPicker, setShowFieldPicker] = useState(false);
  const rows = value;

  const patch = (id: string, p: Partial<Assertion>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const remove = (id: string) => onChange(rows.filter((r) => r.id !== id));
  const add = () => {
    setOpen(true);
    onChange([...rows, blank()]);
  };

  const templates = useMemo(() => getQuickTemplates(), []);

  // Trích xuất các JSON dot-path từ response gần nhất (nếu có)
  const availablePaths = useMemo(() => {
    if (!response || !response.body) return [];
    try {
      const parsed = JSON.parse(response.body);
      return extractJsonPaths(parsed);
    } catch {
      return [];
    }
  }, [response]);

  const n = assertionCount(rows);
  const code = compileAssertions(rows);

  return (
    <div className="shrink-0 border border-slate-800 rounded bg-slate-950/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-slate-300 hover:text-white"
        title={a.hint}
      >
        <span>🎯</span>
        <span className="font-semibold">{a.title}</span>
        {n > 0 && <span className="bg-emerald-900/70 text-emerald-300 rounded px-1.5 py-0.5 text-[10px] font-bold">{a.badge.replace('{n}', String(n))}</span>}
        <span className="ml-auto text-slate-500">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-2 pb-2 flex flex-col gap-1.5">
          {rows.length === 0 ? (
            <p className="text-[11px] text-slate-500">{a.empty}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="grid grid-cols-[20px_minmax(120px,1.2fr)_minmax(90px,1fr)_minmax(90px,0.8fr)_minmax(110px,1.2fr)_24px] gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
                <span title={a.colOn}>⏻</span>
                <span>{a.colWhat}</span>
                <span>{a.colTarget}</span>
                <span>{a.colOp}</span>
                <span>{a.colExpect}</span>
                <span />
              </div>
              {rows.map((r) => {
                const f = needs(r.kind, r.op);
                const kindLabel = KINDS.find((k) => k.id === r.kind)?.label ?? r.kind;
                return (
                  <div key={r.id} className="grid grid-cols-[20px_minmax(120px,1.2fr)_minmax(90px,1fr)_minmax(90px,0.8fr)_minmax(110px,1.2fr)_24px] gap-1.5 items-center">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) => patch(r.id, { enabled: e.target.checked })}
                      className="accent-emerald-500"
                      title={a.colOn}
                    />
                    <select
                      value={r.kind}
                      onChange={(e) => {
                        const kind = e.target.value as AssertionKind;
                        patch(r.id, { kind, op: (opsFor(kind)[0]?.id ?? 'equal') as AssertionOp });
                      }}
                      className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-200 outline-none focus:border-teal-500"
                    >
                      {KINDS.map((k) => (
                        <option key={k.id} value={k.id}>{k.label}</option>
                      ))}
                    </select>
                    <input
                      value={r.target}
                      onChange={(e) => patch(r.id, { target: e.target.value })}
                      disabled={!f.target}
                      placeholder={r.kind === 'header' ? 'x-total-count' : r.kind === 'jsonField' ? 'data.user.id' : '—'}
                      title={kindLabel}
                      className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-200 outline-none focus:border-teal-500 disabled:opacity-40"
                    />
                    <select
                      value={r.op}
                      onChange={(e) => patch(r.id, { op: e.target.value as AssertionOp })}
                      className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-200 outline-none focus:border-teal-500"
                    >
                      {opsFor(r.kind).map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                    <input
                      value={r.expected}
                      onChange={(e) => patch(r.id, { expected: e.target.value })}
                      disabled={!f.expected}
                      placeholder={r.op === 'in' ? '200, 201, 204' : r.op === 'type' ? 'string / number / array' : '200'}
                      className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-200 outline-none focus:border-teal-500 disabled:opacity-40"
                    />
                    <button
                      type="button"
                      onClick={() => remove(r.id)}
                      title={a.remove}
                      className="text-slate-500 hover:text-rose-400 text-xs"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={add}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded px-2 py-1 font-semibold"
            >
              {a.add}
            </button>

            {/* Quick Templates Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowTemplates((s) => !s);
                  setShowFieldPicker(false);
                }}
                className="text-xs bg-cyan-950/80 hover:bg-cyan-900/90 text-cyan-300 border border-cyan-800/80 rounded px-2 py-1 flex items-center gap-1 font-medium transition-colors"
                title={a.quickTemplates}
              >
                <span>{a.quickTemplates}</span>
                <span className="text-[10px]">▾</span>
              </button>
              {showTemplates && (
                <div className="absolute left-0 top-full mt-1 w-64 bg-slate-900 border border-slate-750 rounded-lg shadow-xl p-1 z-30 flex flex-col gap-0.5">
                  {templates.map((tpl, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        onChange([...rows, tpl.create()]);
                        setShowTemplates(false);
                      }}
                      className="text-left px-2 py-1.5 rounded hover:bg-slate-800 text-xs flex flex-col gap-0.5 group"
                    >
                      <span className="font-semibold text-slate-200 group-hover:text-cyan-300">{tpl.label}</span>
                      <span className="text-[10px] text-slate-400">{tpl.desc}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Pick from Response Field Picker */}
            {availablePaths.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowFieldPicker((s) => !s);
                    setShowTemplates(false);
                  }}
                  className="text-xs bg-emerald-950/80 hover:bg-emerald-900/90 text-emerald-300 border border-emerald-800/80 rounded px-2 py-1 flex items-center gap-1 font-medium transition-colors"
                  title={a.extractFromResponse}
                >
                  <span>{a.extractFromResponse}</span>
                  <span className="text-[10px]">▾</span>
                </button>
                {showFieldPicker && (
                  <div className="absolute left-0 top-full mt-1 w-72 max-h-64 overflow-y-auto bg-slate-900 border border-slate-750 rounded-lg shadow-xl p-1 z-30 flex flex-col gap-0.5">
                    <div className="px-2 py-1 text-[10px] text-slate-400 font-bold uppercase tracking-wider border-b border-slate-800 mb-1">
                      Chọn trường để kiểm thử:
                    </div>
                    {availablePaths.map((p, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          onChange([
                            ...rows,
                            {
                              id: uid('ax'),
                              enabled: true,
                              kind: 'jsonField',
                              target: p.path,
                              op: p.type === 'array' || p.type === 'object' ? 'exists' : 'equal',
                              expected: p.type === 'array' || p.type === 'object' ? '' : p.value,
                            },
                          ]);
                          setShowFieldPicker(false);
                        }}
                        className="text-left px-2 py-1 rounded hover:bg-slate-800 text-xs flex items-center justify-between group"
                      >
                        <span className="font-mono text-cyan-300 group-hover:underline truncate max-w-[150px]">{p.path}</span>
                        <span className="text-[10px] text-slate-400 font-mono truncate max-w-[90px]">{p.value}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {code && (
              <button
                type="button"
                onClick={() => setShowCode((s) => !s)}
                className="text-xs text-slate-400 hover:text-slate-200 underline decoration-dotted"
              >
                {showCode ? a.hideCode : a.showCode}
              </button>
            )}
            <span className="text-[11px] text-slate-500">{a.runsWithTests}</span>
          </div>

          {showCode && code && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[10px] leading-tight text-slate-400 bg-slate-900/80 border border-slate-800 rounded p-2">
              {code}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
