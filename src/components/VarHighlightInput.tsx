import { useRef, useState, useEffect } from 'react';
import { useAppStore } from '../stores/app';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** trả về true nếu tên biến đã có giá trị */
  hasVar: (name: string) => boolean;
  onMissing?: (names: string[]) => void;
}

const VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}|\{([a-zA-Z_]\w*)\}/g;

/** Input 1 dòng highlight {{var}}: có → xanh, thiếu → đỏ gạch chân + tự động gợi ý biến. */
export default function VarHighlightInput({ value, onChange, placeholder, hasVar }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLDivElement>(null);

  const { environments, activeEnvId, globals } = useAppStore();
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState('');
  const [suggestIndex, setSuggestIndex] = useState(0);

  const activeEnv = environments.find((e) => e.id === activeEnvId);
  const activeVars = activeEnv ? Object.keys(activeEnv.variables) : [];
  const globalVars = Object.keys(globals);
  const allVars = Array.from(new Set([...activeVars, ...globalVars]));

  const filteredVars = allVars.filter(v => v.toLowerCase().includes(suggestQuery.toLowerCase()));

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

  // Đóng suggest khi click ra ngoài (input mất focus)
  useEffect(() => {
    const handleBlur = () => setShowSuggest(false);
    const el = inputRef.current;
    if (el) el.addEventListener('blur', handleBlur);
    return () => {
      if (el) el.removeEventListener('blur', handleBlur);
    };
  }, []);

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
        className="absolute inset-0 px-3 py-2 font-mono text-sm whitespace-pre overflow-hidden pointer-events-none text-slate-100"
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
              applySuggest(filteredVars[suggestIndex]);
            } else if (e.key === 'Escape') {
              setShowSuggest(false);
            }
          }
        }}
        onScroll={syncScroll}
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
        placeholder=""
        spellCheck={false}
        autoComplete="off"
        className="relative w-full px-3 py-2 font-mono text-sm bg-transparent outline-none text-transparent caret-emerald-300 selection:bg-emerald-900"
      />
      {showSuggest && filteredVars.length > 0 && (
        <ul className="absolute left-0 top-[calc(100%+4px)] mt-0 w-max min-w-[250px] bg-slate-800 border border-slate-600 rounded-md shadow-2xl z-[100] max-h-48 overflow-auto flex flex-col py-1 text-sm font-mono text-slate-200">
          {filteredVars.map((v, i) => (
            <li
              key={v}
              className={`px-3 py-1.5 cursor-pointer flex justify-between items-center ${i === suggestIndex ? 'bg-emerald-700 text-white font-bold' : 'hover:bg-slate-700'}`}
              onMouseDown={(e) => {
                e.preventDefault(); // Giữ focus cho input
                applySuggest(v);
              }}
              onMouseEnter={() => setSuggestIndex(i)}
            >
              <span>{v}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
