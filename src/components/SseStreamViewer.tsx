import { useState, useMemo, useRef, useEffect } from 'react';
import type { ApiResponse, SseEvent } from '../types/api';
import { reconstructLlmMessage, extractLlmDelta } from '../lib/sse-parser';
import { useAppStore } from '../stores/app';

interface Props {
  response: ApiResponse;
  tall?: boolean;
}

type SseTab = 'llm' | 'events' | 'raw';

export default function SseStreamViewer({ response, tall }: Props) {
  const [subTab, setSubTab] = useState<SseTab>('llm');
  const [filterQuery, setFilterQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedLlm, setCopiedLlm] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [expandedEventIdx, setExpandedEventIdx] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const { abortCurrentRequest } = useAppStore();

  const events: SseEvent[] = useMemo(() => {
    return response.sseEvents ?? [];
  }, [response.sseEvents]);

  const llmText = useMemo(() => {
    return reconstructLlmMessage(events);
  }, [events]);

  const isStreaming = response.isStream && !response.streamCompleted;

  // Auto-scroll to bottom when new streaming chunks arrive
  useEffect(() => {
    if (autoScroll && isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length, llmText, autoScroll, isStreaming]);

  const filteredEvents = useMemo(() => {
    if (!filterQuery.trim()) return events;
    const q = filterQuery.toLowerCase();
    return events.filter(
      (ev) =>
        (ev.event && ev.event.toLowerCase().includes(q)) ||
        (ev.id && ev.id.toLowerCase().includes(q)) ||
        ev.data.toLowerCase().includes(q),
    );
  }, [events, filterQuery]);

  async function copyLlm() {
    try {
      await navigator.clipboard.writeText(llmText);
      setCopiedLlm(true);
      setTimeout(() => setCopiedLlm(false), 1500);
    } catch {
      setCopiedLlm(false);
    }
  }

  async function copyRaw() {
    try {
      await navigator.clipboard.writeText(response.body);
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 1500);
    } catch {
      setCopiedRaw(false);
    }
  }

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(events, null, 2));
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 1500);
    } catch {
      setCopiedJson(false);
    }
  }

  const containerH = tall ? 'flex-1 min-h-0 flex flex-col' : 'max-h-[500px] flex flex-col';

  return (
    <div className={`bg-slate-950 dark:bg-[#09111a] border border-cyan-500/30 rounded-xl overflow-hidden shadow-lg ${containerH}`}>
      {/* Sub-header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-900/90 dark:bg-[#0d1824]/90 border-b border-slate-800 text-xs shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSubTab('llm')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-all flex items-center gap-1.5 ${
              subTab === 'llm'
                ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/50 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>💬</span>
            <span>Tin nhắn AI</span>
            {llmText && (
              <span className="text-[10px] px-1 py-0.2 bg-cyan-950/80 border border-cyan-800/80 rounded font-mono text-cyan-300">
                {llmText.length} ký tự
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSubTab('events')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-all flex items-center gap-1.5 ${
              subTab === 'events'
                ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/50 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>📋</span>
            <span>Danh sách sự kiện</span>
            <span className="text-[10px] px-1.5 py-0.2 bg-slate-800 rounded font-mono text-slate-300">
              {events.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('raw')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-all flex items-center gap-1.5 ${
              subTab === 'raw'
                ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/50 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>📄</span>
            <span>Raw Stream</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Live Status indicator & Stop Button */}
          {isStreaming ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                LIVE STREAMING...
              </span>
              {abortCurrentRequest && (
                <button
                  type="button"
                  onClick={abortCurrentRequest}
                  className="px-2 py-0.5 rounded text-xs bg-rose-950/90 hover:bg-rose-900 border border-rose-700/80 text-rose-300 font-semibold flex items-center gap-1 transition-colors shadow-sm"
                  title="Dừng luồng stream và giữ lại nội dung đã tải về"
                >
                  <span>⏹</span>
                  <span>Dừng Stream</span>
                </button>
              )}
            </div>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
              ✓ Stream Hoàn Tất
            </span>
          )}

          <label className="flex items-center gap-1 text-[11px] text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded bg-slate-800 border-slate-700 text-cyan-500 focus:ring-0"
            />
            <span>Cuộn tự động</span>
          </label>
        </div>
      </div>

      {/* Main Content Area */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 text-xs font-mono">
        {/* Tab 1: Reconstructed LLM Message */}
        {subTab === 'llm' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800/80 pb-1.5">
              <span>
                Nội dung AI trích xuất từ <b>{events.length}</b> SSE delta events:
              </span>
              <button
                type="button"
                onClick={copyLlm}
                disabled={!llmText}
                className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded transition-colors flex items-center gap-1"
              >
                <span>{copiedLlm ? '✓ Đã sao chép' : '📋 Sao chép tin nhắn AI'}</span>
              </button>
            </div>

            {llmText ? (
              <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800/80 whitespace-pre-wrap leading-relaxed text-slate-100 font-sans text-sm selection:bg-cyan-500/30">
                {llmText}
                {isStreaming && (
                  <span className="inline-block w-2 h-4 ml-1 bg-cyan-400 animate-pulse align-middle" />
                )}
              </div>
            ) : (
              <div className="p-6 text-center text-slate-500 italic">
                {isStreaming ? 'Đang đợi dữ liệu stream đầu tiên...' : 'Không có nội dung text/delta từ các SSE events.'}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Events List */}
        {subTab === 'events' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
              <input
                type="text"
                placeholder="🔍 Lọc sự kiện theo tên event hoặc nội dung data..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500/60"
              />
              <button
                type="button"
                onClick={copyJson}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded whitespace-nowrap transition-colors"
              >
                {copiedJson ? '✓ Đã sao chép' : '📋 Sao chép JSON'}
              </button>
            </div>

            {filteredEvents.length === 0 ? (
              <div className="p-6 text-center text-slate-500 italic">
                {filterQuery ? 'Không tìm thấy sự kiện nào khớp bộ lọc.' : 'Chưa nhận được sự kiện SSE nào.'}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {filteredEvents.map((ev, idx) => {
                  const delta = extractLlmDelta(ev.data);
                  const isExpanded = expandedEventIdx === idx;
                  return (
                    <div
                      key={idx}
                      className="bg-slate-900/70 border border-slate-800/90 hover:border-slate-700 rounded-lg p-2 transition-all flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400">
                            #{idx + 1}
                          </span>
                          <span className="text-xs font-semibold text-slate-300">
                            event: <span className="text-amber-400">{ev.event || 'message'}</span>
                          </span>
                          {ev.id && (
                            <span className="text-[10px] text-slate-400">
                              id: <span className="text-sky-300">{ev.id}</span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {delta && (
                            <span className="text-[10px] text-emerald-400/90 bg-emerald-950/60 border border-emerald-900 px-1.5 py-0.2 rounded truncate max-w-[200px]">
                              delta: "{delta}"
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setExpandedEventIdx(isExpanded ? null : idx)}
                            className="text-[11px] text-slate-400 hover:text-slate-200 px-1.5 py-0.5 bg-slate-800/80 rounded"
                          >
                            {isExpanded ? 'Thu gọn ▲' : 'Xem chi tiết ▼'}
                          </button>
                        </div>
                      </div>

                      {/* Preview / Expanded Data */}
                      {isExpanded ? (
                        <pre className="mt-1 p-2 bg-slate-950 rounded border border-slate-800 text-[11px] text-slate-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                          {ev.data}
                        </pre>
                      ) : (
                        <div className="text-[11px] text-slate-400 truncate font-mono">
                          data: {ev.data}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Raw Stream */}
        {subTab === 'raw' && (
          <div className="flex flex-col gap-2">
            <div className="flex justify-end pb-1 border-b border-slate-800/80">
              <button
                type="button"
                onClick={copyRaw}
                className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded transition-colors"
              >
                {copiedRaw ? '✓ Đã sao chép' : '📋 Sao chép Raw'}
              </button>
            </div>
            <pre className="whitespace-pre-wrap leading-relaxed text-slate-300 p-2 bg-slate-950 rounded">
              {response.body || '(stream trống)'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
