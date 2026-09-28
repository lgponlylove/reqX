import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/app';
import { resolveVariables } from '../lib/variables';

interface WsLine {
  id: number;
  t: string;
  dir: 'in' | 'out' | 'sys';
  text: string;
}

type Status = 'closed' | 'connecting' | 'open' | 'error';

const time = () => new Date().toLocaleTimeString('vi-VN', { hour12: false });

/** Tester WebSocket: kết nối, gửi/nhận message, log theo thời gian. */
export default function WsTester() {
  const { environments, activeEnvId, globals } = useAppStore();
  const [url, setUrl] = useState('wss://echo.websocket.org');
  const [draft, setDraft] = useState('{"hello":"world"}');
  const [status, setStatus] = useState<Status>('closed');
  const [lines, setLines] = useState<WsLine[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const idRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const envVars = environments.find((e) => e.id === activeEnvId)?.variables ?? {};

  const push = (dir: WsLine['dir'], text: string) =>
    setLines((prev) => [...prev.slice(-499), { id: ++idRef.current, t: time(), dir, text }]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lines.length]);

  useEffect(() => () => wsRef.current?.close(), []);

  const connect = () => {
    if (wsRef.current && (status === 'open' || status === 'connecting')) return;
    const { resolved, missing } = resolveVariables(url, envVars, globals);
    if (missing.length > 0) {
      push('sys', `Thiếu biến: ${missing.map((m) => `{{${m}}}`).join(', ')}`);
      return;
    }
    setStatus('connecting');
    push('sys', `Đang kết nối ${resolved} …`);
    try {
      const ws = new WebSocket(resolved);
      wsRef.current = ws;
      ws.onopen = () => {
        setStatus('open');
        push('sys', '✔ Đã kết nối.');
      };
      ws.onmessage = (ev) => {
        const data = typeof ev.data === 'string' ? ev.data : `[binary ${ev.data?.size ?? '?'} bytes]`;
        push('in', data);
      };
      ws.onclose = (ev) => {
        setStatus('closed');
        push('sys', `✕ Đóng kết nối (code ${ev.code}${ev.reason ? `: ${ev.reason}` : ''}).`);
        wsRef.current = null;
      };
      ws.onerror = () => {
        setStatus('error');
        push('sys', '⚠ Lỗi kết nối (sai URL? server không hỗ trợ WS? CORS không áp dụng cho WS).');
      };
    } catch (e) {
      setStatus('error');
      push('sys', `URL không hợp lệ: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const disconnect = () => wsRef.current?.close();

  const send = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || draft === '') return;
    const { resolved } = resolveVariables(draft, envVars, globals);
    ws.send(resolved);
    push('out', resolved);
  };

  const dot =
    status === 'open' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-500 animate-pulse' : status === 'error' ? 'bg-red-500' : 'bg-slate-600';
  const label =
    status === 'open' ? 'Đã kết nối' : status === 'connecting' ? 'Đang kết nối…' : status === 'error' ? 'Lỗi' : 'Chưa kết nối';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm flex-1 min-w-52">
          URL WebSocket (hỗ trợ {'{{biến}}'})
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="wss://echo.websocket.org"
            spellCheck={false}
            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-sm"
          />
        </label>
        <span className="flex items-center gap-2 text-sm pb-2">
          <span className={`w-2.5 h-2.5 rounded-full ${dot}`} /> {label}
        </span>
        {status === 'open' || status === 'connecting' ? (
          <button onClick={disconnect} className="bg-red-600 hover:bg-red-500 rounded px-4 py-1.5 font-semibold text-sm">
            Ngắt
          </button>
        ) : (
          <button onClick={connect} className="bg-emerald-600 hover:bg-emerald-500 rounded px-4 py-1.5 font-semibold text-sm">
            Kết nối
          </button>
        )}
        <button onClick={() => setLines([])} className="bg-slate-800 hover:bg-slate-700 rounded px-3 py-1.5 text-sm">
          Xóa log
        </button>
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded p-2 h-72 overflow-y-auto font-mono text-xs flex flex-col gap-1">
        {lines.length === 0 && <span className="text-slate-600">Chưa có message. Server echo public để thử: wss://echo.websocket.org</span>}
        {lines.map((l) => (
          <div key={l.id} className="break-all">
            <span className="text-slate-600">[{l.t}] </span>
            {l.dir === 'in' && <span className="text-sky-300">← </span>}
            {l.dir === 'out' && <span className="text-emerald-300">→ </span>}
            {l.dir === 'sys' && <span className="text-amber-300">• </span>}
            <span className={l.dir === 'sys' ? 'text-slate-400' : 'text-slate-200'}>{l.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2">
        <textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') send();
          }}
          placeholder='Nhập message… (Ctrl+Enter để gửi)'
          spellCheck={false}
          className="flex-1 bg-slate-900 border border-slate-700 rounded p-2.5 font-mono text-sm outline-none focus:border-emerald-600"
        />
        <button
          onClick={send}
          disabled={status !== 'open' || draft === ''}
          className="bg-sky-600 hover:bg-sky-500 disabled:opacity-40 rounded px-5 font-semibold text-sm h-fit py-2"
        >
          Gửi
        </button>
      </div>
    </div>
  );
}
