import { useMemo, useRef, useState } from 'react';
import { useAppStore } from '../stores/app';
import { useTestCaseStore } from '../stores/testcases';
import {
  GROUP_LABEL, casesToCsv, csvFileName, generateCases, runTestCases,
  type CaseGroup, type TestCase,
} from '../lib/test-cases';
import { storeHooks } from '../lib/runner-hooks';
import { confirmUntrustedScripts } from '../lib/scripts';
import { revealExportedFile, saveExportBesideApp } from '../lib/response-file';

const GROUPS = Object.keys(GROUP_LABEL) as CaseGroup[];

/** Bảng duyệt bộ key test: sửa từng case → chạy → xem ✅/❌ → xuất file mở bằng Excel. */
export default function TestCaseDialog() {
  const { open, base, cases, results, running, hide, patchCase, removeCase, addCase, setCases, setResult, clearResults, setRunning } = useTestCaseStore();
  const collections = useAppStore((s) => s.collections);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dataErr, setDataErr] = useState<Record<string, string>>({});
  const [exported, setExported] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [concurrency, setConcurrency] = useState(5);

  const enabled = useMemo(() => cases.filter((c) => c.enabled !== false).length, [cases]);
  const ran = Object.keys(results).length;
  const passed = useMemo(() => Object.values(results).filter((r) => r.pass).length, [results]);

  if (!open) return null;

  const dataText = (c: TestCase) => drafts[c.id] ?? JSON.stringify(c.data);

  const commitData = (c: TestCase) => {
    const t = drafts[c.id];
    if (t === undefined) return;
    try {
      const parsed = t.trim() === '' ? {} : JSON.parse(t);
      if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) throw new Error('Cần object {"field":"gia tri"}');
      const data: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) data[k] = String(v ?? '');
      patchCase(c.id, { data });
      setDataErr((e) => ({ ...e, [c.id]: '' }));
      setDrafts((d) => { const n = { ...d }; delete n[c.id]; return n; });
    } catch (err) {
      setDataErr((e) => ({ ...e, [c.id]: err instanceof Error ? err.message : 'JSON không hợp lệ' }));
    }
  };

  async function run() {
    if (!base || running) return false;
    const list = cases.filter((c) => c.enabled !== false);
    if (!list.length) return false;
    if (!confirmUntrustedScripts([base], `Chạy ${list.length} test case cho “${base.name}”`, collections)) return false;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    clearResults();
    setExported('');
    try {
      await runTestCases(base, list, storeHooks(), {
        signal: ctrl.signal,
        collections,
        concurrency,
        onResult: (c, r) => setResult(c.id, r),
      });
      return true;
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  /** Một mạch: chạy hết case được chọn rồi xuất file, khỏi bấm hai nút. */
  async function runAndExport() {
    if (await run()) await exportCsv();
  }

  async function exportCsv() {
    if (!base) return;
    setBusy(true);
    try {
      const fname = csvFileName(base);
      // BOM đã có trong casesToCsv → Excel mở ra tiếng Việt không bị lỗi font
      const content = casesToCsv(base, cases, results);
      const saved = await saveExportBesideApp(fname, content);
      if (saved) {
        setExported(saved.path);
        return;
      }
      const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setExported(`${fname} (thư mục Downloads)`);
    } finally {
      setBusy(false);
    }
  }

  async function exportHtml() {
    if (!base) return;
    setBusy(true);
    try {
      const { generateKeyTestHtmlReport } = await import('../lib/reporter');
      const htmlContent = generateKeyTestHtmlReport({
        baseRequest: base,
        cases,
        results,
      });
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const slug = base.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'request';
      const fname = `reqx-keytest-report-${slug}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.html`;

      const saved = await saveExportBesideApp(fname, htmlContent);
      if (saved) {
        setExported(saved.path);
        return;
      }
      const url = URL.createObjectURL(new Blob([htmlContent], { type: 'text/html;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setExported(`${fname} (thư mục Downloads)`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !running) hide(); }}
    >
      <div className="w-full max-w-6xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-700 rounded-lg shadow-2xl">
        <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-slate-800">
          <div className="min-w-0">
            <h3 className="font-bold">🧪 Bộ key test — {base?.name ?? '—'}</h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {base ? `${base.method} ${base.url}` : '—'} · {cases.length} case · {enabled} được chọn
            </p>
          </div>
          <button onClick={hide} className="text-slate-400 hover:text-white px-2" title="Đóng">✕</button>
        </div>

        {!base && (
          <div className="px-4 py-6 text-sm text-red-400">Chưa có request gốc nào cho bộ test này.</div>
        )}

        {base && (
          <>
            <div className="flex-1 overflow-auto px-4 py-3">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-slate-500 sticky top-0 bg-slate-900">
                  <tr className="text-left">
                    <th className="w-6 py-1"></th>
                    <th className="w-6 py-1">#</th>
                    <th className="w-52 py-1">Tên case</th>
                    <th className="w-28 py-1">Nhóm</th>
                    <th className="py-1" title='{"ten field":"gia tri"} — "<<xóa field>>" = bỏ hẳn key, "<<null>>" = gửi null, "" = chuỗi rỗng, "[]" / "{}" = mảng/object rỗng; key "body" thay cả body, key "header:Name" / "query:name" / "url"'>
                      Dữ liệu thay thế (JSON)
                    </th>
                    <th className="w-20 py-1">Mong đợi</th>
                    <th className="w-28 py-1">Body chứa</th>
                    <th className="w-14 py-1 text-right">Status</th>
                    <th className="w-40 py-1">Kết luận</th>
                    <th className="w-6 py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c, i) => {
                    const r = results[c.id];
                    const on = c.enabled !== false;
                    return (
                      <tr key={c.id} className="border-t border-slate-800 align-top">
                        <td className="py-1">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) => patchCase(c.id, { enabled: e.target.checked })}
                          />
                        </td>
                        <td className="py-1 text-slate-600">{i + 1}</td>
                        <td className="py-1 pr-2">
                          <input
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1"
                            value={c.name}
                            onChange={(e) => patchCase(c.id, { name: e.target.value })}
                          />
                          {c.note && <span className="text-[10px] text-slate-500">{c.note}</span>}
                        </td>
                        <td className="py-1 pr-2">
                          <select
                            className="w-full bg-slate-950 border border-slate-700 rounded px-1 py-1"
                            value={c.group}
                            onChange={(e) => patchCase(c.id, { group: e.target.value as CaseGroup })}
                          >
                            {GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
                          </select>
                        </td>
                        <td className="py-1 pr-2">
                          <input
                            className={`w-full bg-slate-950 border rounded px-2 py-1 font-mono ${dataErr[c.id] ? 'border-red-700' : 'border-slate-700'}`}
                            value={dataText(c)}
                            spellCheck={false}
                            placeholder='{"receiptdocumentid":"<<xóa field>>"}'
                            onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                            onBlur={() => commitData(c)}
                          />
                          {dataErr[c.id] && <span className="text-[10px] text-red-400">{dataErr[c.id]}</span>}
                        </td>
                        <td className="py-1 pr-2">
                          <input
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                            value={c.expect.status}
                            title="2xx / 4xx / 401 / !=200 / >=400 / any"
                            onChange={(e) => patchCase(c.id, { expect: { ...c.expect, status: e.target.value } })}
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <input
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                            value={c.expect.contains ?? ''}
                            placeholder="(bỏ trống)"
                            onChange={(e) => patchCase(c.id, { expect: { ...c.expect, contains: e.target.value } })}
                          />
                        </td>
                        <td className="py-1 text-right font-mono">{r?.status ?? ''}</td>
                        <td className={`py-1 ${r ? (r.pass ? 'text-emerald-400' : 'text-red-400') : 'text-slate-600'}`}>
                          {r ? <span title={r.why}>{r.pass ? '✅ ' : '❌ '}{r.why}</span> : <span title="Chưa chạy">—</span>}
                        </td>
                        <td className="py-1">
                          <button
                            onClick={() => removeCase(c.id)}
                            className="text-slate-500 hover:text-red-400"
                            title="Xoá case"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {cases.length === 0 && (
                    <tr><td colSpan={10} className="py-4 text-center text-slate-500 italic">Chưa có case nào — bấm “↺ Sinh lại”.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-slate-800 flex flex-wrap items-center gap-2 text-sm">
              <button
                onClick={() => setCases(base, generateCases(base, Math.max(20, cases.length || 40)))}
                className="bg-slate-800 hover:bg-slate-700 rounded px-3 py-1.5 text-xs"
                title="Quét lại field trong body và sinh bộ case mới (mất kết quả cũ)"
              >
                ↺ Sinh lại
              </button>
              <button onClick={addCase} className="bg-slate-800 hover:bg-slate-700 rounded px-3 py-1.5 text-xs">+ Thêm case</button>
              <label className="flex items-center gap-1 text-xs text-slate-400" title="Số case chạy song song cùng lúc (1–20)">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={concurrency}
                  disabled={running}
                  onChange={(e) => setConcurrency(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
                  className="w-12 bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-center font-mono"
                />
                concurrency
              </label>
              {running ? (
                <button
                  onClick={() => abortRef.current?.abort()}
                  className="bg-red-800 hover:bg-red-700 rounded px-3 py-1.5 text-xs font-bold"
                >
                  ⏹ Dừng
                </button>
              ) : (
                <button
                  onClick={() => void run()}
                  disabled={!enabled}
                  className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded px-3 py-1.5 text-xs font-bold"
                >
                  ▶ Chạy {enabled} case
                </button>
              )}
              {!running && (
                <button
                  onClick={() => void runAndExport()}
                  disabled={!enabled || busy}
                  className="bg-violet-800 hover:bg-violet-700 disabled:opacity-40 rounded px-3 py-1.5 text-xs font-bold"
                  title="Chạy hết case được chọn rồi xuất file ngay"
                >
                  ⚡ Chạy hết + xuất file
                </button>
              )}
              {ran > 0 && (
                <span className={`text-xs ${passed === ran ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {passed}/{ran} khớp mong đợi
                </span>
              )}
              <div className="flex-1" />
              {exported && (
                <button onClick={() => void revealExportedFile(exported)} className="text-xs text-slate-400 hover:text-white truncate max-w-[240px]" title={exported}>
                  📂 {exported}
                </button>
              )}
              <button
                onClick={() => void exportCsv()}
                disabled={busy || cases.length === 0}
                className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 disabled:opacity-40 rounded px-3 py-1.5 text-xs font-bold"
                title="Xuất file CSV (có BOM) — mở trực tiếp bằng Excel"
              >
                ⬇ Xuất CSV
              </button>
              <button
                onClick={() => void exportHtml()}
                disabled={busy || cases.length === 0}
                className="bg-gradient-to-r from-violet-700 to-purple-600 hover:from-violet-600 hover:to-purple-500 text-white shadow-md shadow-violet-900/40 disabled:opacity-40 rounded px-3 py-1.5 text-xs font-bold flex items-center gap-1"
                title="Xuất Báo Cáo HTML trực quan (kèm biểu đồ, mở ngay trên trình duyệt)"
              >
                <span>📄</span>
                <span>Báo Cáo HTML</span>
              </button>
              <button onClick={hide} className="bg-slate-800 hover:bg-slate-700 rounded px-3 py-1.5 text-xs">Đóng</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
