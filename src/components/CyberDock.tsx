import { useState, type ReactNode } from 'react';
import { useMockStore } from '../stores/mock';
import { useTranslation } from '../stores/language';

export type ToolView = 'ws' | 'grpc' | 'mock' | 'env' | 'ai' | 'cookies' | 'coverage';

export interface ToolItem {
  id: ToolView;
  label: string;
  desc: string;
  renderIcon: (active: boolean) => ReactNode;
}

export const TOOLS: ToolItem[] = [
  {
    id: 'mock',
    label: 'Mock Server',
    desc: 'Giả lập API Server local',
    renderIcon: () => (
      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="7" rx="2" />
        <rect x="2" y="14" width="20" height="7" rx="2" />
        <line x1="6" y1="6.5" x2="6.01" y2="6.5" strokeWidth="3" />
        <line x1="6" y1="17.5" x2="6.01" y2="17.5" strokeWidth="3" />
        <path d="M14 6.5h4M14 17.5h4" />
      </svg>
    ),
  },
  {
    id: 'ws',
    label: 'WebSocket',
    desc: 'Test kết nối Socket thời gian thực',
    renderIcon: () => (
      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v6m-4-6v6" />
        <path d="M18 10H6a2 2 0 0 0-2 2v2a8 8 0 0 0 16 0v-2a2 2 0 0 0-2-2z" />
        <line x1="12" y1="18" x2="12" y2="22" />
      </svg>
    ),
  },
  {
    id: 'grpc',
    label: 'gRPC',
    desc: 'Gọi RPC Protobuf/Web trực tiếp',
    renderIcon: () => (
      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      </svg>
    ),
  },
  {
    id: 'ai',
    label: 'AI assistance',
    desc: 'Trợ lý AI & sinh test script thông minh',
    renderIcon: () => (
      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" />
        <path d="M19 3v4m2-2h-4" />
      </svg>
    ),
  },
  {
    id: 'env',
    label: 'Environment',
    desc: 'Quản lý biến môi trường & biến toàn cục',
    renderIcon: () => (
      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  {
    id: 'coverage',
    label: 'Độ phủ kiểm thử',
    desc: 'Collection nào còn request chưa được kiểm thử',
    renderIcon: () => (
      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 3v4.5M21 12h-4.5" />
      </svg>
    ),
  },
  {
    id: 'cookies',
    label: 'Cookies',
    desc: 'Xem và xoá cookie đang giữ trong phiên',
    renderIcon: () => (
      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-4-4 4 4 0 0 1-4-4 2 2 0 0 0-2-2z" />
        <circle cx="9" cy="10" r="1" fill="currentColor" />
        <circle cx="13" cy="15" r="1" fill="currentColor" />
        <circle cx="8.5" cy="15.5" r="1" fill="currentColor" />
      </svg>
    ),
  },
];

export default function CyberDock({
  activeView,
  aiOpen = false,
  envActive = false,
  onSelectView,
}: {
  activeView: string;
  aiOpen?: boolean;
  envActive?: boolean;
  onSelectView: (v: ToolView) => void;
}) {
  const isMockRunning = useMockStore((s) => s.isRunning);
  const { t: i18n } = useTranslation();

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('reqx_cyberdock_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('reqx_cyberdock_collapsed', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  if (collapsed) {
    return (
      <div className="mt-2 shrink-0">
        <div className="bg-slate-900/95 dark:bg-[#0b141e]/95 border border-teal-500/40 rounded-xl p-1.5 shadow-[0_0_20px_rgba(20,184,166,0.18)] backdrop-blur-xl flex items-center justify-between gap-1 transition-all">
          {/* Horizontal Icon Row */}
          <div className="flex-1 flex items-center justify-between gap-1 min-w-0 px-0.5">
            {TOOLS.map((t) => {
              const isActive = t.id === 'ai' ? aiOpen : t.id === 'env' ? envActive : activeView === t.id;
              const isMockActive = t.id === 'mock' && isMockRunning;
              const label = i18n.dock[t.id];
              const desc = i18n.dock[`${t.id}Desc` as keyof typeof i18n.dock] || t.desc;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectView(t.id)}
                  title={`${label} — ${desc}`}
                  className={`relative w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                    isActive
                      ? 'bg-teal-500/20 text-cyan-300 border border-teal-500/50 shadow-[0_0_10px_rgba(6,182,212,0.6)] scale-105'
                      : 'text-slate-400 hover:text-cyan-300 hover:bg-slate-800/60'
                  }`}
                >
                  {t.renderIcon(isActive)}
                  {isMockActive && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,1)] animate-pulse" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Expand Button */}
          <button
            type="button"
            onClick={toggleCollapse}
            title={i18n.dock.expand || 'Mở rộng thanh công cụ'}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-cyan-300 hover:bg-slate-800/60 border-l border-slate-800/80 pl-1 transition-all shrink-0"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 shrink-0">
      {/* Outer Floating Glassmorphism Container with Cyan Glowing Border */}
      <div className="bg-slate-900/95 dark:bg-[#0b141e]/95 border border-teal-500/40 rounded-2xl p-2.5 shadow-[0_0_25px_rgba(20,184,166,0.22)] backdrop-blur-xl flex flex-col gap-2 transition-all">
        {/* Header with Title and Collapse Button */}
        <div className="flex items-center justify-between px-1 pb-1 border-b border-slate-800/80 text-[11px] font-semibold text-slate-400">
          <span className="flex items-center gap-1.5 text-cyan-400">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <span>{i18n.dock.title || 'Công cụ'}</span>
          </span>
          <button
            type="button"
            onClick={toggleCollapse}
            title={i18n.dock.collapse || 'Thu gọn để mở rộng collections'}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 px-2 py-0.5 rounded transition-all cursor-pointer"
          >
            <span>{i18n.dock.collapse || 'Thu gọn'}</span>
            <svg viewBox="0 0 24 24" className="w-3 h-3 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>

        {/* Content (Pill + List) */}
        <div className="flex items-center gap-2.5">
          {/* Left Vertical Icon Pill Bar */}
          <div className="rounded-full border border-teal-500/50 bg-slate-950/90 dark:bg-[#08121a]/90 py-2 px-1 flex flex-col items-center gap-2.5 shadow-inner">
            {TOOLS.map((t) => {
              const isActive = t.id === 'ai' ? aiOpen : t.id === 'env' ? envActive : activeView === t.id;
              const label = i18n.dock[t.id];
              const desc = i18n.dock[`${t.id}Desc` as keyof typeof i18n.dock] || t.desc;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectView(t.id)}
                  title={`${label} — ${desc}`}
                  className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                    isActive
                      ? 'text-teal-600 dark:text-cyan-300 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)] scale-110'
                      : 'text-slate-400 hover:text-cyan-300'
                  }`}
                >
                  {t.renderIcon(isActive)}
                </button>
              );
            })}
          </div>

          {/* Right Label Rows */}
          <div className="flex-1 flex flex-col gap-1 pr-1">
            {TOOLS.map((t) => {
              const isActive = t.id === 'ai' ? aiOpen : t.id === 'env' ? envActive : activeView === t.id;
              const isMockActive = t.id === 'mock' && isMockRunning;
              const label = i18n.dock[t.id];

              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectView(t.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all text-left group ${
                    isActive
                      ? 'bg-teal-500/15 dark:bg-teal-950/70 border border-teal-500/40 text-teal-700 dark:text-cyan-300 shadow-[0_0_12px_rgba(20,184,166,0.25)]'
                      : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800/60'
                  }`}
                >
                  <span
                    className={`transition-colors ${
                      isActive ? 'text-cyan-300' : 'text-slate-400 group-hover:text-cyan-300'
                    }`}
                  >
                    {t.renderIcon(isActive)}
                  </span>
                  <span className="flex-1 truncate tracking-wide">{label}</span>
                  {isMockActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,1)] animate-pulse" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
