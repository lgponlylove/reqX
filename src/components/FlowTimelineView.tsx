import { useState, useMemo } from 'react';
import type { FlowStepResult } from '../lib/flow';

interface FlowTimelineViewProps {
  results: FlowStepResult[];
  onViewBody?: (key: string, name: string, status?: number, ct?: string) => void;
}

export default function FlowTimelineView({ results, onViewBody }: FlowTimelineViewProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Tính toán thời gian tổng và khoảng thời gian
  const { totalTimeMs, okCount, failCount, skipCount, retryCount } = useMemo(() => {
    let maxEnd = 0;
    let ok = 0;
    let fail = 0;
    let skip = 0;
    let retry = 0;

    for (const r of results) {
      if (r.endTimeMs && r.endTimeMs > maxEnd) {
        maxEnd = r.endTimeMs;
      }
      if (r.skipped) {
        skip++;
      } else if (r.ok) {
        ok++;
      } else {
        fail++;
      }
      if ((r.attempts ?? 1) > 1) {
        retry++;
      }
    }

    // Nếu không có timing relative, tính tổng timeMs
    if (maxEnd === 0) {
      maxEnd = results.reduce((acc, r) => acc + (r.timeMs ?? 0), 0);
    }

    return {
      totalTimeMs: Math.max(1, maxEnd),
      okCount: ok,
      failCount: fail,
      skipCount: skip,
      retryCount: retry,
    };
  }, [results]);

  const toggleExpand = (idx: number) => {
    setExpandedIndex(expandedIndex === idx ? null : idx);
  };

  return (
    <div className="flex flex-col gap-3 bg-[#0a111a] border border-slate-800 rounded-xl p-4">
      {/* Overview Stats Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 border border-slate-800 rounded-lg px-4 py-2.5">
        <div className="flex items-center gap-4 text-xs">
          <div>
            <span className="text-slate-400">Tổng thời gian:</span>{' '}
            <span className="font-mono font-bold text-emerald-400">{totalTimeMs.toLocaleString()} ms</span>
          </div>
          <div className="h-3 w-px bg-slate-700" />
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-emerald-400">
              <span>✅</span> <b>{okCount}</b> thành công
            </span>
            {failCount > 0 && (
              <span className="flex items-center gap-1 text-rose-400">
                <span>❌</span> <b>{failCount}</b> thất bại
              </span>
            )}
            {retryCount > 0 && (
              <span className="flex items-center gap-1 text-amber-400">
                <span>🔄</span> <b>{retryCount}</b> thử lại
              </span>
            )}
            {skipCount > 0 && (
              <span className="flex items-center gap-1 text-slate-400">
                <span>⏭</span> <b>{skipCount}</b> rẽ nhánh bỏ qua
              </span>
            )}
          </div>
        </div>

        <div className="text-[11px] text-slate-500 font-mono">
          Biểu đồ Timeline Waterfall (Gantt)
        </div>
      </div>

      {/* Timeline Ruler Header */}
      <div className="relative h-6 border-b border-slate-800/80 px-2 flex items-center justify-between text-[10px] font-mono text-slate-500 select-none">
        <span>0 ms</span>
        <span>{Math.round(totalTimeMs * 0.25)} ms</span>
        <span>{Math.round(totalTimeMs * 0.5)} ms</span>
        <span>{Math.round(totalTimeMs * 0.75)} ms</span>
        <span>{totalTimeMs} ms</span>
      </div>

      {/* Step Waterfall Rows */}
      <div className="flex flex-col gap-2">
        {results.map((r, i) => {
          const isExpanded = expandedIndex === i;
          const start = r.startTimeMs ?? 0;
          const duration = r.timeMs ?? 0;
          const leftPct = Math.min(99, Math.max(0, (start / totalTimeMs) * 100));
          const widthPct = Math.max(2, Math.min(100 - leftPct, (duration / totalTimeMs) * 100));

          // Color & Status Styling
          let barGradient = 'from-emerald-600 to-teal-500';
          let statusBadgeBg = 'bg-emerald-950 text-emerald-400 border-emerald-800/80';
          if (r.skipped) {
            barGradient = 'bg-slate-800 border border-dashed border-slate-600';
            statusBadgeBg = 'bg-slate-800 text-slate-400 border-slate-700';
          } else if (!r.ok) {
            barGradient = 'from-rose-600 to-red-500';
            statusBadgeBg = 'bg-rose-950 text-rose-400 border-rose-800/80';
          } else if ((r.attempts ?? 1) > 1 || (r.status && r.status >= 300 && r.status < 400)) {
            barGradient = 'from-amber-600 to-orange-500';
            statusBadgeBg = 'bg-amber-950 text-amber-400 border-amber-800/80';
          }

          return (
            <div
              key={`${r.stepId}-${i}`}
              className={`flex flex-col border rounded-lg transition-all ${
                isExpanded ? 'border-slate-700 bg-slate-900/90 shadow-md' : 'border-slate-800/80 bg-slate-950/40 hover:bg-slate-900/40'
              }`}
            >
              {/* Row Header Info */}
              <div
                onClick={() => toggleExpand(i)}
                className="flex items-center justify-between px-3 py-2 cursor-pointer select-none text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-slate-500 font-bold">#{i + 1}</span>
                  <span className="font-mono font-semibold px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300">
                    {r.method || 'REQ'}
                  </span>
                  <span className="font-medium text-slate-200 truncate max-w-[280px]" title={r.name}>
                    {r.name}
                  </span>
                  {r.skipped && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
                      ⏭ Đã bỏ qua
                    </span>
                  )}
                  {(r.attempts ?? 1) > 1 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1">
                      <span>🔄</span> Thử lại ({r.attempts} lần)
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  {r.status !== undefined && (
                    <span className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] border ${statusBadgeBg}`}>
                      {r.status}
                    </span>
                  )}
                  <span className="font-mono text-xs text-slate-300">
                    {r.skipped ? '0 ms' : `${duration} ms`}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    ({((duration / totalTimeMs) * 100).toFixed(1)}%)
                  </span>
                  <span className="text-slate-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Gantt Bar Track */}
              <div className="px-3 pb-2 pt-0.5">
                <div className="relative w-full h-3 bg-slate-900 rounded-full overflow-hidden border border-slate-800/80">
                  {/* Grid Lines */}
                  <div className="absolute inset-0 flex justify-between pointer-events-none opacity-20">
                    <div className="w-px h-full bg-slate-600" />
                    <div className="w-px h-full bg-slate-600" />
                    <div className="w-px h-full bg-slate-600" />
                    <div className="w-px h-full bg-slate-600" />
                  </div>

                  {/* Active Step Duration Bar */}
                  {!r.skipped && (
                    <div
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                      }}
                      className={`absolute top-0 bottom-0 rounded-full bg-gradient-to-r ${barGradient} shadow-sm transition-all`}
                      title={`Bắt đầu: +${start}ms • Kéo dài: ${duration}ms • Kết thúc: +${r.endTimeMs ?? (start + duration)}ms`}
                    />
                  )}
                </div>
              </div>

              {/* Expanded Step Details */}
              {isExpanded && (
                <div className="px-3.5 pb-3 pt-1 border-t border-slate-800/80 flex flex-col gap-2 text-xs">
                  {/* URL */}
                  {r.url && (
                    <div className="flex items-center gap-2 font-mono text-[11px]">
                      <span className="text-slate-500">URL:</span>
                      <span className="text-slate-300 truncate">{r.url}</span>
                    </div>
                  )}

                  {/* Skipped reason */}
                  {r.skipReason && (
                    <div className="bg-slate-900/80 border border-slate-800 rounded p-2 text-amber-300 text-xs">
                      <span className="font-semibold">Lý do rẽ nhánh bỏ qua: </span>
                      <span>{r.skipReason}</span>
                    </div>
                  )}

                  {/* Retry history details */}
                  {r.retryHistory && r.retryHistory.length > 1 && (
                    <div className="flex flex-col gap-1 bg-amber-950/20 border border-amber-900/40 rounded p-2">
                      <span className="font-semibold text-amber-300 text-[11px]">Lịch sử các lần chạy lại (Retry):</span>
                      {r.retryHistory.map((att) => (
                        <div key={att.attempt} className="flex items-center justify-between text-[11px] font-mono text-slate-300">
                          <span>
                            Lần #{att.attempt}: {att.ok ? '✅ Thành công' : '❌ Thất bại'}
                            {att.status ? ` (HTTP ${att.status})` : ''}
                            {att.error ? ` — ${att.error}` : ''}
                          </span>
                          <span className="text-slate-500">{att.timeMs}ms</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Extracted vars */}
                  {r.extracted.length > 0 && (
                    <div className="flex flex-col gap-1 bg-emerald-950/20 border border-emerald-900/40 rounded p-2 font-mono text-[11px]">
                      <span className="text-emerald-400 font-semibold">Biến trích xuất được:</span>
                      {r.extracted.map((e) => (
                        <div key={e.name} className="flex gap-2">
                          <span className="text-emerald-300 font-bold">{`{{${e.name}}}`}</span>
                          <span className="text-slate-400">=</span>
                          <span className="text-slate-200 break-all">{e.value}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Error display */}
                  {r.error && (
                    <div className="bg-rose-950/30 border border-rose-900/50 rounded p-2 text-rose-300 font-mono text-xs">
                      <b>Lỗi: </b>{r.error}
                    </div>
                  )}

                  {/* Logs */}
                  {r.logs.length > 0 && (
                    <details className="text-[11px] text-slate-400">
                      <summary className="cursor-pointer hover:text-slate-200">
                        Nhật ký thực thi ({r.logs.length})
                      </summary>
                      <pre className="bg-slate-950 border border-slate-800 rounded p-2 mt-1 font-mono text-[10px] whitespace-pre-wrap text-slate-300">
                        {r.logs.join('\n')}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
