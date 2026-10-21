import { useMemo, useState } from 'react';
import { cookieJar, type CookieRecord } from '../lib/cookie-jar';
import { useTranslation } from '../stores/language';

const rowId = (c: CookieRecord) => `${c.domain}||${c.path}||${c.key}`;

function shortValue(v: string): string {
  if (v.length <= 10) return '•'.repeat(Math.min(v.length, 8));
  return `${v.slice(0, 4)}…${v.slice(-3)} · ${v.length}`;
}

function expiryLabel(c: CookieRecord, localeStr: string): string {
  if (!c.expires) return 'session';
  const left = c.expires - Date.now();
  if (left < 0) return 'expired';
  if (left < 3600_000) return `${Math.round(left / 1000)}s`;
  return new Date(c.expires).toLocaleString(localeStr);
}

export default function CookieManager() {
  const { t, language } = useTranslation();
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState('');
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = () => setTick((v) => v + 1);

  const all = useMemo(() => cookieJar.getAll(), [tick]);
  const domains = useMemo(() => [...new Set(all.map((c) => c.domain))].sort(), [all]);
  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all
        .filter((c) => !q || `${c.domain} ${c.path} ${c.key} ${c.value}`.toLowerCase().includes(q))
        .sort((a, b) => a.domain.localeCompare(b.domain) || a.path.localeCompare(b.path) || a.key.localeCompare(b.key)),
    [all, q],
  );
  const localeStr = language === 'vi' ? 'vi-VN' : 'en-US';

  function removeOne(c: CookieRecord) {
    cookieJar.remove(c.domain, c.key);
    refresh();
  }

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <div className="flex items-start justify-between gap-3 shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-cyan-200">{t.cookies.title}</h2>
          <p className="text-[11px] text-slate-400 mt-0.5">{t.cookies.ramNote}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.cookies.searchPlaceholder}
            className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 w-44 outline-none focus:border-teal-500"
          />
          <button
            onClick={refresh}
            title={t.cookies.refresh}
            className="bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-300"
          >
            {t.cookies.refresh}
          </button>
          {all.length > 0 &&
            (confirmClear ? (
              <span className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    cookieJar.clear();
                    setRevealed({});
                    setConfirmClear(false);
                    refresh();
                  }}
                  className="bg-red-950 hover:bg-red-900 border border-red-700 rounded-lg px-2.5 py-1 text-xs text-red-200"
                >
                  {t.cookies.confirmClear}
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-400"
                >
                  {t.common.cancel}
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="bg-slate-900 hover:bg-red-950 hover:border-red-700 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-300"
              >
                {t.cookies.clearAll}
              </button>
            ))}
        </div>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-slate-400 shrink-0">
        <span>
          {t.cookies.count.replace('{n}', String(all.length))}
          {q ? ` · ${t.cookies.filtered.replace('{n}', String(rows.length))}` : ''}
        </span>
        {domains.length > 0 && (
          <span className="flex items-center gap-1 flex-wrap">
            {domains.slice(0, 6).map((d) => (
              <button
                key={d}
                onClick={() => setQuery(d)}
                className="bg-slate-800/70 hover:bg-slate-700 border border-slate-700/60 rounded px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
              >
                {d}
              </button>
            ))}
            {domains.length > 6 && <span className="text-slate-500">+{domains.length - 6}</span>}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto border border-slate-800 rounded-lg">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            {all.length === 0 ? t.cookies.empty : t.cookies.noMatch}
          </p>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 bg-[#0b141e] text-slate-400 text-[11px] uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 font-medium">{t.cookies.colDomain}</th>
                <th className="px-3 py-2 font-medium">{t.cookies.colPath}</th>
                <th className="px-3 py-2 font-medium">{t.cookies.colKey}</th>
                <th className="px-3 py-2 font-medium">{t.cookies.colValue}</th>
                <th className="px-3 py-2 font-medium">{t.cookies.colExpires}</th>
                <th className="px-3 py-2 font-medium">{t.cookies.colFlags}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const id = rowId(c);
                const shown = !!revealed[id];
                return (
                  <tr key={id} className="border-t border-slate-800/70 hover:bg-slate-800/30">
                    <td className="px-3 py-1.5 font-mono text-slate-300">
                      {c.hostOnly ? '' : '.'}
                      {c.domain}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-slate-400">{c.path}</td>
                    <td className="px-3 py-1.5 font-mono text-cyan-200">{c.key}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-200 max-w-[22rem]">
                      <button
                        onClick={() => setRevealed((r) => ({ ...r, [id]: !r[id] }))}
                        title={shown ? t.cookies.hide : t.cookies.reveal}
                        className="truncate text-left hover:text-amber-200"
                      >
                        {shown ? c.value : shortValue(c.value)}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">{expiryLabel(c, localeStr)}</td>
                    <td className="px-3 py-1.5 space-x-1 whitespace-nowrap">
                      {c.httpOnly && (
                        <span className="bg-sky-950 text-sky-300 border border-sky-800/60 rounded px-1 text-[10px]">HttpOnly</span>
                      )}
                      {c.secure && (
                        <span className="bg-emerald-950 text-emerald-300 border border-emerald-800/60 rounded px-1 text-[10px]">Secure</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        onClick={() => removeOne(c)}
                        title={t.cookies.removeOne}
                        className="text-slate-500 hover:text-red-300 text-[11px]"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-slate-500 shrink-0">{t.cookies.footer}</p>
    </div>
  );
}
