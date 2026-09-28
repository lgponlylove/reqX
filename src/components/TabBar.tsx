import { useEffect } from 'react';
import { useRequestStore } from '../stores/request';
import { useAppStore } from '../stores/app';
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
  const { tabs, activeId, setActiveTab, closeTab, openTab } = useRequestStore();
  const reqId = useRequestStore((s) => s.current.id);

  // Đổi tab (hoặc tab nạp request khác) → hiện response/tests của đúng tab đó, chưa gửi thì trống
  useEffect(() => {
    const a = useAppStore.getState();
    const snap = a.respByTab[activeId];
    const r = snap && snap.reqId === reqId ? snap.res : null;
    if (a.response !== r) a.setResponse(r);
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
    <div className="flex items-center gap-1 overflow-x-auto">
      <div className="flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-t text-xs whitespace-nowrap border-b-2 ${
              t.id === activeId
                ? 'bg-slate-800 border-emerald-500 font-semibold'
                : 'bg-slate-900/60 border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <button onClick={() => setActiveTab(t.id)} className="flex items-center gap-1.5 min-w-0">
              <span className={`font-mono font-bold ${METHOD_COLOR[t.request.method]}`}>
                {t.request.method}
              </span>
              <span className="max-w-32 truncate">{t.request.name}</span>
              {t.dirty && <span className="text-amber-400" title="Chưa lưu">•</span>}
            </button>
            <button
              onClick={() => doClose(t.id)}
              title="Đóng tab"
              className="px-1 rounded text-slate-500 hover:text-red-300 hover:bg-slate-700"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => openTab()}
        title="Mở tab mới"
        className="shrink-0 px-2 py-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded"
      >
        +
      </button>
    </div>
  );
}
