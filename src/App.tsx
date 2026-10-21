import { useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import CommandPalette from './components/CommandPalette';
import RequestBar from './components/RequestBar';
import RequestTabs from './components/RequestTabs';
import ResponseViewer, { formatSize } from './components/ResponseViewer';
import Runner from './components/Runner';
import WsTester from './components/WsTester';
import GrpcTester from './components/GrpcTester';
import Flow from './components/Flow';
import AiAssistant from './components/AiAssistant';
import EnvironmentManager from './components/EnvironmentManager';
import TestCaseDialog from './components/TestCaseDialog';
import { useAppStore } from './stores/app';
import { useScheduleStore } from './stores/schedule';
import { runScheduleNow } from './lib/scheduleEngine';

import MockServer from './components/MockServer';
import CyberDock, { TOOLS, type ToolView } from './components/CyberDock';
import CookieManager from './components/CookieManager';
import CoverageView from './components/CoverageView';
import { useMockStore } from './stores/mock';
import { useRequestStore } from './stores/request';
import LanguageSwitcher from './components/LanguageSwitcher';
import ThemeToggle from './components/ThemeToggle';
import LicenseModal from './components/LicenseModal';
import StatusBanners from './components/StatusBanners';
import DiagnosticsModal from './components/DiagnosticsModal';
import { useTranslation } from './stores/language';

function EnvSelector({ onOpenEnv }: { onOpenEnv?: () => void }) {
  const { environments, activeEnvId, setActiveEnv } = useAppStore();
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5 border-r border-slate-700/80 pr-2.5 shrink-0">
      <span className="hidden lg:inline text-xs text-slate-400">{t.header.environment}</span>
      <select
        className="bg-slate-900/90 border border-slate-700/80 rounded-xl px-2 py-1 text-xs text-slate-300 w-28 sm:w-32 outline-none focus:border-teal-500 shadow-sm"
        value={activeEnvId ?? ''}
        onChange={(e) => setActiveEnv(e.target.value || null)}
      >
        <option value="">{t.header.none}</option>
        {environments.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={onOpenEnv}
        title="Mở tab khai báo biến môi trường (Environment)"
        className="p-1 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors"
      >
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      </button>
    </div>
  );
}

type View = 'builder' | 'runner' | 'flow' | 'ws' | 'grpc' | 'mock' | 'env' | 'ai' | 'cookies' | 'coverage';

const MAIN_VIEWS: { id: View; key: 'builder' | 'runner' | 'flow' }[] = [
  { id: 'builder', key: 'builder' },
  { id: 'runner', key: 'runner' },
  { id: 'flow', key: 'flow' },
];

const LS_SIDE_W = 'postman-clone-sidebar-w';
const LS_RESP_H = 'postman-clone-resp-h';
const LS_AI_DRAWER_W = 'postman-clone-ai-drawer-w';
const RESP_MIN = 120;   // response không nhỏ hơn thế này khi kéo lên
const REQ_MIN = 160;    // request không bị chèn chết khi kéo xuống

export default function App() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('builder');
  // Headless once-mode cho cron hệ thống: ?once=<scheduleId>&close=1
  const [onceId] = useState(() => new URLSearchParams(location.search).get('once'));
  const [sideW, setSideW] = useState(() => {
    const v = Number(localStorage.getItem(LS_SIDE_W));
    return v >= 200 && v <= 600 ? v : 300;
  });
  const [sideOpen, setSideOpen] = useState(true);
  // Bảng response thu được để request (Headers, Pre-request) có đủ chiều cao
  const [respOpen, setRespOpen] = useState(true);
  // null = chia đôi auto (flex-1); số = cao đúng bấy nhiêu px, nhớ lại sau khi reload
  const [respH, setRespH] = useState<number | null>(() => {
    const v = Number(localStorage.getItem(LS_RESP_H));
    return v >= RESP_MIN ? v : null;
  });
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [aiDrawerW, setAiDrawerW] = useState(() => {
    const v = Number(localStorage.getItem(LS_AI_DRAWER_W));
    return v >= 320 && v <= 800 ? v : 420;
  });
  const aiDrawerWRef = useRef(aiDrawerW);
  aiDrawerWRef.current = aiDrawerW;
  const aiResizing = useRef(false);

  const activeTab = useRequestStore((s) => s.tabs.find((t) => t.id === s.activeId));
  const isEnvTab = activeTab?.kind === 'env';

  const handleSelectTool = (v: ToolView) => {
    if (v === 'ai') {
      setAiDrawerOpen((prev) => !prev);
    } else if (v === 'env') {
      useRequestStore.getState().openEnvTab();
      setView('builder');
    } else {
      setView(v as View);
    }
  };

  const splitRef = useRef<HTMLDivElement>(null);
  const respPaneRef = useRef<HTMLDivElement>(null);
  const vResize = useRef<{ y: number; h: number } | null>(null);
  const [vResizeActive, setVResizeActive] = useState(false);
  const response = useAppStore((s) => s.response);
  const sending = useAppStore((s) => s.sending);
  const lastResponse = useRef(response);
  const isMockRunning = useMockStore((s) => s.isRunning);
  const resizing = useRef(false);
  const sideWRef = useRef(sideW);
  sideWRef.current = sideW;
  const respHRef = useRef(respH);
  respHRef.current = respH;

  const aiSeedPrompt = useAppStore((s) => s.aiSeedPrompt);
  useEffect(() => {
    if (aiSeedPrompt) setAiDrawerOpen(true);
  }, [aiSeedPrompt]);

  const targetEnvVar = useAppStore((s) => s.targetEnvVar);
  useEffect(() => {
    if (targetEnvVar) {
      useRequestStore.getState().openEnvTab(targetEnvVar.envId);
      setView('builder');
    }
  }, [targetEnvVar]);

  // Có kết quả mới thì tự mở lại — thu gọn là để soạn request, không phải để bỏ xem response
  useEffect(() => {
    if (response && response !== lastResponse.current) {
      lastResponse.current = response;
      setRespOpen(true);
    }
  }, [response]);

  // Lỗi gửi request cũng hiện trong bảng response → gửi xong mà có lỗi thì tự mở bảng
  const sendError = useAppStore((s) => s.sendError);
  const wasSending = useRef(false);
  useEffect(() => {
    if (wasSending.current && !sending && useAppStore.getState().sendError) setRespOpen(true);
    wasSending.current = sending;
  }, [sending]);

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

  // Kéo phân chia request/response theo chiều dọc (như Postman): rê thanh giữa 2 bảng.
  // Response nằm dưới nên kéo LÊN (clientY giảm) làm bảng response DÀI ra.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const start = vResize.current;
      if (!start) return;
      const avail = splitRef.current?.getBoundingClientRect().height ?? 0;
      const max = Math.max(RESP_MIN, avail - REQ_MIN - 24);
      setRespH(Math.min(max, Math.max(RESP_MIN, start.h + (start.y - e.clientY))));
    };
    const up = () => {
      if (!vResize.current) return;
      vResize.current = null;
      setVResizeActive(false);
      document.body.style.cursor = '';
      const h = respHRef.current;
      try {
        if (h === null) localStorage.removeItem(LS_RESP_H);
        else localStorage.setItem(LS_RESP_H, String(h));
      } catch { /* ignore */ }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  // Kéo chỉnh độ rộng drawer Trợ lý AI (bên phải): kéo SANG TRÁI (clientX giảm) làm drawer RỘNG ra
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!aiResizing.current) return;
      const newW = window.innerWidth - e.clientX - 16;
      setAiDrawerW(Math.min(800, Math.max(300, newW)));
    };
    const up = () => {
      if (!aiResizing.current) return;
      aiResizing.current = false;
      document.body.style.cursor = '';
      try {
        localStorage.setItem(LS_AI_DRAWER_W, String(aiDrawerWRef.current));
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
    <div className="h-screen flex flex-col md:flex-row bg-slate-950 dark:bg-[#070c14] text-slate-100 selection:bg-cyan-500/30 selection:text-cyan-200 overflow-hidden p-2 gap-2">
      {/* Left Column: Sidebar (Open or Collapsed Rail) starting right from the top */}
      {sideOpen ? (
        <aside
          style={{ width: sideW }}
          className="shrink-0 md:max-w-[60vw] flex flex-col h-full gap-2.5 overflow-hidden"
        >
          <div className="flex-1 min-h-0 flex flex-col">
            <Sidebar onCollapse={() => setSideOpen(false)} onGoFlow={() => setView('flow')} />
          </div>
          <CyberDock
            activeView={view}
            aiOpen={aiDrawerOpen}
            envActive={view === 'builder' && isEnvTab}
            onSelectView={handleSelectTool}
          />
        </aside>
      ) : (
        <aside className="shrink-0 w-14 bg-slate-900/95 dark:bg-[#0b141e]/95 border border-teal-500/40 rounded-2xl p-2 flex flex-col items-center gap-2.5 shadow-[0_0_25px_rgba(20,184,166,0.22)] backdrop-blur-xl h-full">
          {/* N-9: một nút mở rộng duy nhất (trước đây có 2 nút cùng làm một việc) */}
          <button
            onClick={() => setSideOpen(true)}
            title={t.header.expandSidebar}
            aria-label={t.header.expandSidebar}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-cyan-400 hover:text-cyan-200 hover:bg-teal-950/60 border border-teal-500/30 transition-all shadow-sm"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </button>

          <div className="w-6 h-[1px] bg-teal-500/30 my-0.5" />

          {/* Vertical tool rail icons */}
          <div className="flex flex-col items-center gap-2">
            {TOOLS.map((t) => {
              const isActive = t.id === 'ai' ? aiDrawerOpen : t.id === 'env' ? (view === 'builder' && isEnvTab) : view === t.id;
              const isMockActive = t.id === 'mock' && isMockRunning;
              return (
                <button
                  key={t.id}
                  onClick={() => handleSelectTool(t.id)}
                  title={`${t.label} — ${t.desc}`}
                  className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                    isActive
                      ? 'bg-teal-950/80 border border-teal-500/60 text-cyan-300 shadow-[0_0_12px_rgba(20,184,166,0.35)] scale-105'
                      : 'text-slate-400 hover:text-cyan-300 hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  {t.renderIcon(isActive)}
                  {isMockActive && (
                    <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,1)] animate-pulse" />
                  )}
                </button>
              );
            })}
          </div>
        </aside>
      )}

      {/* Resize Bar */}
      {sideOpen && (
        <div
          onMouseDown={() => {
            resizing.current = true;
            document.body.style.cursor = 'col-resize';
          }}
          title="Kéo để giãn/thu sidebar"
          className="hidden md:block w-1.5 shrink-0 cursor-col-resize hover:bg-emerald-500/40 rounded-full self-stretch transition-colors"
        />
      )}

      {/* Center Column: Top Controls Header + Workspace View */}
      <div className="flex-1 min-w-0 flex flex-col h-full gap-2 overflow-hidden">
        {/* Top Header: Capsule Switcher (Builder | Runner | Flow) + Env + Language + ThemeToggle + Palette */}
        <header className="border border-slate-700/80 dark:border-slate-800/90 px-3.5 py-1.5 flex items-center justify-between gap-3 bg-slate-900/90 dark:bg-[#08101a]/90 backdrop-blur-md rounded-2xl shadow-lg shrink-0">
          {/* Capsule Switcher (Builder | Runner | Flow) */}
          <div className="bg-slate-950/80 dark:bg-[#09131d]/90 border border-teal-500/30 p-0.5 rounded-full flex items-center shadow-[0_0_15px_rgba(20,184,166,0.15)] shrink-0">
            {MAIN_VIEWS.map((v) => {
              const isActive = view === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => setView(v.id)}
                  className={`relative px-4 sm:px-5 py-1 rounded-full text-xs font-semibold transition-all duration-150 ${
                    isActive
                      ? 'bg-emerald-500/20 dark:bg-[#122e30] border border-emerald-500/60 text-emerald-600 dark:text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.35)]'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>{t.nav[v.key]}</span>
                </button>
              );
            })}
          </div>

          {/* Right: Environment Selector, AI Assistant, Pro/License, Language Switcher, Theme Toggle, Diagnostics & Command Palette */}
          <div className="flex items-center gap-2 shrink-0">
            <EnvSelector onOpenEnv={() => handleSelectTool('env')} />
            <button
              type="button"
              onClick={() => setAiDrawerOpen((v) => !v)}
              title={`${t.dock.ai} — ${t.dock.aiDesc}`}
              aria-label={t.dock.ai}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1 transition-all border shrink-0 ${
                aiDrawerOpen
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.35)]'
                  : 'bg-slate-900/80 hover:bg-slate-800 border-slate-700/80 hover:border-cyan-500/50 text-slate-300 hover:text-cyan-200'
              }`}
            >
              <span className="leading-none text-cyan-400">✨</span>
              <span>AI</span>
            </button>
            <LicenseModal />
            <LanguageSwitcher />
            <ThemeToggle />
            <DiagnosticsModal />
            <CommandPalette onOpenView={(v) => handleSelectTool(v as ToolView)} />
          </div>
        </header>

        {/* Banner trial / bản mới (mỏng, dưới header) */}
        <StatusBanners />

        {/* Main Workspace + AI Assistant Row (level with Request) */}
        <div className="flex-1 min-h-0 flex flex-row gap-2 overflow-hidden">
          <section className="flex-1 min-w-0 flex flex-col bg-slate-900/50 backdrop-blur-md border border-slate-800/80 rounded-2xl p-4 shadow-2xl shadow-black/40 overflow-hidden">
            <div ref={splitRef} className={`${vResizeActive ? 'select-none' : ''} ${view === 'builder' ? 'flex flex-col gap-1.5 flex-1 min-h-0 overflow-hidden' : 'hidden'}`}>
              <TabBar />
              {isEnvTab ? (
                <div className="flex-1 min-h-0 overflow-y-auto mt-1">
                  <EnvironmentManager />
                </div>
              ) : (
                <>
                  {/* Pane request: tự cuộn, không ép TabBar/Response biến mất khi body dài */}
                  <div className="flex flex-col gap-3 flex-1 min-h-[140px] overflow-y-auto pr-0.5">
                    <RequestBar />
                    <RequestTabs />
                  </div>
                  {/* Pane response — thu gọn thành 1 thanh để request chiếm hết chiều cao */}
                  {respOpen ? (
                    <>
                      {/* Thanh chia kéo được (giống Postman): nhấn đúp = trả về chia đôi auto */}
                      <div
                        role="separator"
                        aria-orientation="horizontal"
                        title={t.response.dragHint}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          const pane = respPaneRef.current;
                          vResize.current = { y: e.clientY, h: pane ? pane.getBoundingClientRect().height : 0 };
                          setVResizeActive(true);
                          document.body.style.cursor = 'row-resize';
                        }}
                        onDoubleClick={() => setRespH(null)}
                        className="group shrink-0 h-2 -my-0.5 flex items-center justify-center cursor-row-resize touch-none"
                      >
                        <div
                          className={`h-[3px] rounded-full transition-all ${
                            respH === null ? 'w-10' : 'w-16'
                          } ${vResizeActive ? 'bg-emerald-400' : 'bg-slate-700 group-hover:bg-emerald-500/70'}`}
                        />
                      </div>
                      <div
                        ref={respPaneRef}
                        style={respH === null ? undefined : { height: respH }}
                        className={`${respH === null ? 'flex-1' : 'shrink-0'} min-h-0 overflow-y-auto pr-0.5`}
                      >
                        <ResponseViewer onCollapse={() => setRespOpen(false)} />
                      </div>
                    </>
                  ) : (
                    <button
                      onClick={() => setRespOpen(true)}
                      title={t.response.expandPanel}
                      className="shrink-0 flex items-center gap-2 px-2 py-1.5 rounded border border-slate-800/80 hover:bg-slate-800/40 text-xs text-left"
                    >
                      <span className="text-slate-400">▸</span>
                      <span className="font-bold text-white shrink-0">{t.response.responseTitle}</span>
                      {sending ? (
                        <span className="text-slate-400 animate-pulse truncate">{t.response.sendingState}</span>
                      ) : sendError ? (
                        <span className="text-rose-400 truncate">⚠ {sendError}</span>
                      ) : response ? (
                        <span className="font-mono text-emerald-400 truncate">
                          {response.status} {response.statusText}
                          <span className="text-slate-500"> · </span>
                          {response.timeMs} ms
                          <span className="text-slate-500"> · </span>
                          {formatSize(response.sizeBytes)}
                        </span>
                      ) : (
                        <span className="text-slate-500">{t.response.noResponseShort}</span>
                      )}
                    </button>
                  )}
                </>
              )}
            </div>
            <div className={view === 'runner' ? 'flex-1 min-h-0 overflow-y-auto' : 'hidden'}>
              <Runner />
            </div>
            <div className={view === 'flow' ? 'flex-1 min-h-0 overflow-y-auto' : 'hidden'}>
              <Flow onGoBuilder={() => setView('builder')} />
            </div>
            <div className={view === 'ws' ? 'flex-1 min-h-0 overflow-y-auto' : 'hidden'}>
              <WsTester />
            </div>
            <div className={view === 'grpc' ? 'flex-1 min-h-0 overflow-y-auto' : 'hidden'}>
              <GrpcTester />
            </div>
            <div className={view === 'mock' ? 'flex flex-col flex-1 min-h-0 h-full' : 'hidden'}>
              <MockServer />
            </div>
            <div className={view === 'env' ? 'flex-1 min-h-0 overflow-y-auto' : 'hidden'}>
              <EnvironmentManager />
            </div>
            <div className={view === 'ai' ? 'flex flex-col flex-1 min-h-0 h-full' : 'hidden'}>
              <AiAssistant onGoBuilder={() => setView('builder')} />
            </div>
            <div className={view === 'cookies' ? 'flex-1 min-h-0 overflow-y-auto' : 'hidden'}>
              <CookieManager />
            </div>
            <div className={view === 'coverage' ? 'flex-1 min-h-0 overflow-y-auto' : 'hidden'}>
              <CoverageView />
            </div>
          </section>

          {/* Right Column: AI Assistant Drawer (Postbot-style, level with Request workspace) */}
          {aiDrawerOpen && (
            <>
              <div
                onMouseDown={() => {
                  aiResizing.current = true;
                  document.body.style.cursor = 'col-resize';
                }}
                title="Kéo để chỉnh độ rộng Trợ lý AI"
                className="hidden md:block w-1.5 shrink-0 cursor-col-resize hover:bg-cyan-500/40 rounded-full self-stretch transition-colors"
              />
              <aside
                style={{ width: aiDrawerW }}
                className="shrink-0 flex flex-col h-full bg-slate-900/95 dark:bg-[#08101a]/95 backdrop-blur-xl border border-slate-700/80 dark:border-cyan-500/30 rounded-2xl p-3 shadow-2xl shadow-cyan-950/20 overflow-hidden"
              >
                <AiAssistant
                  onClose={() => setAiDrawerOpen(false)}
                  onGoBuilder={() => setView('builder')}
                />
              </aside>
            </>
          )}
        </div>
      </div>

      {/* Bảng key test mở từ trợ lý AI (hoặc sinh lại tay trong bảng) */}
      <TestCaseDialog />
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
