import { useState, useMemo } from 'react';
import type { HistoryItem } from '../types/api';
import { computeDiff, tryFormatJson, type DiffLine } from '../lib/diff';

interface HistoryDiffModalProps {
  itemA: HistoryItem;
  itemB: HistoryItem;
  onClose: () => void;
}

export default function HistoryDiffModal({ itemA, itemB, onClose }: HistoryDiffModalProps) {
  const [tab, setTab] = useState<'body' | 'headers' | 'request'>('body');
  const [formatJson, setFormatJson] = useState(true);

  // Body Diff
  const bodyA = useMemo(() => {
    const raw = itemA.response?.body ?? '';
    return formatJson ? tryFormatJson(raw) : raw;
  }, [itemA.response?.body, formatJson]);

  const bodyB = useMemo(() => {
    const raw = itemB.response?.body ?? '';
    return formatJson ? tryFormatJson(raw) : raw;
  }, [itemB.response?.body, formatJson]);

  const bodyDiffLines: DiffLine[] = useMemo(() => {
    return computeDiff(bodyA, bodyB);
  }, [bodyA, bodyB]);

  // Headers Diff
  const headersA = useMemo(() => {
    return JSON.stringify(itemA.response?.headers ?? {}, null, 2);
  }, [itemA.response?.headers]);

  const headersB = useMemo(() => {
    return JSON.stringify(itemB.response?.headers ?? {}, null, 2);
  }, [itemB.response?.headers]);

  const headersDiffLines: DiffLine[] = useMemo(() => {
    return computeDiff(headersA, headersB);
  }, [headersA, headersB]);

  // Request Diff
  const reqA = useMemo(() => {
    return JSON.stringify(
      {
        method: itemA.request.method,
        url: itemA.request.url,
        params: itemA.request.params,
        headers: itemA.request.headers,
        body: itemA.request.body,
      },
      null,
      2
    );
  }, [itemA.request]);

  const reqB = useMemo(() => {
    return JSON.stringify(
      {
        method: itemB.request.method,
        url: itemB.request.url,
        params: itemB.request.params,
        headers: itemB.request.headers,
        body: itemB.request.body,
      },
      null,
      2
    );
  }, [itemB.request]);

  const reqDiffLines: DiffLine[] = useMemo(() => {
    return computeDiff(reqA, reqB);
  }, [reqA, reqB]);

  const diffCounts = useMemo(() => {
    const lines = tab === 'body' ? bodyDiffLines : tab === 'headers' ? headersDiffLines : reqDiffLines;
    const added = lines.filter((l) => l.type === 'added').length;
    const removed = lines.filter((l) => l.type === 'removed').length;
    return { added, removed };
  }, [tab, bodyDiffLines, headersDiffLines, reqDiffLines]);

  const activeLines = tab === 'body' ? bodyDiffLines : tab === 'headers' ? headersDiffLines : reqDiffLines;

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleTimeString() + ' ' + new Date(ts).toLocaleDateString();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="flex flex-col w-full max-w-5xl h-[85vh] bg-[#0c141e] border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-900/90 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="text-lg">⚖️</span>
            <div>
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                Response & Request Diff Comparison
              </h3>
              <p className="text-xs text-slate-400">
                So sánh sự khác biệt chi tiết giữa 2 lần chạy trong Lịch sử
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* 2 Runs Summary Info */}
        <div className="grid grid-cols-2 divide-x divide-slate-800 bg-slate-950/60 border-b border-slate-800 text-xs px-4 py-2.5">
          {/* Run A (Old / Base) */}
          <div className="pr-3 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-rose-400 flex items-center gap-1">
                <span>🔴</span> Bản A (Gốc)
              </span>
              <span className="text-slate-400 font-mono">{formatDate(itemA.createdAt)}</span>
            </div>
            <div className="flex items-center gap-2 font-mono">
              <span className="px-1.5 py-0.5 rounded bg-slate-800 font-bold">{itemA.request.method}</span>
              <span className="truncate flex-1 text-slate-300" title={itemA.request.url}>{itemA.request.url}</span>
              <span className={`px-1.5 py-0.5 rounded font-bold ${itemA.responseStatus >= 200 && itemA.responseStatus < 300 ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'}`}>
                {itemA.responseStatus || 'N/A'}
              </span>
              <span className="text-slate-400">{itemA.timeMs}ms</span>
            </div>
          </div>

          {/* Run B (New / Compared) */}
          <div className="pl-3 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-emerald-400 flex items-center gap-1">
                <span>🟢</span> Bản B (So sánh)
              </span>
              <span className="text-slate-400 font-mono">{formatDate(itemB.createdAt)}</span>
            </div>
            <div className="flex items-center gap-2 font-mono">
              <span className="px-1.5 py-0.5 rounded bg-slate-800 font-bold">{itemB.request.method}</span>
              <span className="truncate flex-1 text-slate-300" title={itemB.request.url}>{itemB.request.url}</span>
              <span className={`px-1.5 py-0.5 rounded font-bold ${itemB.responseStatus >= 200 && itemB.responseStatus < 300 ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'}`}>
                {itemB.responseStatus || 'N/A'}
              </span>
              <span className="text-slate-400">{itemB.timeMs}ms</span>
            </div>
          </div>
        </div>

        {/* Tab & Controls Bar */}
        <div className="flex items-center justify-between px-5 py-2 bg-slate-900/60 border-b border-slate-800 text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTab('body')}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                tab === 'body' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              Response Body Diff
            </button>
            <button
              onClick={() => setTab('headers')}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                tab === 'headers' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              Headers Diff
            </button>
            <button
              onClick={() => setTab('request')}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                tab === 'request' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              Request Config Diff
            </button>
          </div>

          <div className="flex items-center gap-3">
            {tab === 'body' && (
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={formatJson}
                  onChange={(e) => setFormatJson(e.target.checked)}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                />
                <span>Format JSON</span>
              </label>
            )}
            <div className="flex items-center gap-2 font-mono">
              <span className="text-emerald-400 font-bold">+{diffCounts.added}</span>
              <span className="text-rose-400 font-bold">-{diffCounts.removed}</span>
            </div>
          </div>
        </div>

        {/* Diff Content Viewer */}
        <div className="flex-1 overflow-auto bg-slate-950 font-mono text-xs select-text">
          {activeLines.length === 0 ? (
            <div className="p-8 text-center text-slate-500">Hai nội dung hoàn toàn giống nhau (0 khác biệt).</div>
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                {activeLines.map((line, idx) => {
                  const isAdd = line.type === 'added';
                  const isRem = line.type === 'removed';
                  const rowBg = isAdd ? 'bg-emerald-950/30 text-emerald-200' : isRem ? 'bg-rose-950/30 text-rose-200' : 'text-slate-300 hover:bg-slate-900/40';
                  const sign = isAdd ? '+' : isRem ? '-' : ' ';
                  const signColor = isAdd ? 'text-emerald-400 font-bold' : isRem ? 'text-rose-400 font-bold' : 'text-transparent';

                  return (
                    <tr key={idx} className={`${rowBg} transition-colors border-b border-transparent`}>
                      <td className="w-10 select-none py-0.5 px-2 text-right text-slate-600 border-r border-slate-900">
                        {line.oldLineNum ?? ''}
                      </td>
                      <td className="w-10 select-none py-0.5 px-2 text-right text-slate-600 border-r border-slate-900">
                        {line.newLineNum ?? ''}
                      </td>
                      <td className={`w-6 select-none py-0.5 px-1.5 text-center ${signColor}`}>
                        {sign}
                      </td>
                      <td className="py-0.5 px-2 whitespace-pre overflow-x-auto">
                        {line.line || ' '}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
