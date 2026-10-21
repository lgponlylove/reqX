import { useState, useMemo } from 'react';
import type { ApiRequest } from '../types/api';
import { computeDiff, diffJson, tryFormatJson, type DiffLine, type JsonDiffEntry } from '../lib/diff';
import { useRequestStore } from '../stores/request';

interface Props {
  request: ApiRequest;
  currentResponse: {
    status: number;
    body: string;
    headers?: Record<string, string>;
  };
  onClose: () => void;
}

export default function SnapshotDiffModal({ request, currentResponse, onClose }: Props) {
  const { set } = useRequestStore();
  const [tab, setTab] = useState<'visual' | 'line' | 'headers'>('visual');
  const [copied, setCopied] = useState(false);

  const snapshot = request.snapshot;

  // Format bodies
  const oldBodyFormatted = useMemo(() => {
    return snapshot ? tryFormatJson(snapshot.body) : '';
  }, [snapshot]);

  const newBodyFormatted = useMemo(() => {
    return tryFormatJson(currentResponse.body);
  }, [currentResponse.body]);

  // Deep structural diff
  const jsonDiffs: JsonDiffEntry[] = useMemo(() => {
    if (!snapshot) return [];
    try {
      const oldObj = JSON.parse(snapshot.body);
      const newObj = JSON.parse(currentResponse.body);
      return diffJson(oldObj, newObj);
    } catch {
      return [];
    }
  }, [snapshot, currentResponse.body]);

  // Line diff
  const lineDiffs: DiffLine[] = useMemo(() => {
    if (!snapshot) return [];
    return computeDiff(oldBodyFormatted, newBodyFormatted);
  }, [snapshot, oldBodyFormatted, newBodyFormatted]);

  const statusChanged = snapshot && snapshot.status !== currentResponse.status;

  function updateBaseline() {
    set({
      snapshot: {
        status: currentResponse.status,
        body: currentResponse.body,
        headers: currentResponse.headers,
        savedAt: Date.now(),
      },
    });
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  function removeBaseline() {
    set({ snapshot: undefined });
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-750 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔀</span>
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                Snapshot & Regression Diff Testing
                {statusChanged && (
                  <span className="bg-rose-900/80 text-rose-300 border border-rose-700 rounded px-1.5 py-0.2 text-[10px] font-mono">
                    Status đổi: {snapshot?.status} → {currentResponse.status}
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-slate-400">
                So sánh phản hồi hiện tại với Snapshot Baseline đã lưu để phát hiện thay đổi bất thường (Regression).
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-sm p-1">
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/90 text-xs">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setTab('visual')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                tab === 'visual'
                  ? 'bg-emerald-600 text-white font-semibold'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              📊 Cấu trúc JSON ({jsonDiffs.length} thay đổi)
            </button>
            <button
              onClick={() => setTab('line')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                tab === 'line'
                  ? 'bg-emerald-600 text-white font-semibold'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              📝 So sánh từng dòng (Side-by-Side)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={updateBaseline}
              className="bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-700/80 rounded px-2.5 py-1 text-xs font-semibold flex items-center gap-1"
              title="Lưu response hiện tại làm Snapshot Baseline mới"
            >
              <span>📸</span>
              <span>{copied ? '✓ Đã cập nhật Snapshot' : 'Ghi đè Snapshot mới'}</span>
            </button>
            {snapshot && (
              <button
                type="button"
                onClick={removeBaseline}
                className="text-slate-500 hover:text-rose-400 text-xs underline"
              >
                Gỡ Snapshot
              </button>
            )}
          </div>
        </div>

        {/* Body content */}
        <div className="flex-1 overflow-auto p-4 font-mono text-xs">
          {!snapshot ? (
            <div className="h-64 flex flex-col items-center justify-center text-center p-6 text-slate-400">
              <span className="text-4xl mb-2">📸</span>
              <p className="font-semibold text-slate-300">Chưa có Snapshot Baseline cho Request này</p>
              <p className="text-xs text-slate-500 mt-1 max-w-md">
                Bấm nút "Ghi đè Snapshot mới" ở trên để lưu lại response chuẩn của API. Những lần gửi sau sẽ tự động đối chiếu với mốc này!
              </p>
            </div>
          ) : (
            <>
              {tab === 'visual' && (
                <div className="flex flex-col gap-2">
                  {jsonDiffs.length === 0 ? (
                    <div className="bg-emerald-950/40 border border-emerald-800 text-emerald-300 rounded-lg p-6 text-center">
                      <span className="text-2xl">✨</span>
                      <p className="font-bold mt-1">Cấu trúc hoàn hảo — Khớp 100% với Snapshot Baseline!</p>
                      <p className="text-[11px] text-emerald-400/80 mt-0.5">
                        Không có trường nào bị rơi rớt, không đổi kiểu dữ liệu (Data types) so với bản chuẩn.
                      </p>
                    </div>
                  ) : (
                    <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-900 text-slate-400 border-b border-slate-800 text-[10px] uppercase">
                            <th className="p-2">Trạng thái</th>
                            <th className="p-2">Đường dẫn Field (JSON Path)</th>
                            <th className="p-2">Giá trị Baseline cũ</th>
                            <th className="p-2">Giá trị Hiện tại</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {jsonDiffs.map((d, i) => {
                            const badge =
                              d.type === 'added'
                                ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                                : d.type === 'removed'
                                ? 'bg-rose-950 text-rose-300 border-rose-700'
                                : d.type === 'type_changed'
                                ? 'bg-amber-950 text-amber-300 border-amber-700'
                                : 'bg-sky-950 text-sky-300 border-sky-700';

                            const label =
                              d.type === 'added'
                                ? 'THÊM MỚI (+)'
                                : d.type === 'removed'
                                ? 'BỊ MẤT (-)'
                                : d.type === 'type_changed'
                                ? `ĐỔI KIỂU (${d.oldType} ➔ ${d.newType})`
                                : 'THAY ĐỔI';

                            return (
                              <tr key={i} className="hover:bg-slate-900/50">
                                <td className="p-2 whitespace-nowrap">
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${badge}`}>
                                    {label}
                                  </span>
                                </td>
                                <td className="p-2 font-bold text-cyan-300">{d.path}</td>
                                <td className="p-2 text-rose-300/80 max-w-[200px] truncate">
                                  {d.oldValue !== undefined ? JSON.stringify(d.oldValue) : '—'}
                                </td>
                                <td className="p-2 text-emerald-300 max-w-[200px] truncate">
                                  {d.newValue !== undefined ? JSON.stringify(d.newValue) : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {tab === 'line' && (
                <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950 max-h-[60vh] overflow-y-auto">
                  {lineDiffs.map((l, i) => {
                    const bg =
                      l.type === 'added'
                        ? 'bg-emerald-950/40 text-emerald-200 border-l-2 border-emerald-500'
                        : l.type === 'removed'
                        ? 'bg-rose-950/40 text-rose-200 border-l-2 border-rose-500'
                        : 'text-slate-400';
                    const sign = l.type === 'added' ? '+' : l.type === 'removed' ? '-' : ' ';
                    return (
                      <div key={i} className={`flex px-2 py-0.5 font-mono text-[11px] leading-relaxed ${bg}`}>
                        <span className="w-8 select-none text-slate-600 text-right pr-2">
                          {l.oldLineNum ?? ''}
                        </span>
                        <span className="w-8 select-none text-slate-600 text-right pr-2">
                          {l.newLineNum ?? ''}
                        </span>
                        <span className="w-4 select-none font-bold text-center">{sign}</span>
                        <pre className="flex-1 whitespace-pre-wrap break-all">{l.line}</pre>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
