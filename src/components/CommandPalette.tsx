import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../stores/app';
import { useRequestStore } from '../stores/request';
import { useTranslation } from '../stores/language';
import type { ApiRequest } from '../types/api';

type Item =
  | { kind: 'request'; label: string; sub: string; desc?: string; request: ApiRequest }
  | { kind: 'history'; label: string; sub: string; desc?: string; request: ApiRequest }
  | { kind: 'env'; label: string; sub: string; envId: string }
  | { kind: 'command'; label: string; sub: string; run: () => void };

export default function CommandPalette({ onOpenView }: { onOpenView?: (view: string) => void } = {}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const { collections, requests, history, environments, activeEnvId, setActiveEnv } = useAppStore();
  const { load, openTab } = useRequestStore();
  const { t, language, toggleLanguage } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Escape chỉ thuộc về palette khi nó đang mở — đóng thì listener gỡ ra, modal khác giữ phím của họ
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
    } else {
      triggerRef.current?.focus();
    }
  }, [open]);

  const VIEW_LABEL: Record<string, string> = {
    builder: t.nav.builder,
    runner: t.nav.runner,
    flow: t.nav.flow,
    ws: t.dock.ws,
    grpc: t.dock.grpc,
    mock: t.dock.mock,
    env: t.dock.env,
    ai: t.dock.ai,
    cookies: t.dock.cookies,
  };

  const commands = useMemo<Item[]>(() => {
    const list: Item[] = [
      { kind: 'command', label: t.commandPalette.cmdNewTab, sub: t.commandPalette.cmdGroup, run: () => openTab() },
      ...Object.keys(VIEW_LABEL).map(
        (v) =>
          ({
            kind: 'command',
            label: `${t.commandPalette.cmdOpen} ${VIEW_LABEL[v]}`,
            sub: t.commandPalette.cmdGroup,
            run: () => onOpenView?.(v),
          }) as Item,
      ),
      { kind: 'command', label: t.commandPalette.cmdToggleLang, sub: t.commandPalette.cmdGroup, run: () => toggleLanguage() },
      { kind: 'command', label: t.diagnostics.title, sub: t.diagnostics.button, run: () => window.dispatchEvent(new CustomEvent('reqx:open-diagnostics')) },
      {
        kind: 'command',
        label: '📖 Hướng dẫn tính năng & Cẩm nang ReqX',
        sub: 'Trợ lý AI / Docs',
        run: () => {
          useAppStore.getState().setAiSeedPrompt('Hướng dẫn các tính năng chính của ReqX và cách sử dụng');
          onOpenView?.('ai');
        },
      },
    ];
    return list;
  }, [t, onOpenView, openTab, toggleLanguage]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    const cmdHits: Item[] = commands.filter((c) => match(`${c.label} ${c.sub}`)).slice(0, 6);
    const reqHits: Item[] = [];
    const histHits: Item[] = [];
    const envHits: Item[] = [];

    for (const c of collections) {
      const ids = [...c.rootRequestIds, ...c.folders.flatMap((f) => f.requestIds)];
      for (const id of ids) {
        const r = requests[id];
        if (!r) continue;
        if (match(`${r.method} ${r.name} ${r.url} ${c.name} ${r.description || ''}`)) {
          reqHits.push({
            kind: 'request',
            label: `${r.method} ${r.name}`,
            sub: `${c.name} • ${r.url.slice(0, 60)}`,
            desc: r.description,
            request: r,
          });
        }
      }
    }
    const localeStr = language === 'vi' ? 'vi-VN' : 'en-US';
    for (const h of history.slice(0, 30)) {
      if (match(`${h.request.method} ${h.request.name} ${h.request.url} ${h.responseStatus} ${h.request.description || ''}`)) {
        histHits.push({
          kind: 'history',
          label: `${h.request.method} ${h.request.name || h.request.url.slice(0, 40)}`,
          sub: `${t.commandPalette.historySub} • ${h.responseStatus} • ${new Date(h.createdAt).toLocaleString(localeStr)}`,
          desc: h.request.description,
          request: h.request,
        });
      }
    }
    for (const e of environments) {
      if (match(`${e.name} ${Object.keys(e.variables).join(' ')}`)) {
        envHits.push({
          kind: 'env',
          label: `${e.id === activeEnvId ? '● ' : '○ '}${e.name}`,
          sub: `${t.commandPalette.kindEnv} • ${Object.keys(e.variables).length} ${t.commandPalette.varsCount}`,
          envId: e.id,
        });
      }
    }

    // Hạn ngạch từng loại: collection lớn + lệnh không được nuốt hết chỗ của môi trường
    const CAP = 25;
    const merged = [
      ...cmdHits,
      ...reqHits.slice(0, 14),
      ...envHits.slice(0, 5),
      ...histHits.slice(0, 6),
    ];
    const out = merged.slice(0, CAP);
    const spare = CAP - out.length;
    if (spare > 0) {
      const rest = [...reqHits, ...histHits, ...envHits].filter((it) => !out.includes(it));
      out.push(...rest.slice(0, spare));
    }
    return out;
  }, [query, collections, requests, history, environments, activeEnvId, language, t, commands]);

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(items.length - 1, 0)));
  }, [items.length]);

  // C-1: luôn nhìn thấy dòng đang chọn khi bấm phím mũi tên
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  function run(item: Item) {
    if (item.kind === 'env') setActiveEnv(item.envId);
    else if (item.kind === 'command') item.run();
    else load(item.request);
    setOpen(false);
  }

  const KIND_LABEL: Record<Item['kind'], string> = {
    command: t.commandPalette.kindCommand,
    request: t.commandPalette.kindRequest,
    history: t.commandPalette.kindHistory,
    env: t.commandPalette.kindEnv,
  };

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(true)}
        title={`${t.commandPalette.searchButton} (${t.commandPalette.ctrlK})`}
        aria-haspopup="dialog"
        aria-label={t.commandPalette.searchButton}
        className="flex items-center gap-1.5 bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 hover:border-teal-500/50 rounded-xl px-2.5 py-1 text-xs text-slate-300 hover:text-cyan-200 transition-all shadow-sm shrink-0"
      >
        <span>🔍</span>
        <span className="hidden xl:inline text-slate-400">{t.commandPalette.searchButton}</span>
        <kbd className="bg-slate-800 text-slate-400 border border-slate-700/60 rounded px-1.5 py-0.5 font-mono text-[10px]">
          {t.commandPalette.ctrlK}
        </kbd>
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-sm flex justify-center pt-20 px-4 animate-in fade-in duration-150"
            onClick={() => setOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t.commandPalette.placeholder}
              className="w-full max-w-xl h-fit bg-slate-900 dark:bg-[#0b141e] border border-teal-500/40 rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.85)] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                // Tab không được thoát khỏi overlay; phím trong palette không nổ shortcut toàn cục
                if (e.key === 'Tab') e.preventDefault();
                e.stopPropagation();
              }}
            >
              <div className="flex items-center px-4 py-3 border-b border-slate-800 gap-2.5 bg-slate-900/50">
                <span className="text-slate-400 text-sm">🔍</span>
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="palette-listbox"
                  aria-activedescendant={items[cursor] ? `palette-opt-${cursor}` : undefined}
                  aria-label={t.commandPalette.placeholder}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setCursor((c) => (items.length ? (c + 1) % items.length : 0));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setCursor((c) => (items.length ? (c - 1 + items.length) % items.length : 0));
                    } else if (e.key === 'Enter' && items[cursor]) {
                      e.preventDefault();
                      run(items[cursor]);
                    }
                  }}
                  placeholder={t.commandPalette.placeholder}
                  className="w-full bg-transparent outline-none text-sm text-slate-100 placeholder:text-slate-500"
                />
                <kbd className="bg-slate-800 text-slate-400 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[10px] shrink-0">
                  ESC
                </kbd>
              </div>

              <div id="palette-listbox" ref={listRef} role="listbox" aria-label={t.commandPalette.placeholder} className="max-h-80 overflow-auto py-1">
                {items.length === 0 && (
                  <p className="px-4 py-8 text-center text-sm text-slate-500">
                    {t.commandPalette.noResults.replace('{query}', query)}
                  </p>
                )}
                {items.map((it, i) => (
                  <button
                    key={`${it.kind}-${i}`}
                    id={`palette-opt-${i}`}
                    data-idx={i}
                    role="option"
                    aria-selected={i === cursor}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => run(it)}
                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors ${
                      i === cursor ? 'bg-teal-950/60 text-cyan-200' : 'text-slate-300 hover:bg-slate-800/60'
                    }`}
                  >
                    <span
                      className={`shrink-0 text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${
                        it.kind === 'command'
                          ? 'bg-violet-950 text-violet-300 border border-violet-800/60'
                          : it.kind === 'request'
                            ? 'bg-sky-950 text-sky-400 border border-sky-800/60'
                            : it.kind === 'env'
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                              : 'bg-slate-800 text-slate-400 border border-slate-700/60'
                      }`}
                    >
                      {KIND_LABEL[it.kind]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{it.label}</span>
                      <span className="block truncate text-xs text-slate-400 font-mono">{it.sub}</span>
                      {'desc' in it && it.desc ? (
                        <span className="block truncate text-xs text-slate-400 italic mt-0.5">{it.desc}</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between px-4 py-2 text-[11px] text-slate-500 border-t border-slate-800/80 bg-slate-900/30">
                <span>{t.commandPalette.hint}</span>
                <span className="text-[10px] text-slate-600">Ctrl + K</span>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
