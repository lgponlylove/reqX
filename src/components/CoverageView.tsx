import { useMemo, useState } from 'react';
import { useAppStore } from '../stores/app';
import { useFlowStore } from '../stores/flow';
import { useScheduleStore } from '../stores/schedule';
import { coverageCsv, coverageTone, measureCoverage, type CoverageRun } from '../lib/coverage';
import { saveExportBesideApp } from '../lib/response-file';
import { useTranslation } from '../stores/language';

const TONE = {
  good: { bar: 'bg-emerald-500', text: 'text-emerald-400' },
  warn: { bar: 'bg-amber-500', text: 'text-amber-400' },
  bad: { bar: 'bg-rose-600', text: 'text-rose-400' },
  empty: { bar: 'bg-slate-700', text: 'text-slate-500' },
} as const;

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="bg-slate-950/70 border border-slate-800 rounded-lg px-3 py-2 flex flex-col gap-0.5 min-w-0" title={hint}>
      <span className="text-[11px] text-slate-400 uppercase tracking-wide truncate">{label}</span>
      <span className={`text-lg font-bold ${tone ?? 'text-slate-100'}`}>{value}</span>
    </div>
  );
}

export default function CoverageView() {
  const { t: i18n } = useTranslation();
  const collections = useAppStore((s) => s.collections);
  const requests = useAppStore((s) => s.requests);
  const history = useAppStore((s) => s.history);
  const runs = useFlowStore((s) => s.runs);
  const schedules = useScheduleStore((s) => s.schedules);
  const [q, setQ] = useState('');
  const [gapsOnly, setGapsOnly] = useState(false);

  // Lịch sử chạy nằm ở 3 nơi: Runner/Flow (useFlowStore.runs) và các lịch hẹn giờ (schedule.runs).
  const allRuns = useMemo<CoverageRun[]>(
    () => [
      ...runs.map((r) => ({ kind: r.kind, refId: r.refId, at: r.at, steps: r.steps.map((s) => ({ name: s.name, ok: s.ok })) })),
      ...schedules.flatMap((sc) =>
        sc.runs.map((r) => ({
          kind: sc.kind,
          refId: `${sc.collectionId}:${sc.folderId}`,
          at: r.at,
          steps: (r.steps ?? []).map((s) => ({ name: s.name, ok: s.ok })),
        })),
      ),
    ],
    [runs, schedules],
  );

  const result = useMemo(() => measureCoverage(collections, requests, allRuns, history), [collections, requests, allRuns, history]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return result.rows.filter((r) => {
      if (needle && !r.name.toLowerCase().includes(needle)) return false;
      if (gapsOnly && r.pct === 100 && r.neverRun === 0 && r.lastFailed === 0) return false;
      return true;
    });
  }, [result.rows, q, gapsOnly]);

  async function exportCsv() {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fname = `reqx-coverage-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.csv`;
    const csv = coverageCsv(result);
    const saved = await saveExportBesideApp(fname, csv);
    if (!saved) {
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      a.click();
    }
  }

  const s = result.summary;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-sm font-bold text-white flex items-center gap-2">🎯 {i18n.coverage.title}</h1>
          <p className="text-xs text-slate-400 mt-0.5">{i18n.coverage.intro}</p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={result.rows.length === 0}
          className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 font-semibold disabled:opacity-40"
        >
          {i18n.coverage.exportCsv}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Stat label={i18n.coverage.summaryRequests} value={String(s.total)} />
        <Stat
          label={i18n.coverage.summaryCovered}
          value={`${s.withTests}/${s.total} · ${s.pct}%`}
          tone={TONE[coverageTone(s.pct)].text}
          hint={`${i18n.coverage.colOwn}: ${s.ownTests} · ${i18n.coverage.colInherited}: ${s.withTests - s.ownTests}`}
        />
        <Stat label={i18n.coverage.summaryNever} value={String(s.neverRun)} tone={s.neverRun > 0 ? 'text-amber-400' : 'text-emerald-400'} hint={i18n.coverage.neverHint} />
        <Stat label={i18n.coverage.summaryFailed} value={String(s.lastFailed)} tone={s.lastFailed > 0 ? 'text-rose-400' : 'text-emerald-400'} />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={i18n.coverage.filterPlaceholder}
          className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 w-56 outline-none focus:border-teal-500"
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
          <input type="checkbox" checked={gapsOnly} onChange={(e) => setGapsOnly(e.target.checked)} className="accent-teal-500" />
          {i18n.coverage.onlyGaps}
        </label>
      </div>

      {result.rows.length === 0 ? (
        <div className="text-xs text-slate-400 bg-slate-950/60 border border-slate-800 rounded px-3 py-6 text-center">{i18n.coverage.empty}</div>
      ) : (
        <div className="overflow-x-auto border border-slate-800 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-slate-950/80 text-slate-400">
              <tr>
                <th className="text-left font-semibold px-3 py-1.5 whitespace-nowrap">{i18n.coverage.colName}</th>
                <th className="text-right font-semibold px-2 py-1.5 whitespace-nowrap">{i18n.coverage.colTotal}</th>
                <th className="text-right font-semibold px-2 py-1.5 whitespace-nowrap" title={i18n.coverage.colOwn}>{i18n.coverage.colOwn}</th>
                <th className="text-right font-semibold px-2 py-1.5 whitespace-nowrap" title={i18n.coverage.inheritedHint}>{i18n.coverage.colInherited}</th>
                <th className="text-left font-semibold px-3 py-1.5 w-40 whitespace-nowrap">{i18n.coverage.colPct}</th>
                <th className="text-right font-semibold px-2 py-1.5 whitespace-nowrap" title={i18n.coverage.neverHint}>{i18n.coverage.colNever}</th>
                <th className="text-right font-semibold px-3 py-1.5 whitespace-nowrap">{i18n.coverage.colFailed}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tone = TONE[coverageTone(r.pct)];
                return (
                  <tr key={r.id} className={`border-t border-slate-800/80 ${r.kind === 'collection' ? 'bg-slate-900/60' : ''}`}>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span style={{ paddingLeft: `${r.depth * 12}px` }} className="inline-flex items-center gap-1.5">
                        <span className={r.kind === 'collection' ? 'text-slate-500' : 'text-slate-600'}>{r.kind === 'collection' ? '📁' : '└'}</span>
                        <span className={r.kind === 'collection' ? 'font-semibold text-slate-100' : 'text-slate-300'}>{r.name}</span>
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right text-slate-300 tabular-nums">{r.total}</td>
                    <td className="px-2 py-1.5 text-right text-slate-300 tabular-nums">{r.ownTests}</td>
                    <td className="px-2 py-1.5 text-right text-slate-400 tabular-nums" title={i18n.coverage.inheritedHint}>{r.inheritedOnly}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 rounded-full bg-slate-800 overflow-hidden">
                          <div className={`h-full ${tone.bar} transition-all`} style={{ width: `${r.pct}%` }} />
                        </div>
                        <span className={`tabular-nums font-semibold ${tone.text}`}>{r.total === 0 ? '—' : `${r.pct}%`}</span>
                      </div>
                    </td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${r.neverRun > 0 ? 'text-amber-400' : 'text-slate-500'}`}>{r.neverRun}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${r.lastFailed > 0 ? 'text-rose-400 font-semibold' : 'text-slate-500'}`}>{r.lastFailed}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-slate-500">{i18n.coverage.nameCaveat}</p>
    </div>
  );
}
