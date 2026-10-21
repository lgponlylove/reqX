import { useRef, useState, useMemo } from 'react';
import { useAppStore } from '../stores/app';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  /** trả về true nếu tên biến đã có giá trị */
  hasVar: (name: string) => boolean;
  onMissing?: (names: string[]) => void;
}

interface VarSuggestionItem {
  name: string;
  source: string;
  valuePreview: string;
  isSecret: boolean;
  isActive: boolean;
}

const VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}|\{([a-zA-Z0-9_.-]+)\}/g;

/** Input 1 dòng highlight {{var}}: có → xanh, thiếu → đỏ gạch chân + tự động gợi ý biến thông minh. */
export default function VarHighlightInput({ value, onChange, onPaste, placeholder, hasVar }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLDivElement>(null);

  const { environments, activeEnvId, globals, envSecrets, globalSecrets } = useAppStore();
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState('');
  const [suggestIndex, setSuggestIndex] = useState(0);

  // Tập hợp danh sách gợi ý biến từ Active Env, Globals, và cả các Envs khác (không để sót)
  const allSuggestions = useMemo(() => {
    const list: VarSuggestionItem[] = [];
    const seen = new Set<string>();

    const activeEnv = environments.find((e) => e.id === activeEnvId);
    const activeSec = new Set(activeEnv ? envSecrets[activeEnv.id] ?? [] : []);

    // 1. Biến từ Active Environment (ưu tiên cao nhất)
    if (activeEnv) {
      const allActiveKeys = new Set([...Object.keys(activeEnv.variables), ...activeSec]);
      for (const k of allActiveKeys) {
        if (!k.trim()) continue;
        const isSec = activeSec.has(k);
        list.push({
          name: k,
          source: activeEnv.name,
          valuePreview: isSec ? '••••••' : (activeEnv.variables[k] ?? ''),
          isSecret: isSec,
          isActive: true,
        });
        seen.add(k);
      }
    }

    // 2. Biến từ Globals
    const gSec = new Set(globalSecrets ?? []);
    const allGlobalKeys = new Set([...Object.keys(globals), ...gSec]);
    for (const k of allGlobalKeys) {
      if (!k.trim() || seen.has(k)) continue;
      const isSec = gSec.has(k);
      list.push({
        name: k,
        source: 'Globals',
        valuePreview: isSec ? '••••••' : (globals[k] ?? ''),
        isSecret: isSec,
        isActive: true,
      });
      seen.add(k);
    }

    // 3. Biến từ các Environment khác (để khi chưa chọn active env hoặc gõ biến env khác vẫn tìm thấy)
    for (const env of environments) {
      if (env.id === activeEnvId) continue;
      const sec = new Set(envSecrets[env.id] ?? []);
      const keys = new Set([...Object.keys(env.variables), ...sec]);
      for (const k of keys) {
        if (!k.trim() || seen.has(k)) continue;
        const isSec = sec.has(k);
        list.push({
          name: k,
          source: env.name,
          valuePreview: isSec ? '••••••' : (env.variables[k] ?? ''),
          isSecret: isSec,
          isActive: false,
        });
        seen.add(k);
      }
    }

    return list;
  }, [environments, activeEnvId, globals, envSecrets, globalSecrets]);

  const filteredVars = useMemo(() => {
    const q = suggestQuery.trim().toLowerCase();
    if (!q) return allSuggestions;
    return allSuggestions.filter((v) =>
      v.name.toLowerCase().includes(q) || v.source.toLowerCase().includes(q)
    );
  }, [allSuggestions, suggestQuery]);

  function syncScroll() {
    if (inputRef.current && backRef.current) {
      backRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  }

  function applySuggest(varName: string) {
    if (!inputRef.current) return;
    const pos = inputRef.current.selectionStart || 0;
    const beforeCursor = value.slice(0, pos);
    const match = beforeCursor.match(/\{\{([a-zA-Z0-9_.-]*)$/);
    if (match) {
      const prefix = value.slice(0, pos - match[1].length); // giữ lại {{
      const suffix = value.slice(pos);
      const hasClosing = suffix.trimStart().startsWith('}}');
      const insert = varName + (hasClosing ? '' : '}}');
      const nextValue = prefix + insert + suffix;
      onChange(nextValue);
      setShowSuggest(false);

      const nextPos = prefix.length + varName.length + (hasClosing ? 0 : 2);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.selectionStart = inputRef.current.selectionEnd = nextPos;
          inputRef.current.focus();
        }
      }, 0);
    }
  }

  // Tách value thành đoạn thường / biến / param
  const parts: { text: string; name: string | null; isParam?: boolean }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(value)) !== null) {
    if (m.index > last) parts.push({ text: value.slice(last, m.index), name: null });
    if (m[1]) {
      parts.push({ text: m[0], name: m[1], isParam: false });
    } else if (m[2]) {
      parts.push({ text: m[0], name: m[2], isParam: true });
    }
    last = m.index + m[0].length;
  }
  if (last < value.length) parts.push({ text: value.slice(last), name: null });

  return (
    <div className="relative flex-1 min-w-0 bg-transparent">
      <div
        ref={backRef}
        aria-hidden
        className="absolute inset-0 px-2.5 py-1.5 font-mono text-xs whitespace-pre overflow-hidden pointer-events-none text-slate-100"
      >
        {parts.length === 0 ? (
          <span className="text-slate-500">{placeholder}</span>
        ) : (
          parts.map((p, i) =>
            p.name === null ? (
              <span key={i}>{p.text}</span>
            ) : p.isParam ? (
              <span key={i} className="text-amber-300 font-semibold drop-shadow-[0_0_8px_rgba(252,211,77,0.4)]">
                {p.text}
              </span>
            ) : (
              <span
                key={i}
                className={
                  hasVar(p.name)
                    ? 'text-emerald-300 font-semibold'
                    : 'text-red-400 font-semibold underline decoration-wavy underline-offset-2'
                }
              >
                {p.text}
              </span>
            ),
          )
        )}
      </div>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          const val = e.target.value;
          onChange(val);
          requestAnimationFrame(() => {
            syncScroll();
            if (!inputRef.current) return;
            const pos = inputRef.current.selectionStart || 0;
            const beforeCursor = val.slice(0, pos);
            const match = beforeCursor.match(/\{\{([a-zA-Z0-9_.-]*)$/);
            if (match) {
              setSuggestQuery(match[1]);
              setShowSuggest(true);
              setSuggestIndex(0);
            } else {
              setShowSuggest(false);
            }
          });
        }}
        onKeyDown={(e) => {
          if (showSuggest && filteredVars.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSuggestIndex((i) => (i + 1) % filteredVars.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSuggestIndex((i) => (i - 1 + filteredVars.length) % filteredVars.length);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              applySuggest(filteredVars[suggestIndex].name);
            } else if (e.key === 'Escape') {
              setShowSuggest(false);
            }
          }
        }}
        onScroll={syncScroll}
        onPaste={onPaste}
        onFocus={(e) => {
          // Bật suggest nếu vừa focus vào vị trí có {{
          const val = e.target.value;
          const pos = e.target.selectionStart || 0;
          const beforeCursor = val.slice(0, pos);
          const match = beforeCursor.match(/\{\{([a-zA-Z0-9_.-]*)$/);
          if (match) {
            setSuggestQuery(match[1]);
            setShowSuggest(true);
            setSuggestIndex(0);
          }
        }}
        onBlur={() => {
          // Cho phép click vào suggestion menu trước khi đóng (tránh mất focus đột ngột)
          setTimeout(() => setShowSuggest(false), 200);
        }}
        placeholder=""
        spellCheck={false}
        autoComplete="off"
        className="relative w-full px-2.5 py-1.5 font-mono text-xs bg-transparent outline-none text-transparent caret-emerald-300 selection:bg-emerald-900"
      />
      {showSuggest && filteredVars.length > 0 && (
        <ul className="absolute left-0 top-[calc(100%+4px)] mt-0 w-max min-w-[280px] max-w-[420px] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-[100] max-h-56 overflow-auto flex flex-col py-1 text-xs font-mono text-slate-200 backdrop-blur-md">
          {filteredVars.map((v, i) => (
            <li
              key={`${v.source}_${v.name}`}
              className={`px-3 py-1.5 cursor-pointer flex justify-between items-center gap-3 transition-colors ${
                i === suggestIndex ? 'bg-emerald-700/80 text-white font-bold' : 'hover:bg-slate-800'
              }`}
              onMouseDown={(e) => {
                e.preventDefault(); // Giữ focus cho input
                applySuggest(v.name);
              }}
              onMouseEnter={() => setSuggestIndex(i)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-emerald-300 font-semibold">{v.name}</span>
                {v.valuePreview && (
                  <span className="text-slate-400 text-[11px] font-normal truncate max-w-[140px]" title={v.valuePreview}>
                    = {v.valuePreview}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-sans shrink-0 uppercase tracking-wider ${
                  v.source === 'Globals'
                    ? 'bg-sky-950 text-sky-400 border border-sky-800/60'
                    : v.isActive
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {v.source}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
