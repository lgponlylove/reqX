import { useEffect } from 'react';
import { useRequestStore } from '../stores/request';
import { useAppStore } from '../stores/app';
import { useTranslation } from '../stores/language';
import type { HttpMethod } from '../types/api';

const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: 'text-emerald-400',
  POST: 'text-sky-400',
  PUT: 'text-amber-400',
  PATCH: 'text-purple-400',
  DELETE: 'text-red-400',
  HEAD: 'text-slate-400',
  OPTIONS: 'text-slate-400',
};

export default function TabBar() {
  const { t: i18n } = useTranslation();
  const { tabs, activeId, setActiveTab, closeTab, openTab } = useRequestStore();
  const reqId = useRequestStore((s) => s.current.id);

  // Đổi tab (hoặc tab nạp request khác) → hiện response/tests của đúng tab đó, chưa gửi thì trống
  useEffect(() => {
    const a = useAppStore.getState();
    const snap = a.respByTab[activeId];
    const r = snap && snap.reqId === reqId ? snap.res : null;
    // setResponse luôn xóa lỗi, nên khôi phục err SAU khi setResponse
    const e = snap && snap.reqId === reqId ? snap.err ?? null : null;
    if (a.response !== r) a.setResponse(r);
    if (a.sendError !== e) a.setSendError(e);
    const snapt = a.testsByTab[activeId];
    const t = snapt && snapt.reqId === reqId ? snapt.res : null;
    if (a.testRun !== t) a.setTestRun(t);
  }, [activeId, reqId]);

  const doClose = (id: string) => {
    closeTab(id);
    const s = useRequestStore.getState();
    useAppStore.getState().pruneTabs(s.tabs.map((t) => t.id));
  };

  return (
    <div className="flex items-center pb-0.5 border-b border-slate-800/80 shrink-0">
      <div className="flex items-center gap-1.5 overflow-x-auto min-w-0 flex-1 py-0.5">
        {tabs.map((t) => {
          const isActive = t.id === activeId;
          return (
            <div
              key={t.id}
              className={`group shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-t-lg text-[11px] whitespace-nowrap transition-all border ${
                isActive
                  ? 'bg-slate-900 dark:bg-[#111c26] border-emerald-500/50 border-b-slate-900 dark:border-b-[#111c26] text-slate-100 font-medium shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                  : 'bg-slate-950/60 dark:bg-[#0b131c]/60 border-slate-700/60 dark:border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 dark:hover:bg-[#0e1722]'
              }`}
            >
              <button onClick={() => setActiveTab(t.id)} className="flex items-center gap-1.5 min-w-0">
                <span className={`font-mono text-[10px] font-bold ${METHOD_COLOR[t.request.method]}`}>
                  {t.request.method}
                </span>
                <span className="max-w-44 truncate">{t.request.name}</span>
                {t.dirty && <span className="text-amber-400 font-bold" title={i18n.tabs.unsaved}>•</span>}
              </button>
              <button
                onClick={() => doClose(t.id)}
                title={i18n.tabs.closeTab}
                className="w-4 h-4 rounded-full flex items-center justify-center text-slate-500 hover:text-rose-400 transition-colors text-[10px]"
              >
                ✕
              </button>
            </div>
          );
        })}
        <button
          onClick={() => openTab()}
          title={i18n.tabs.newTab}
          className="w-5 h-5 shrink-0 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs transition-colors"
        >
          ＋
        </button>
      </div>
    </div>
  );
}
