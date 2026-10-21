import { useState } from 'react';
import type { KeyValue } from '../types/api';
import { uid } from '../lib/variables';
import VarHighlightInput from './VarHighlightInput';
import { useAppStore } from '../stores/app';
import { useTranslation } from '../stores/language';

interface Props {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Danh sách key gợi ý khi gõ (vd. tên header thông dụng) — không truyền thì không có autocomplete */
  suggestKeys?: string[];
  /** Tên trường cần nháy sáng và cuộn tới (vd: 'authorization') */
  highlightKey?: string;
}

/** Số dòng gợi ý hiển thị tối đa — đủ để không phải cuộn mà vẫn kín màn hình. */
const MAX_SUGGESTIONS = 9;

/**
 * Cột Key chỉ cần hẹp: giá trị (token, URL, form) mới cần chỗ. Dùng chung cho hàng
 * label và hàng input để 2 cột thẳng nhau; Value là `flex-1` nên tự chiếm phần còn lại.
 */
const KEY_COL = 'w-[34%] min-w-[110px] max-w-[300px]';

export default function KeyValueEditor({
  items, onChange, keyPlaceholder, valuePlaceholder, suggestKeys, highlightKey,
}: Props) {
  const { t: i18n } = useTranslation();
  const { environments, activeEnvId, globals, envSecrets, globalSecrets } = useAppStore();
  const activeEnv = environments.find((e) => e.id === activeEnvId);
  const activeSec = new Set(activeEnv ? envSecrets[activeEnv.id] ?? [] : []);
  const gSec = new Set(globalSecrets ?? []);
  // Dòng đang mở danh sách gợi ý + dòng đang được chọn bằng phím mũi tên
  const [openId, setOpenId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);

  const finalKeyPlaceholder = keyPlaceholder ?? i18n.request.key;
  const finalValuePlaceholder = valuePlaceholder ?? i18n.request.valuePlaceholder;

  function hasVar(name: string) {
    if (!name) return false;
    if (activeEnv && (activeEnv.variables[name] !== undefined || activeSec.has(name))) return true;
    if (globals[name] !== undefined || gSec.has(name)) return true;
    if (environments.some((e) => name in e.variables || (envSecrets[e.id] ?? []).includes(name))) return true;
    return false;
  }

  function update(id: string, patch: Partial<KeyValue>) {
    onChange(items.map((kv) => (kv.id === id ? { ...kv, ...patch } : kv)));
  }
  function remove(id: string) {
    onChange(items.filter((kv) => kv.id !== id));
  }
  function add() {
    onChange([...items, { id: uid('kv'), key: '', value: '', enabled: true }]);
  }

  /** Key khớp với ô đang gõ, đã loại bỏ key các dòng khác dùng rồi. */
  function candidates(kv: KeyValue): string[] {
    if (!suggestKeys) return [];
    const q = kv.key.trim().toLowerCase();
    const used = new Set(
      items.filter((i) => i.id !== kv.id).map((i) => i.key.trim().toLowerCase()),
    );
    // Gõ đúng 1 key (không phân biệt hoa thường) thì khỏi gợi ý nữa
    if (q && suggestKeys.some((k) => k.toLowerCase() === q)) return [];
    const pool = suggestKeys.filter((k) => !used.has(k.toLowerCase()));
    if (!q) return pool.slice(0, MAX_SUGGESTIONS);
    const hits = pool.filter((k) => k.toLowerCase().includes(q));
    // Ưu tiên key bắt đầu bằng chuỗi đã gõ, giống Postman
    hits.sort(
      (a, b) =>
        Number(b.toLowerCase().startsWith(q)) - Number(a.toLowerCase().startsWith(q)) ||
        a.length - b.length,
    );
    return hits.slice(0, MAX_SUGGESTIONS);
  }

  function pick(id: string, key: string) {
    update(id, { key });
    setOpenId(null);
  }

  function onKeyKv(e: React.KeyboardEvent<HTMLInputElement>, kv: KeyValue) {
    const list = candidates(kv);
    if (list.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (openId !== kv.id) {
        setOpenId(kv.id);
        setHighlight(e.key === 'ArrowDown' ? 0 : list.length - 1);
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setHighlight((h) => (h + step + list.length) % list.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (openId !== kv.id) return;
      const chosen = list[Math.min(highlight, list.length - 1)];
      if (!chosen) return;
      e.preventDefault();
      pick(kv.id, chosen);
    } else if (e.key === 'Escape') {
      setOpenId(null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5 items-center text-xs text-slate-400 font-medium px-1 mb-1 pb-1 border-b border-slate-800/60">
        <span className="w-4 shrink-0" />
        <span className={KEY_COL}>{i18n.request.key}</span>
        <span className="flex-1 min-w-0">{i18n.request.value}</span>
        <span className="w-24 text-slate-500 hidden sm:inline">{i18n.request.description}</span>
        <span className="w-5" />
      </div>
      {items.length === 0 && (
        <p className="text-xs text-slate-500 px-1 py-1">{i18n.request.emptyRows}</p>
      )}
      {items.map((kv) => {
        const list = openId === kv.id ? candidates(kv) : [];
        const isTarget = highlightKey && kv.key.trim().toLowerCase() === highlightKey.trim().toLowerCase();
        return (
          <div
            key={kv.id}
            className={`flex gap-1.5 items-center rounded p-1 transition-all duration-300 ${
              isTarget
                ? 'bg-amber-950/60 border border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.4)] ring-1 ring-amber-400'
                : ''
            }`}
          >
            <input
              type="checkbox"
              title={i18n.request.toggleRow}
              checked={kv.enabled}
              onChange={(e) => update(kv.id, { enabled: e.target.checked })}
              className="accent-emerald-500 w-4 h-4"
            />
            <div className={`relative min-w-0 ${KEY_COL}`}>
              <input
                spellCheck={false}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono"
                placeholder={finalKeyPlaceholder}
                value={kv.key}
                onChange={(e) => {
                  update(kv.id, { key: e.target.value });
                  setOpenId(kv.id);
                  setHighlight(0);
                }}
                onFocus={() => {
                  setOpenId(kv.id);
                  setHighlight(0);
                }}
                onBlur={() => setOpenId((id) => (id === kv.id ? null : id))}
                onKeyDown={(e) => onKeyKv(e, kv)}
              />
              {list.length > 0 && (
                <div className="absolute left-0 top-full mt-1 z-30 w-64 max-h-60 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 shadow-lg shadow-black/50">
                  {list.map((c, i) => (
                    <button
                      // preventDefault để ô key không mất focus trước khi click kịp chạy
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(kv.id, c)}
                      className={`block w-full text-left px-2.5 py-1 text-xs font-mono ${
                        i === highlight
                          ? 'bg-emerald-500/20 text-emerald-200'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <VarHighlightInput
              placeholder={finalValuePlaceholder}
              value={kv.value}
              onChange={(val) => update(kv.id, { value: val })}
              hasVar={hasVar}
            />
            <button
              onClick={() => remove(kv.id)}
              title={i18n.request.deleteRow}
              className="text-slate-500 hover:text-red-400 px-1.5"
            >
              ✕
            </button>
          </div>
        );
      })}
      <button
        onClick={add}
        className="self-start mt-1 bg-slate-800 hover:bg-slate-700 rounded px-3 py-1 text-xs"
      >
        {i18n.request.addRow}
      </button>
    </div>
  );
}
