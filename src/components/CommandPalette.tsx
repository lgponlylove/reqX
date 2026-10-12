import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../stores/app';
import { useRequestStore } from '../stores/request';
import type { ApiRequest } from '../types/api';

type Item =
  | { kind: 'request'; label: string; sub: string; desc?: string; request: ApiRequest }
  | { kind: 'history'; label: string; sub: string; desc?: string; request: ApiRequest }
  | { kind: 'env'; label: string; sub: string; envId: string };

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const { collections, requests, history, environments, activeEnvId, setActiveEnv } = useAppStore();
  const { load } = useRequestStore();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
    }
  }, [open ]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    const out: Item[] = [];

    for (const c of collections) {
      const ids = [...c.rootRequestIds, ...c.folders.flatMap((f) => f.requestIds)];
      for (const id of ids) {
        const r = requests[id];
        if (!r) continue;
        if (match(`${r.method} ${r.name} ${r.url} ${c.name} ${r.description || ''}`)) {
          out.push({
            kind: 'request',
            label: `${r.method} ${r.name}`,
            sub: `${c.name} • ${r.url.slice(0, 60)}`,
            desc: r.description,
            request: r,
          });
        }
      }
    }
    for (const h of history.slice(0, 30)) {
      if (match(`${h.request.method} ${h.request.name} ${h.request.url} ${h.responseStatus} ${h.request.description || ''}`)) {
        out.push({
          kind: 'history',
          label: `${h.request.method} ${h.request.name || h.request.url.slice(0, 40)}`,
          sub: `Lịch sử • ${h.responseStatus} • ${new Date(h.createdAt).toLocaleString('vi-VN')}`,
          desc: h.request.description,
          request: h.request,
        });
      }
    }
    for (const e of environments) {
      if (match(`${e.name} ${Object.keys(e.variables).join(' ')}`)) {
        out.push({
          kind: 'env',
          label: `${e.id === activeEnvId ? '● ' : '○ '}${e.name}`,
          sub: `Môi trường • ${Object.keys(e.variables).length} biến`,
          envId: e.id,
        });
      }
    }
    return out.slice(0, 25);
  }, [query, collections, requests, history, environments, activeEnvId]);

  useEffect(() => setCursor(0), [query]);

  function run(item: Item) {
    if (item.kind === 'env') setActiveEnv(item.envId);
    else load(item.request);
    setOpen(false);
  }

  const KIND_LABEL: Record<Item['kind'], string> = {
    request: 'Request',
    history: 'Lịch sử',
    env: 'Môi trường',
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="ml-auto flex items-center gap-2 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:border-slate-600"
      >
        🔍 Tìm kiếm...
        <kbd className="bg-slate-800 rounded px-1.5 py-0.5 font-mono text-[10px]">Ctrl K</kbd>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex justify-center pt-24 px-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg h-fit bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, items.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                } else if (e.key === 'Enter' && items[cursor]) {
                  run(items[cursor]);
                }
              }}
              placeholder="Tìm request, lịch sử, môi trường..."
              className="w-full bg-transparent outline-none px-4 py-3 text-sm border-b border-slate-800"
            />
            <div className="max-h-80 overflow-auto py-1">
              {items.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-slate-500">
                  Không tìm thấy gì cho “{query}”.
                </p>
              )}
              {items.map((it, i) => (
                <button
                  key={`${it.kind}-${i}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => run(it)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm ${
                    i === cursor ? 'bg-slate-800' : ''
                  }`}
                >
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide bg-slate-800 rounded px-1.5 py-0.5 text-slate-400">
                    {KIND_LABEL[it.kind]}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{it.label}</span>
                    <span className="block truncate text-xs text-slate-500 font-mono">{it.sub}</span>
                    {('desc' in it && it.desc) ? (
                      <span className="block truncate text-xs text-slate-400 italic mt-0.5">{it.desc}</span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
            <p className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-800">
              ↑↓ di chuyển • Enter mở • Esc đóng
            </p>
          </div>
        </div>
      )}
    </>
  );
}
