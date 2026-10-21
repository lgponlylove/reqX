import { useState, useRef } from 'react';
import type { ApiRequest } from '../types/api';
import { runStressTest, type StressTestConfig, type StressTestReport, type StressRequestResult } from '../lib/stress';
import { applyResolvedAuth } from '../lib/auth-chain';
import { useAppStore } from '../stores/app';

interface Props {
  request: ApiRequest;
  onClose: () => void;
}

export default function StressTestModal({ request, onClose }: Props) {
  const { environments, activeEnvId, globals, collections } = useAppStore();
  const env = environments.find((e) => e.id === activeEnvId);

  const [concurrency, setConcurrency] = useState(5);
  const [totalRequests, setTotalRequests] = useState(30);
  const [delayMs, setDelayMs] = useState(0);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number; currentRps: number } | null>(null);
  const [report, setReport] = useState<StressTestReport | null>(null);
  const [results, setResults] = useState<StressRequestResult[]>([]);

  const abortRef = useRef<AbortController | null>(null);

  const startTest = async () => {
    setRunning(true);
    setReport(null);
    setResults([]);
    setProgress({ completed: 0, total: totalRequests, currentRps: 0 });

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const config: StressTestConfig = {
      concurrency,
      totalRequests,
      delayMs,
      durationSeconds: 120,
    };

    try {
      // Stress gửi qua http-client trực tiếp nên phải tự giải auth kế thừa ở đây
      const out = await runStressTest(applyResolvedAuth(collections, request), config, {
        envVars: env?.variables,
        globals,
        signal: ctrl.signal,
        onProgress: (p) => setProgress(p),
      });

      setResults(out.results);
      setReport(out.report);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const stopTest = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-750 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚡</span>
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                Local Stress & Concurrency Tester (Phòng Thí Nghiệm Đua Lệnh)
                <span className="bg-emerald-950 text-emerald-300 border border-emerald-800 rounded px-1.5 py-0.5 text-[10px] font-mono">
                  {request.method} {request.url.slice(0, 35)}...
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Gửi request song song từ máy nội bộ để đo đạc khả năng chịu tải (RPS) và bẫy lỗi Race Condition.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-sm p-1">
            ✕
          </button>
        </div>

        {/* Configuration Bar */}
        <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-b border-slate-800 bg-slate-900/90 text-xs">
          <label className="flex items-center gap-2">
            <span className="text-slate-300 font-semibold">Virtual Users (Luồng song song):</span>
            <input
              type="number"
              min={1}
              max={50}
              value={concurrency}
              disabled={running}
              onChange={(e) => setConcurrency(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-16 text-center text-slate-200"
            />
          </label>

          <label className="flex items-center gap-2">
            <span className="text-slate-300 font-semibold">Tổng số Request:</span>
            <input
              type="number"
              min={1}
              max={500}
              value={totalRequests}
              disabled={running}
              onChange={(e) => setTotalRequests(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-20 text-center text-slate-200"
            />
          </label>

          <label className="flex items-center gap-2">
            <span className="text-slate-300 font-semibold">Delay giữa req (ms):</span>
            <input
              type="number"
              min={0}
              step={50}
              value={delayMs}
              disabled={running}
              onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-16 text-center text-slate-200"
            />
          </label>

          <div className="ml-auto flex items-center gap-2">
            {!running ? (
              <button
                type="button"
                onClick={startTest}
                className="bg-emerald-600 hover:bg-emerald-500 text-white rounded px-4 py-1.5 font-bold shadow-md transition-all flex items-center gap-1.5"
              >
                <span>▶ Bắt đầu chạy Tải</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={stopTest}
                className="bg-rose-600 hover:bg-rose-500 text-white rounded px-4 py-1.5 font-bold shadow-md transition-all flex items-center gap-1.5 animate-pulse"
              >
                <span>⏹ Dừng lại ({progress?.completed}/{progress?.total})</span>
              </button>
            )}
          </div>
        </div>

        {/* Content & KPIs */}
        <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
          {progress && running && (
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex flex-col gap-2">
              <div className="flex justify-between text-xs text-slate-300 font-semibold">
                <span>Tiến độ kiểm thử: {progress.completed} / {progress.total} reqs</span>
                <span className="text-cyan-400">{progress.currentRps} RPS</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-cyan-500 h-2 transition-all duration-150"
                  style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {report && (
            <div className="flex flex-col gap-4">
              {/* High-level KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 text-center">
                  <div className="text-[11px] text-slate-400 uppercase font-semibold">Throughput (Tốc độ)</div>
                  <div className="text-2xl font-black text-cyan-400 mt-1">{report.rps} <span className="text-xs font-normal">req/s</span></div>
                  <div className="text-[10px] text-slate-500">Trong {report.totalDurationMs}ms</div>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 text-center">
                  <div className="text-[11px] text-slate-400 uppercase font-semibold">Tỷ lệ Lỗi (Error Rate)</div>
                  <div className={`text-2xl font-black mt-1 ${report.errorRate > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {report.errorRate}%
                  </div>
                  <div className="text-[10px] text-slate-500">{report.failed} lỗi / {report.completed} reqs</div>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 text-center">
                  <div className="text-[11px] text-slate-400 uppercase font-semibold">Độ trễ TB (Avg Latency)</div>
                  <div className="text-2xl font-black text-amber-400 mt-1">{report.avgTimeMs} <span className="text-xs font-normal">ms</span></div>
                  <div className="text-[10px] text-slate-500">Min {report.minTimeMs}ms • Max {report.maxTimeMs}ms</div>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 text-center">
                  <div className="text-[11px] text-slate-400 uppercase font-semibold">P95 Latency</div>
                  <div className="text-2xl font-black text-violet-400 mt-1">{report.p95Ms} <span className="text-xs font-normal">ms</span></div>
                  <div className="text-[10px] text-slate-500">P90: {report.p90Ms}ms • P99: {report.p99Ms}ms</div>
                </div>
              </div>

              {/* Status Code Breakdown */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs flex flex-col gap-2">
                <span className="font-bold text-slate-300">Phân bố mã phản hồi (HTTP Status Codes):</span>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(report.statusCodes).map(([code, count]) => {
                    const num = Number(code);
                    const color =
                      num < 300
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                        : num < 400
                        ? 'bg-sky-950 text-sky-300 border-sky-800'
                        : 'bg-rose-950 text-rose-300 border-rose-800';
                    return (
                      <span key={code} className={`px-2 py-1 rounded border font-mono font-bold ${color}`}>
                        {code}: {count} reqs ({Math.round((count / report.completed) * 100)}%)
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Live Request Results Table */}
              <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950 max-h-56 overflow-y-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-900 text-slate-400 sticky top-0 border-b border-slate-800 text-[10px]">
                    <tr>
                      <th className="p-2">#</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Thời gian</th>
                      <th className="p-2">Dung lượng</th>
                      <th className="p-2">Lỗi / Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {results.map((r) => (
                      <tr key={r.id} className={r.ok ? 'hover:bg-slate-900/50' : 'bg-rose-950/20 hover:bg-rose-950/40'}>
                        <td className="p-2 text-slate-500">#{r.id}</td>
                        <td className="p-2 font-bold">
                          <span className={r.ok ? 'text-emerald-400' : 'text-rose-400'}>
                            {r.status ?? 'ERR'}
                          </span>
                        </td>
                        <td className="p-2">{r.timeMs}ms</td>
                        <td className="p-2 text-slate-400">{r.sizeBytes ? `${r.sizeBytes} B` : '—'}</td>
                        <td className="p-2 text-rose-300 truncate max-w-[250px]">{r.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!report && !running && (
            <div className="h-48 flex flex-col items-center justify-center text-center p-6 text-slate-400">
              <span className="text-4xl mb-2">⚡</span>
              <p className="font-semibold text-slate-300">Sẵn sàng chạy Stress Test cục bộ</p>
              <p className="text-xs text-slate-500 mt-1 max-w-md">
                ReqX sẽ dùng các worker bất đồng bộ bắn liên tục request với số luồng cấu hình để kiểm tra độ trễ và khả năng đáp ứng của máy chủ.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
