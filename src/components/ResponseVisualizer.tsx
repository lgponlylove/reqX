import { useMemo, useState } from 'react';
import type { ApiResponse } from '../types/api';
import type { ScriptOutcome } from '../lib/scripts';

interface ResponseVisualizerProps {
  response: ApiResponse;
  testRun?: ScriptOutcome | null;
  tall?: boolean;
}

type VisualizerMode = 'table' | 'bar' | 'line' | 'pie' | 'cards' | 'custom';

const PALETTE = [
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ec4899', // pink
  '#8b5cf6', // purple
  '#3b82f6', // blue
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
  '#ef4444', // red
];

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180.0;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeDonutSlice(cx: number, cy: number, rOut: number, rIn: number, startAngle: number, endAngle: number): string {
  // Clamp angle delta to avoid SVG zero-arc anomaly
  const delta = Math.min(359.99, Math.max(0.01, endAngle - startAngle));
  const effectiveEnd = startAngle + delta;
  const p1 = polarToCartesian(cx, cy, rOut, startAngle);
  const p2 = polarToCartesian(cx, cy, rOut, effectiveEnd);
  const p3 = polarToCartesian(cx, cy, rIn, effectiveEnd);
  const p4 = polarToCartesian(cx, cy, rIn, startAngle);
  const largeArc = delta > 180 ? 1 : 0;
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${rOut} ${rOut} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)} A ${rIn} ${rIn} 0 ${largeArc} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)} Z`;
}

export default function ResponseVisualizer({ response, testRun, tall }: ResponseVisualizerProps) {
  // Parse and extract structured data from response body
  const parsed = useMemo(() => {
    if (!response.body || response.bodyKind === 'binary') return null;
    try {
      return JSON.parse(response.body);
    } catch {
      return null;
    }
  }, [response.body, response.bodyKind]);

  // Extract array of tabular records
  const records: Record<string, unknown>[] = useMemo(() => {
    if (!parsed) return [];
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
    }
    if (typeof parsed === 'object') {
      const candidates = ['data', 'items', 'results', 'records', 'list', 'rows', 'users', 'products', 'orders'];
      for (const key of candidates) {
        if (Array.isArray(parsed[key]) && parsed[key].length > 0) {
          return parsed[key].filter((item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null);
        }
      }
      for (const val of Object.values(parsed)) {
        if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object' && val[0] !== null) {
          return val.filter((item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null);
        }
      }
      // If flat key-value dictionary, convert to [{ key, value }]
      const entries = Object.entries(parsed);
      if (entries.length > 0 && entries.every(([_, v]) => typeof v !== 'object' || v === null)) {
        return entries.map(([k, v]) => ({ key: k, value: v }));
      }
    }
    return [];
  }, [parsed]);

  // Detect available columns
  const { allColumns, numericColumns, stringColumns } = useMemo(() => {
    if (records.length === 0) return { allColumns: [], numericColumns: [], stringColumns: [] };
    const colSet = new Set<string>();
    records.slice(0, 100).forEach((rec) => {
      Object.keys(rec).forEach((k) => colSet.add(k));
    });
    const cols = Array.from(colSet);
    const numCols: string[] = [];
    const strCols: string[] = [];

    cols.forEach((col) => {
      let numCount = 0;
      let totalValid = 0;
      for (let i = 0; i < Math.min(records.length, 50); i++) {
        const val = records[i][col];
        if (val !== undefined && val !== null && val !== '') {
          totalValid++;
          if (typeof val === 'number' || (!isNaN(Number(val)) && typeof val === 'string' && val.trim() !== '')) {
            numCount++;
          }
        }
      }
      if (totalValid > 0 && numCount / totalValid >= 0.7) {
        numCols.push(col);
      } else {
        strCols.push(col);
      }
    });

    return { allColumns: cols, numericColumns: numCols, stringColumns: strCols };
  }, [records]);

  // Mode state
  const hasCustomHtml = Boolean(testRun?.visualizerHtml);
  const [mode, setMode] = useState<VisualizerMode>(hasCustomHtml ? 'custom' : (numericColumns.length > 0 ? 'bar' : 'table'));
  const [searchTerm, setSearchTerm] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Selected X & Y axes for charts
  const [xCol, setXCol] = useState<string>(stringColumns[0] || allColumns[0] || '');
  const [yCol, setYCol] = useState<string>(numericColumns[0] || allColumns[1] || allColumns[0] || '');
  const [maxDataPoints, setMaxDataPoints] = useState<number>(15);

  // Filtered & sorted records for table view
  const filteredRecords = useMemo(() => {
    let result = records;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter((row) =>
        Object.values(row).some((val) => String(val ?? '').toLowerCase().includes(q))
      );
    }
    if (sortCol) {
      result = [...result].sort((a, b) => {
        const vA = a[sortCol];
        const vB = b[sortCol];
        if (vA === vB) return 0;
        if (vA === undefined || vA === null) return 1;
        if (vB === undefined || vB === null) return -1;
        const numA = Number(vA);
        const numB = Number(vB);
        if (!isNaN(numA) && !isNaN(numB)) {
          return sortDir === 'asc' ? numA - numB : numB - numA;
        }
        return sortDir === 'asc' ? String(vA).localeCompare(String(vB)) : String(vB).localeCompare(String(vA));
      });
    }
    return result;
  }, [records, searchTerm, sortCol, sortDir]);

  // Paged records
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, currentPage, pageSize]);

  // Chart data extraction
  const chartData = useMemo(() => {
    if (records.length === 0 || !xCol || !yCol) return [];
    const points: { label: string; value: number }[] = [];
    for (let i = 0; i < records.length; i++) {
      if (points.length >= maxDataPoints) break;
      const rec = records[i];
      const rawX = rec[xCol];
      const rawY = rec[yCol];
      const label = rawX === undefined || rawX === null ? `#${i + 1}` : String(rawX);
      const value = Number(rawY);
      if (!isNaN(value)) {
        points.push({ label: label.length > 20 ? label.slice(0, 18) + '…' : label, value });
      }
    }
    return points;
  }, [records, xCol, yCol, maxDataPoints]);

  // Stats calculation
  const stats = useMemo(() => {
    if (chartData.length === 0) return null;
    const values = chartData.map((d) => d.value);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { count: values.length, sum, avg, min, max };
  }, [chartData]);

  // Copy helpers
  const [copiedText, setCopiedText] = useState(false);
  const copyAsCsv = async () => {
    if (records.length === 0) return;
    const headers = allColumns.join(',');
    const rows = filteredRecords.map((r) =>
      allColumns.map((col) => {
        const val = String(r[col] ?? '').replace(/"/g, '""');
        return `"${val}"`;
      }).join(',')
    );
    const csv = [headers, ...rows].join('\n');
    try {
      await navigator.clipboard.writeText(csv);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 1500);
    } catch {
      // fallback
    }
  };

  const containerHeight = tall ? 'flex-1 min-h-0' : 'max-h-[500px]';

  if (!parsed) {
    return (
      <div className={`p-8 text-center bg-slate-950/80 border border-slate-800 rounded-lg text-slate-400 font-sans ${containerHeight}`}>
        <div className="text-3xl mb-2">📊</div>
        <div className="text-sm font-semibold text-slate-300">Không có dữ liệu JSON để trực quan hóa</div>
        <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
          Response này không phải JSON hoặc rỗng. Trực quan hóa hỗ trợ mảng dữ liệu (users, orders, metrics...) hoặc bảng JSON.
        </p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2.5 bg-slate-950/95 border border-slate-800 rounded-lg p-3 ${containerHeight} overflow-auto text-slate-200 font-sans`}>
      {/* Visualizer Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-1.5 flex-wrap">
          {hasCustomHtml && (
            <button
              onClick={() => setMode('custom')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                mode === 'custom' ? 'bg-fuchsia-600 text-white font-bold shadow-sm' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>🎨</span> Custom (pm.visualizer)
            </button>
          )}
          <button
            onClick={() => setMode('table')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
              mode === 'table' ? 'bg-cyan-600 text-white font-bold shadow-sm' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>📋</span> Bảng dữ liệu ({records.length})
          </button>
          {numericColumns.length > 0 && (
            <>
              <button
                onClick={() => setMode('bar')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                  mode === 'bar' ? 'bg-emerald-600 text-white font-bold shadow-sm' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>📊</span> Cột (Bar)
              </button>
              <button
                onClick={() => setMode('line')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                  mode === 'line' ? 'bg-sky-600 text-white font-bold shadow-sm' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>📈</span> Đường (Line)
              </button>
              <button
                onClick={() => setMode('pie')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                  mode === 'pie' ? 'bg-amber-600 text-white font-bold shadow-sm' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>🥧</span> Tròn (Pie)
              </button>
            </>
          )}
          <button
            onClick={() => setMode('cards')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
              mode === 'cards' ? 'bg-purple-600 text-white font-bold shadow-sm' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🗂️</span> Thẻ KPI
          </button>
        </div>

        {/* Action button */}
        <div className="flex items-center gap-2">
          {mode === 'table' && (
            <button
              onClick={copyAsCsv}
              className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-[11px] font-mono text-slate-300 border border-slate-700/80 transition-colors"
            >
              {copiedText ? '✓ Đã chép CSV' : '📋 Sao chép CSV'}
            </button>
          )}
        </div>
      </div>

      {/* Mode: Custom pm.visualizer */}
      {mode === 'custom' && testRun?.visualizerHtml && (
        <div className="flex-1 min-h-[350px] bg-white rounded overflow-hidden border border-slate-700">
          <iframe
            title="Custom Visualizer"
            srcDoc={testRun.visualizerHtml}
            sandbox="allow-scripts allow-forms allow-same-origin"
            className="w-full h-full min-h-[400px] border-none"
          />
        </div>
      )}

      {/* Chart Configuration Bar (for Bar / Line / Pie) */}
      {(mode === 'bar' || mode === 'line' || mode === 'pie') && numericColumns.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Trục X (Nhãn):</span>
            <select
              value={xCol}
              onChange={(e) => setXCol(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs font-mono outline-none focus:border-cyan-500"
            >
              {allColumns.map((col) => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Trục Y (Giá trị):</span>
            <select
              value={yCol}
              onChange={(e) => setYCol(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs font-mono outline-none focus:border-cyan-500"
            >
              {numericColumns.map((col) => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-slate-400">Số điểm:</span>
            <select
              value={maxDataPoints}
              onChange={(e) => setMaxDataPoints(Number(e.target.value))}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs font-mono outline-none focus:border-cyan-500"
            >
              <option value={10}>Top 10</option>
              <option value={15}>Top 15</option>
              <option value={25}>Top 25</option>
              <option value={50}>Top 50</option>
            </select>
          </div>
        </div>
      )}

      {/* Stats Summary Bar */}
      {(mode === 'bar' || mode === 'line' || mode === 'pie') && stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          <div className="bg-slate-900/60 border border-slate-800 rounded p-2 text-center">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Số điểm</div>
            <div className="font-mono font-bold text-slate-200 text-sm mt-0.5">{stats.count}</div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded p-2 text-center">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Tổng</div>
            <div className="font-mono font-bold text-cyan-400 text-sm mt-0.5">{stats.sum.toLocaleString('vi-VN')}</div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded p-2 text-center">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Trung bình</div>
            <div className="font-mono font-bold text-emerald-400 text-sm mt-0.5">{stats.avg.toFixed(1)}</div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded p-2 text-center">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Lớn nhất</div>
            <div className="font-mono font-bold text-amber-400 text-sm mt-0.5">{stats.max.toLocaleString('vi-VN')}</div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded p-2 text-center">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Nhỏ nhất</div>
            <div className="font-mono font-bold text-purple-400 text-sm mt-0.5">{stats.min.toLocaleString('vi-VN')}</div>
          </div>
        </div>
      )}

      {/* Mode: Bar Chart */}
      {mode === 'bar' && chartData.length > 0 && (
        <div className="flex-1 min-h-[300px] flex flex-col justify-center bg-slate-900/40 border border-slate-800/80 rounded-lg p-4 relative">
          {(() => {
            const svgW = 640;
            const svgH = 260;
            const padT = 20;
            const padB = 40;
            const padL = 55;
            const padR = 25;
            const plotW = svgW - padL - padR;
            const plotH = svgH - padT - padB;
            const maxVal = Math.max(...chartData.map((d) => d.value), 1);
            const slotW = plotW / chartData.length;
            const barW = Math.max(6, Math.min(32, slotW * 0.65));

            return (
              <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-auto max-h-[350px]">
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.4" />
                  </linearGradient>
                  <linearGradient id="barGradActive" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="1" />
                    <stop offset="100%" stopColor="#34d399" stopOpacity="0.8" />
                  </linearGradient>
                </defs>
                {/* Horizontal Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                  const y = padT + plotH * (1 - pct);
                  const val = maxVal * pct;
                  return (
                    <g key={pct}>
                      <line x1={padL} y1={y} x2={svgW - padR} y2={y} stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />
                      <text x={padL - 6} y={y + 3.5} textAnchor="end" fill="#94a3b8" fontSize="9" fontFamily="monospace">
                        {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(0)}
                      </text>
                    </g>
                  );
                })}
                {/* Bars */}
                {chartData.map((d, i) => {
                  const barH = (d.value / maxVal) * plotH;
                  const x = padL + i * slotW + (slotW - barW) / 2;
                  const y = padT + (plotH - barH);
                  const isHovered = hoveredIndex === i;

                  return (
                    <g
                      key={i}
                      onMouseEnter={() => setHoveredIndex(i)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      className="cursor-pointer"
                    >
                      <rect
                        x={x}
                        y={y}
                        width={barW}
                        height={Math.max(2, barH)}
                        rx={3}
                        fill={isHovered ? 'url(#barGradActive)' : 'url(#barGrad)'}
                        stroke={isHovered ? '#38bdf8' : 'none'}
                        strokeWidth={isHovered ? 1.5 : 0}
                      />
                      {/* X label */}
                      <text
                        x={x + barW / 2}
                        y={padT + plotH + 16}
                        textAnchor="middle"
                        fill={isHovered ? '#38bdf8' : '#94a3b8'}
                        fontSize="9"
                        className="truncate"
                      >
                        {d.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            );
          })()}

          {/* Hover Tooltip */}
          {hoveredIndex !== null && chartData[hoveredIndex] && (
            <div className="absolute top-2 right-2 bg-slate-900 border border-cyan-500/80 px-2.5 py-1.5 rounded shadow-lg text-xs font-mono z-10">
              <span className="text-cyan-300 font-bold">{chartData[hoveredIndex].label}</span>
              <div className="text-emerald-400 font-semibold">{chartData[hoveredIndex].value.toLocaleString('vi-VN')}</div>
            </div>
          )}
        </div>
      )}

      {/* Mode: Line Chart */}
      {mode === 'line' && chartData.length > 0 && (
        <div className="flex-1 min-h-[300px] flex flex-col justify-center bg-slate-900/40 border border-slate-800/80 rounded-lg p-4 relative">
          {(() => {
            const svgW = 640;
            const svgH = 260;
            const padT = 20;
            const padB = 40;
            const padL = 55;
            const padR = 25;
            const plotW = svgW - padL - padR;
            const plotH = svgH - padT - padB;
            const maxVal = Math.max(...chartData.map((d) => d.value), 1);
            const slotW = plotW / Math.max(1, chartData.length - 1);

            const points = chartData.map((d, i) => {
              const x = padL + i * slotW;
              const y = padT + plotH - (d.value / maxVal) * plotH;
              return { x, y, ...d };
            });

            const polyPoints = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
            const areaPoints = `${padL},${padT + plotH} ${polyPoints} ${padL + plotW},${padT + plotH}`;

            return (
              <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-auto max-h-[350px]">
                <defs>
                  <linearGradient id="lineAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                {/* Horizontal Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                  const y = padT + plotH * (1 - pct);
                  const val = maxVal * pct;
                  return (
                    <g key={pct}>
                      <line x1={padL} y1={y} x2={svgW - padR} y2={y} stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />
                      <text x={padL - 6} y={y + 3.5} textAnchor="end" fill="#94a3b8" fontSize="9" fontFamily="monospace">
                        {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(0)}
                      </text>
                    </g>
                  );
                })}
                {/* Area under curve */}
                <polygon points={areaPoints} fill="url(#lineAreaGrad)" />
                {/* Line */}
                <polyline points={polyPoints} fill="none" stroke="#06b6d4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                {/* Dots */}
                {points.map((p, i) => {
                  const isHovered = hoveredIndex === i;
                  return (
                    <g
                      key={i}
                      onMouseEnter={() => setHoveredIndex(i)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      className="cursor-pointer"
                    >
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={isHovered ? 6 : 4}
                        fill={isHovered ? '#38bdf8' : '#0e7490'}
                        stroke="#082f49"
                        strokeWidth="2"
                      />
                      <text
                        x={p.x}
                        y={padT + plotH + 16}
                        textAnchor="middle"
                        fill={isHovered ? '#38bdf8' : '#94a3b8'}
                        fontSize="9"
                      >
                        {p.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            );
          })()}

          {/* Hover Tooltip */}
          {hoveredIndex !== null && chartData[hoveredIndex] && (
            <div className="absolute top-2 right-2 bg-slate-900 border border-cyan-500/80 px-2.5 py-1.5 rounded shadow-lg text-xs font-mono z-10">
              <span className="text-cyan-300 font-bold">{chartData[hoveredIndex].label}</span>
              <div className="text-cyan-400 font-semibold">{chartData[hoveredIndex].value.toLocaleString('vi-VN')}</div>
            </div>
          )}
        </div>
      )}

      {/* Mode: Pie / Donut Chart */}
      {mode === 'pie' && chartData.length > 0 && (
        <div className="flex-1 min-h-[300px] flex flex-col md:flex-row items-center justify-center gap-6 bg-slate-900/40 border border-slate-800/80 rounded-lg p-4">
          {(() => {
            const size = 260;
            const cx = size / 2;
            const cy = size / 2;
            const rOut = 110;
            const rIn = 65;
            const total = chartData.reduce((acc, d) => acc + Math.max(0, d.value), 0);

            let currentAngle = 0;
            const slices = chartData.map((d, i) => {
              const val = Math.max(0, d.value);
              const angle = total > 0 ? (val / total) * 360 : 0;
              const startA = currentAngle;
              const endA = currentAngle + angle;
              currentAngle = endA;
              const color = PALETTE[i % PALETTE.length];
              const path = describeDonutSlice(cx, cy, rOut, rIn, startA, endA);
              const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
              return { ...d, color, path, pct, index: i };
            });

            return (
              <>
                <div className="relative">
                  <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                    {slices.map((s) => (
                      <path
                        key={s.index}
                        d={s.path}
                        fill={s.color}
                        opacity={hoveredIndex === null || hoveredIndex === s.index ? 0.9 : 0.4}
                        stroke="#0f172a"
                        strokeWidth="2"
                        className="transition-all duration-200 cursor-pointer hover:opacity-100"
                        onMouseEnter={() => setHoveredIndex(s.index)}
                        onMouseLeave={() => setHoveredIndex(null)}
                      />
                    ))}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">TỔNG</span>
                    <span className="text-sm font-mono font-bold text-slate-200 mt-0.5">
                      {total.toLocaleString('vi-VN')}
                    </span>
                  </div>
                </div>

                {/* Legend list */}
                <div className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto pr-2 min-w-[200px]">
                  {slices.map((s) => (
                    <div
                      key={s.index}
                      onMouseEnter={() => setHoveredIndex(s.index)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      className={`flex items-center justify-between gap-3 text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
                        hoveredIndex === s.index ? 'bg-slate-800' : 'hover:bg-slate-900/60'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                        <span className="truncate text-slate-300">{s.label}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
                        <span className="text-slate-400">{s.value.toLocaleString('vi-VN')}</span>
                        <span className="text-cyan-400 font-bold">{s.pct}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Mode: Table View */}
      {mode === 'table' && (
        <div className="flex-1 flex flex-col min-h-0 gap-2">
          {/* Search & Page control */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="relative flex-1 max-w-xs">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                placeholder="🔍 Lọc trong bảng..."
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500 font-sans"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Hiển thị</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-200 font-mono outline-none"
              >
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
              <span>dòng / trang (tổng {filteredRecords.length})</span>
            </div>
          </div>

          {/* Table Container */}
          <div className="flex-1 min-h-[220px] overflow-auto border border-slate-800 rounded-lg">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-700/80 z-10">
                <tr>
                  <th className="py-2 px-3 text-slate-500 font-mono text-[10px] w-12 text-center">#</th>
                  {allColumns.map((col) => (
                    <th
                      key={col}
                      onClick={() => {
                        if (sortCol === col) {
                          setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
                        } else {
                          setSortCol(col);
                          setSortDir('asc');
                        }
                      }}
                      className="py-2 px-3 text-slate-300 font-semibold cursor-pointer hover:bg-slate-800/80 transition-colors whitespace-nowrap"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>{col}</span>
                        {sortCol === col && (
                          <span className="text-cyan-400 font-mono text-[10px]">
                            {sortDir === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                {pagedRecords.length === 0 ? (
                  <tr>
                    <td colSpan={allColumns.length + 1} className="py-8 text-center text-slate-500">
                      Không tìm thấy bản ghi nào khớp với điều kiện tìm kiếm.
                    </td>
                  </tr>
                ) : (
                  pagedRecords.map((row, rowIdx) => (
                    <tr key={rowIdx} className="hover:bg-slate-900/60 transition-colors">
                      <td className="py-1.5 px-3 text-slate-600 text-center select-none text-[10px]">
                        {(currentPage - 1) * pageSize + rowIdx + 1}
                      </td>
                      {allColumns.map((col) => {
                        const cellVal = row[col];
                        const isNum = typeof cellVal === 'number';
                        const isBool = typeof cellVal === 'boolean';
                        const isNull = cellVal === null || cellVal === undefined;
                        return (
                          <td key={col} className="py-1.5 px-3 whitespace-nowrap max-w-xs truncate">
                            {isNull ? (
                              <span className="text-slate-600 italic">null</span>
                            ) : isBool ? (
                              <span className={cellVal ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                                {String(cellVal)}
                              </span>
                            ) : isNum ? (
                              <span className="text-emerald-300 font-bold">
                                {cellVal.toLocaleString('vi-VN')}
                              </span>
                            ) : (
                              <span className="text-slate-300">{String(cellVal)}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination bar */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-1 text-xs text-slate-400">
              <div>
                Trang <b className="text-slate-200">{currentPage}</b> / {totalPages}
              </div>
              <div className="flex items-center gap-1">
                <button
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-slate-300"
                >
                  ← Trước
                </button>
                <button
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-slate-300"
                >
                  Sau →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mode: KPI Cards View */}
      {mode === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 overflow-y-auto p-1">
          {records.slice(0, 40).map((row, i) => {
            const title = String(row[stringColumns[0] || allColumns[0]] ?? `Mục #${i + 1}`);
            const mainNumCol = numericColumns[0] || allColumns[1];
            const mainNumVal = mainNumCol ? row[mainNumCol] : null;

            return (
              <div key={i} className="bg-slate-900/60 border border-slate-800 hover:border-slate-700 p-3 rounded-xl flex flex-col justify-between shadow-sm transition-all hover:-translate-y-0.5">
                <div>
                  <div className="text-xs font-semibold text-slate-200 truncate" title={title}>
                    {title}
                  </div>
                  {mainNumCol && mainNumVal !== null && (
                    <div className="mt-1 text-base font-bold font-mono text-cyan-400">
                      {typeof mainNumVal === 'number' ? mainNumVal.toLocaleString('vi-VN') : String(mainNumVal)}
                      <span className="text-[10px] text-slate-500 font-normal ml-1.5">{mainNumCol}</span>
                    </div>
                  )}
                </div>
                <div className="mt-3 pt-2 border-t border-slate-800/80 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400 font-mono">
                  {allColumns.slice(0, 4).map((col) => (
                    <div key={col} className="truncate">
                      <span className="text-slate-500">{col}:</span> <span className="text-slate-300">{String(row[col] ?? '—')}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
