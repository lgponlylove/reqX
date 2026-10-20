import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/app';
import { useScheduleStore } from '../stores/schedule';
import { useFlowStore } from '../stores/flow';
import { useTranslation, useLanguageStore } from '../stores/language';
import ScheduleBodyModal from './ScheduleBodyModal';
import { runScheduleNow, startEngine, engineRunning } from '../lib/scheduleEngine';

/** Chạy runner theo lịch (trong lúc tab mở): mỗi N phút chạy 1 collection. */
export default function Scheduler() {
  const { collections, dirs } = useAppStore();
  const { schedules, addSchedule, updateSchedule, removeSchedule } = useScheduleStore();
  const { flows } = useFlowStore();
  const { t } = useTranslation();
  const { language } = useLanguageStore();
  const [kind, setKind] = useState<'collection' | 'flow'>('collection');
  const [colId, setColId] = useState(collections[0]?.id ?? '');
  const [flowId, setFlowId] = useState('');
  const [folderId, setFolderId] = useState('all');
  const [intervalMin, setIntervalMin] = useState(30);
  const [notify, setNotify] = useState(false);
  const [base, setBase] = useState('http://localhost:1420');
  const [copied, setCopied] = useState('');
  const [viewing, setViewing] = useState<{ key: string; name: string; status?: number; ct?: string } | null>(null);
  const [, force] = useState(0);

  const fmtTime = (tm: number) => new Date(tm).toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US');

  useEffect(() => {
    startEngine();
    const timer = setInterval(() => force((n) => n + 1), 15000);
    return () => clearInterval(timer);
  }, []);

  const col = collections.find((c) => c.id === colId);
  const scopeLabel = (collectionId: string, fId: string) => {
    const c = collections.find((x) => x.id === collectionId);
    if (!c) return '—';
    if (fId === 'all') return t.runner.scopeAll;
    if (fId === 'root') return t.runner.scopeRoot;
    return `📁 ${c.folders.find((f) => f.id === fId)?.name ?? '?'}`;
  };

  const add = () => {
    if (intervalMin < 1) return;
    if (kind === 'flow') {
      const f = flows.find((x) => x.id === flowId);
      if (!f) return;
      addSchedule({
        name: `🔗 ${f.name}`,
        kind: 'flow',
        collectionId: '',
        folderId: 'all',
        flowId: f.id,
        intervalMin: Math.floor(intervalMin),
        enabled: true,
        notify,
      });
      return;
    }
    if (!col || intervalMin < 1) return;
    addSchedule({
      name: `${col.name} • ${scopeLabel(col.id, folderId)}`,
      kind: 'collection',
      collectionId: col.id,
      folderId,
      intervalMin: Math.floor(intervalMin),
      enabled: true,
      notify,
    });
  };

  const toggleNotify = async (on: boolean) => {
    if (on && 'Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    setNotify(on && ('Notification' in window ? Notification.permission === 'granted' : false));
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-500">
        {t.scheduler.desc}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t.scheduler.type}
          <select value={kind} onChange={(e) => setKind(e.target.value as 'collection' | 'flow')} className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5">
            <option value="collection">{t.scheduler.typeCollection}</option>
            <option value="flow">{t.scheduler.typeFlow}</option>
          </select>
        </label>
        {kind === 'collection' ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              {t.runner.collection}
              <select
                value={colId}
                onChange={(e) => { setColId(e.target.value); setFolderId('all'); }}
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5"
              >
                {collections.map((c) => {
                  const d = dirs.find((x) => x.collectionIds.includes(c.id));
                  return <option key={c.id} value={c.id}>{d ? `${d.name} / ${c.name}` : c.name}</option>;
                })}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t.runner.scope}
              <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5">
                <option value="all">{t.runner.scopeAll}</option>
                <option value="root">{t.runner.scopeRoot}</option>
                {col?.folders.map((f) => (
                  <option key={f.id} value={f.id}>📁 {f.name}</option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <label className="flex flex-col gap-1 text-sm">
            Flow
            <select value={flowId} onChange={(e) => setFlowId(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 min-w-48">
              <option value="">{t.scheduler.selectFlow}</option>
              {flows.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.steps.filter((s) => !s.disabled).length} {t.scheduler.steps})</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          {t.scheduler.interval}
          <input
            type="number" min={1} max={10080} value={intervalMin}
            onChange={(e) => setIntervalMin(Math.max(1, Number(e.target.value) || 1))}
            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 w-28"
          />
        </label>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={notify} onChange={(e) => toggleNotify(e.target.checked)} />
          {t.scheduler.notify}
        </label>
        <button
          onClick={add}
          disabled={kind === 'flow' ? !flowId : !col}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded px-4 py-1.5 font-semibold text-sm"
        >
          {t.scheduler.addSchedule}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {schedules.length === 0 && <p className="text-sm text-slate-500">{t.scheduler.emptySchedules}</p>}
        {schedules.map((s) => {
          const busy = engineRunning(s.id);
          return (
            <div key={s.id} className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => updateSchedule(s.id, { enabled: !s.enabled })}
                  title={s.enabled ? t.scheduler.toggleOff : t.scheduler.toggleOn}
                  className={`w-9 h-5 rounded-full relative transition-colors ${s.enabled ? 'bg-emerald-600' : 'bg-slate-700'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${s.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
                <b>{s.name}</b>
                <span className="text-slate-500">{t.scheduler.everyNMin.replace('{n}', String(s.intervalMin))}</span>
                {busy && <span className="text-amber-300 animate-pulse">{t.scheduler.running}</span>}
                <span className="ml-auto flex gap-2">
                  <button
                    onClick={() => { void runScheduleNow(s.id); force((n) => n + 1); }}
                    className="text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-1"
                  >
                    {t.scheduler.runNow}
                  </button>
                  <button
                    onClick={() => removeSchedule(s.id)}
                    className="text-xs bg-slate-800 hover:bg-red-700 rounded px-2 py-1"
                  >
                    {t.scheduler.delete}
                  </button>
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {t.scheduler.nextRun} {s.enabled ? fmtTime(s.nextRunAt) : t.scheduler.disabledState}
                {s.lastRun && (
                  <> • {t.scheduler.lastRun} {fmtTime(s.lastRun.at)}: OK <b className="text-emerald-400">{s.lastRun.ok}/{s.lastRun.total}</b>, tests {s.lastRun.passTests}/{s.lastRun.totalTests}, {s.lastRun.timeMs}ms{s.lastRun.stopped ? t.runner.stoppedMidway : ''}{s.lastRun.error ? ` — ${s.lastRun.error}` : ''}</>
                )}
              </p>
              {s.runs.length > 1 && (
                <details className="text-xs text-slate-400 mt-1">
                  <summary className="cursor-pointer hover:text-slate-200">{t.scheduler.historyCount.replace('{count}', String(s.runs.length))}</summary>
                  <ul className="mt-1 flex flex-col gap-1">
                    {s.runs.map((r) => (
                      <li key={r.at}>
                        {r.steps && r.steps.length > 0 ? (
                          <details>
                            <summary className="cursor-pointer hover:text-slate-200 font-mono">
                              {fmtTime(r.at)} — OK {r.ok}/{r.total} • tests {r.passTests}/{r.totalTests} • {r.timeMs}ms{r.stopped ? t.runner.stoppedMidway : ''}{r.error ? ` • ${r.error}` : ''} ▸
                            </summary>
                            <ul className="mt-1 ml-3 flex flex-col gap-0.5 border-l border-slate-800 pl-2">
                              {r.steps.map((st, i) => (
                                <li key={i}>
                                  <span className="mr-1">{st.ok ? '✅' : '❌'}</span>
                                  #{i + 1} {st.name}
                                  {st.status !== undefined && <span className="text-slate-500"> {st.status}</span>}
                                  {st.timeMs !== undefined && <span className="text-slate-600"> {st.timeMs}ms</span>}
                                  {st.error && <span className="text-red-400"> — {st.error}</span>}
                                  {st.extracted?.map((e) => (
                                    <span key={e.name} className="block text-emerald-500/90">
                                      {`{{${e.name}}}`} = {e.value}
                                    </span>
                                  ))}
                                  {st.bodyKey ? (
                                    <button
                                      onClick={() => setViewing({ key: st.bodyKey!, name: st.name, status: st.status, ct: st.contentType })}
                                      className="block mt-0.5 text-sky-400 hover:text-sky-300"
                                    >
                                      {t.runner.viewBody}
                                    </button>
                                  ) : st.bodyOmitted ? (
                                    <span className="block text-slate-600">{t.runner.bodyTooLarge}</span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : (
                          <span className="font-mono">
                            {fmtTime(r.at)} — OK {r.ok}/{r.total} • tests {r.passTests}/{r.totalTests} • {r.timeMs}ms{r.stopped ? t.runner.stoppedMidway : ''}{r.error ? ` • ${r.error}` : ''}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <details className="text-xs text-slate-400 mt-1">
                <summary className="cursor-pointer hover:text-slate-200">{t.scheduler.cronSystem}</summary>
                <CronExport scheduleId={s.id} intervalMin={s.intervalMin} base={base} copied={copied} setCopied={setCopied} />
              </details>
            </div>
          );
        })}
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-500">
        {t.scheduler.cronAppBase}
        <input
          value={base}
          onChange={(e) => setBase(e.target.value.replace(/\/+$/, ''))}
          spellCheck={false}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono flex-1"
        />
      </label>
      <p className="text-xs text-slate-500">
        {t.scheduler.cronHelp}
      </p>
      {viewing && (
        <ScheduleBodyModal
          bodyKey={viewing.key}
          stepName={viewing.name}
          status={viewing.status}
          contentType={viewing.ct}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

/** Sinh lệnh schtasks (Windows) / crontab (Linux) mở Chrome headless chạy once-mode. */
function CronExport({ scheduleId, intervalMin, base, copied, setCopied }: {
  scheduleId: string; intervalMin: number; base: string; copied: string; setCopied: (v: string) => void;
}) {
  const { t } = useTranslation();
  const url = `${base}/?once=${scheduleId}&close=1`;
  const win = `schtasks /create /tn "ReqX-${scheduleId}" /tr "\\"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\\" --headless=new --user-data-dir=\\"%LOCALAPPDATA%\\postman-clone-cron\\" --virtual-time-budget=180000 \\"${url}\\"" /sc minute /mo ${intervalMin} /f`;
  const nix = `*/${intervalMin} * * * * google-chrome --headless=new --user-data-dir="$HOME/.postman-clone-cron" --virtual-time-budget=180000 "${url}"`;
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    } catch { /* clipboard cần HTTPS/localhost */ }
  };
  const row = 'flex gap-1.5 items-start mt-1.5';
  const pre = 'flex-1 bg-slate-900 border border-slate-800 rounded p-1.5 font-mono text-[11px] whitespace-pre-wrap break-all';
  return (
    <div className="mt-1">
      <p className="text-slate-500">{t.scheduler.cronProfileDesc}</p>
      <div className={row}>
        <code className={pre}>{url}</code>
        <a href={url} target="_blank" rel="noreferrer" className="bg-slate-800 hover:bg-slate-700 rounded px-2 py-1 shrink-0">{t.scheduler.openTest}</a>
      </div>
      <div className={row}>
        <code className={pre}>Windows (cmd admin): {win}</code>
        <button onClick={() => copy(`w${scheduleId}`, win)} className="bg-slate-800 hover:bg-slate-700 rounded px-2 py-1 shrink-0">
          {copied === `w${scheduleId}` ? t.scheduler.copied : t.scheduler.copy}
        </button>
      </div>
      <div className={row}>
        <code className={pre}>Linux (crontab -e): {nix}</code>
        <button onClick={() => copy(`n${scheduleId}`, nix)} className="bg-slate-800 hover:bg-slate-700 rounded px-2 py-1 shrink-0">
          {copied === `n${scheduleId}` ? t.scheduler.copied : t.scheduler.copy}
        </button>
      </div>
    </div>
  );
}
