import { useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import CommandPalette from './components/CommandPalette';
import RequestBar from './components/RequestBar';
import RequestTabs from './components/RequestTabs';
import ResponseViewer from './components/ResponseViewer';
import Runner from './components/Runner';
import WsTester from './components/WsTester';
import GrpcTester from './components/GrpcTester';
import Flow from './components/Flow';
import AiAssistant from './components/AiAssistant';
import { useScheduleStore } from './stores/schedule';
import { runScheduleNow } from './lib/scheduleEngine';

type View = 'builder' | 'runner' | 'flow' | 'ws' | 'grpc' | 'ai';

const VIEWS: { id: View; label: string }[] = [
  { id: 'builder', label: '🔨 Builder' },
  { id: 'runner', label: '▶ Runner' },
  { id: 'flow', label: '🔗 Flow' },
  { id: 'ws', label: '🔌 WebSocket' },
  { id: 'grpc', label: '🚀 gRPC' },
  { id: 'ai', label: '✨ AI' },
];

const LS_SIDE_W = 'postman-clone-sidebar-w';

export default function App() {
  const [view, setView] = useState<View>('builder');
  // Headless once-mode cho cron hệ thống: ?once=<scheduleId>&close=1
  const [onceId] = useState(() => new URLSearchParams(location.search).get('once'));
  const [sideW, setSideW] = useState(() => {
    const v = Number(localStorage.getItem(LS_SIDE_W));
    return v >= 200 && v <= 600 ? v : 300;
  });
  const [sideOpen, setSideOpen] = useState(true);
  const resizing = useRef(false);
  const sideWRef = useRef(sideW);
  sideWRef.current = sideW;

  // Kéo giãn sidebar: nhấn vào thanh giữa rồi rê chuột
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!resizing.current) return;
      setSideW(Math.min(600, Math.max(200, e.clientX - 12)));
    };
    const up = () => {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.style.cursor = '';
      try {
        localStorage.setItem(LS_SIDE_W, String(sideWRef.current));
      } catch { /* ignore */ }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  if (onceId) return <OnceScreen id={onceId} />;
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 px-4 py-3 flex items-center gap-3">
        <nav className="flex gap-1 ml-2">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`text-sm rounded px-3 py-1.5 ${view === v.id ? 'bg-emerald-700 font-semibold' : 'bg-slate-800 hover:bg-slate-700'}`}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <CommandPalette />
      </header>
      <main className="flex flex-col md:flex-row items-stretch md:items-start px-2 pb-4 pt-3">
        {sideOpen ? (
          <aside
            style={{ width: sideW }}
            className="shrink-0 md:max-w-[60vw] bg-slate-900/50 border border-slate-800 rounded p-3 h-fit md:max-h-[calc(100vh-90px)] md:overflow-auto"
          >
            <Sidebar onCollapse={() => setSideOpen(false)} onGoFlow={() => setView('flow')} />
          </aside>
        ) : (
          <button
            onClick={() => setSideOpen(true)}
            title="Mở collections"
            className="shrink-0 self-start text-slate-400 hover:text-white bg-slate-900/50 border border-slate-800 hover:border-slate-600 rounded px-2 py-2 text-sm"
          >
            »
          </button>
        )}
        {sideOpen && (
          <div
            onMouseDown={() => {
              resizing.current = true;
              document.body.style.cursor = 'col-resize';
            }}
            title="Kéo để giãn/thu sidebar"
            className="hidden md:block w-2 shrink-0 cursor-col-resize hover:bg-emerald-700/60 rounded self-stretch my-1"
          />
        )}
        <section className={`flex-1 min-w-0 flex flex-col gap-4 bg-slate-900/50 border border-slate-800 rounded p-4 mt-2 md:mt-0 ${view === 'ai' ? 'md:h-[calc(100vh-90px)] md:overflow-hidden min-h-[70vh]' : ''}`}>
          {view === 'builder' && (
            <>
              <TabBar />
              <RequestBar />
              <RequestTabs />
              <hr className="border-slate-800" />
              <ResponseViewer />
            </>
          )}
          {view === 'runner' && <Runner />}
          {view === 'flow' && <Flow onGoBuilder={() => setView('builder')} />}
          {view === 'ws' && <WsTester />}
          {view === 'grpc' && <GrpcTester />}
          {view === 'ai' && <AiAssistant onGoBuilder={() => setView('builder')} />}
        </section>
      </main>
    </div>
  );
}

/** Màn hình headless: cron hệ thống mở URL này → chạy 1 lịch → tự đóng (nếu &close=1). */
function OnceScreen({ id }: { id: string }) {
  const schedules = useScheduleStore((s) => s.schedules);
  const [done, setDone] = useState(false);
  const sch = schedules.find((s) => s.id === id);
  const autoClose = new URLSearchParams(location.search).get('close') === '1';

  useEffect(() => {
    let alive = true;
    (async () => {
      await runScheduleNow(id);
      if (!alive) return;
      setDone(true);
      if (autoClose) setTimeout(() => window.close(), 3000);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const run = sch?.lastRun;
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="bg-slate-900 border border-slate-800 rounded p-6 max-w-lg w-full text-center">
        <h1 className="font-bold text-lg">⏰ Chạy lịch 1 lần</h1>
        {!sch ? (
          <p className="text-red-400 mt-3 font-mono text-sm">Không tìm thấy lịch id={id} (localStorage khác profile?).</p>
        ) : !done ? (
          <p className="text-amber-300 mt-3 animate-pulse">Đang chạy “{sch.name}”…</p>
        ) : (
          <div className="mt-3 text-sm">
            <p>
              “{sch.name}”: OK{' '}
              <b className={run && run.ok === run.total ? 'text-emerald-400' : 'text-red-400'}>
                {run?.ok}/{run?.total}
              </b>{' '}
              • tests {run?.passTests}/{run?.totalTests} • {run?.timeMs}ms
            </p>
            {run?.error && <p className="text-red-400 font-mono text-xs mt-1">{run.error}</p>}
            <p className="text-slate-500 text-xs mt-2">{autoClose ? 'Tự đóng sau 3s…' : 'Xong.'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
