import { useRef, useState, useMemo, type ReactNode } from 'react';
import { useAppStore } from '../stores/app';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Ô trong popup phóng to: cao lấp đầy khung thay vì cao mặc định 7 dòng. */
  tall?: boolean;
  /** Ô nhỏ trong tab Body: lớn hết chỗ còn lại của pane, tối thiểu 128px. */
  fill?: boolean;
}
/** Token JSON: chuỗi (+dấu : của key), true/false/null, số, {{biến}}, dấu ngoặc. */
const TOKEN_RE = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\{\{\s*[\w.-]+\s*\}\}|[{}\[\],:]/g;

/** Tô màu JSON bằng regex (không cần parse nên JSON sai vẫn có màu). */
function highlightJson(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={k++}>{text.slice(last, m.index)}</span>);
    const [tok, str, colon, lit] = m;
    if (str) {
      out.push(
        <span key={k++} className={colon ? 'text-sky-300' : 'text-amber-200'}>
          {str}
        </span>,
      );
      if (colon) out.push(<span key={k++} className="text-slate-500">{colon}</span>);
    } else if (lit) {
      out.push(<span key={k++} className="text-rose-300">{tok}</span>);
    } else if (/^-?\d/.test(tok)) {
      out.push(<span key={k++} className="text-violet-300">{tok}</span>);
    } else if (tok.startsWith('{{')) {
      out.push(<span key={k++} className="text-emerald-300 font-semibold">{tok}</span>);
    } else {
      out.push(<span key={k++} className="text-slate-500">{tok}</span>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(<span key={k++}>{text.slice(last)}</span>);
  return out;
}

/** Textarea nhiều dòng highlight JSON: key xanh, chuỗi vàng, số tím, true/false/null hồng, {{biến}} xanh lá + gợi ý {{var}}. */
export default function JsonBodyEditor({ value, onChange, placeholder, tall, fill }: Props) {
  const backRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  /** tall = lấp đầy popup; fill = lấp đầy pane với sàn 128px. */
  const stretch = tall || fill;

  const { environments, activeEnvId, globals, envSecrets, globalSecrets } = useAppStore();
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState('');
  const [suggestIndex, setSuggestIndex] = useState(0);

  // Danh sách gợi ý biến gom từ Active Env, Globals, và cả Envs khác
  const allSuggestions = useMemo(() => {
    const list: { name: string; source: string; valuePreview: string; isActive: boolean }[] = [];
    const seen = new Set<string>();

    const activeEnv = environments.find((e) => e.id === activeEnvId);
    const activeSec = new Set(activeEnv ? envSecrets[activeEnv.id] ?? [] : []);

    if (activeEnv) {
      const keys = new Set([...Object.keys(activeEnv.variables), ...activeSec]);
      for (const k of keys) {
        if (!k.trim()) continue;
        list.push({
          name: k,
          source: activeEnv.name,
          valuePreview: activeSec.has(k) ? '••••••' : (activeEnv.variables[k] ?? ''),
          isActive: true,
        });
        seen.add(k);
      }
    }

    const gSec = new Set(globalSecrets ?? []);
    const gKeys = new Set([...Object.keys(globals), ...gSec]);
    for (const k of gKeys) {
      if (!k.trim() || seen.has(k)) continue;
      list.push({
        name: k,
        source: 'Globals',
        valuePreview: gSec.has(k) ? '••••••' : (globals[k] ?? ''),
        isActive: true,
      });
      seen.add(k);
    }

    for (const env of environments) {
      if (env.id === activeEnvId) continue;
      const sec = new Set(envSecrets[env.id] ?? []);
      const keys = new Set([...Object.keys(env.variables), ...sec]);
      for (const k of keys) {
        if (!k.trim() || seen.has(k)) continue;
        list.push({
          name: k,
          source: env.name,
          valuePreview: sec.has(k) ? '••••••' : (env.variables[k] ?? ''),
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

  function syncFromTa() {
    if (backRef.current && taRef.current) {
      backRef.current.scrollTop = taRef.current.scrollTop;
      backRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  }

  function applySuggest(varName: string) {
    if (!taRef.current) return;
    const pos = taRef.current.selectionStart || 0;
    const beforeCursor = value.slice(0, pos);
    const match = beforeCursor.match(/\{\{([a-zA-Z0-9_.-]*)$/);
    if (match) {
      const prefix = value.slice(0, pos - match[1].length);
      const suffix = value.slice(pos);
      const hasClosing = suffix.trimStart().startsWith('}}');
      const insert = varName + (hasClosing ? '' : '}}');
      const nextValue = prefix + insert + suffix;
      onChange(nextValue);
      setShowSuggest(false);

      const nextPos = prefix.length + varName.length + (hasClosing ? 0 : 2);
      setTimeout(() => {
        if (taRef.current) {
          taRef.current.selectionStart = taRef.current.selectionEnd = nextPos;
          taRef.current.focus();
        }
      }, 0);
    }
  }

  // Double click trên textarea: nếu con trỏ đang nằm trong {{varName}} thì mở tab EnvironmentManager
  function handleDoubleClick(e: React.MouseEvent<HTMLTextAreaElement>) {
    const ta = taRef.current;
    if (!ta) return;
    const pos = ta.selectionStart || 0;

    const VAR_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = VAR_PATTERN.exec(value)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (pos >= start && pos <= end) {
        const varName = m[1];
        if (varName) {
          e.preventDefault();
          const st = useAppStore.getState();
          const activeEnv = st.environments.find((env) => env.id === st.activeEnvId);
          const inActive = activeEnv && (varName in activeEnv.variables || (st.envSecrets[activeEnv.id] ?? []).includes(varName));
          const inGlobal = varName in st.globals || (st.globalSecrets ?? []).includes(varName);

          let foundEnvId = st.activeEnvId;
          let isGlobal = false;

          if (inActive) {
            foundEnvId = st.activeEnvId;
          } else if (inGlobal) {
            isGlobal = true;
          } else {
            const other = st.environments.find((env) => varName in env.variables || (st.envSecrets[env.id] ?? []).includes(varName));
            if (other) foundEnvId = other.id;
          }

          st.setTargetEnvVar({
            name: varName,
            envId: foundEnvId,
            isGlobal,
          });
          break;
        }
      }
    }
  }

  return (
    <div className={`relative bg-slate-900 border border-slate-700 rounded ${tall ? 'flex-1 min-h-0' : ''} ${fill ? 'flex-1 min-h-32' : ''}`}>
      <div
        ref={backRef}
        aria-hidden
        className="absolute inset-0 p-2.5 font-mono text-sm whitespace-pre-wrap break-words overflow-hidden pointer-events-none text-slate-100"
        style={{ scrollbarGutter: 'stable' }}
      >
        {value ? highlightJson(value) : <span className="text-slate-500">{placeholder}</span>}
      </div>
      <textarea
        ref={taRef}
        className={`relative block w-full p-2.5 font-mono text-sm bg-transparent outline-none text-transparent caret-emerald-300 selection:bg-emerald-900 whitespace-pre-wrap break-words ${stretch ? 'h-full resize-none' : 'min-h-32'}`}
        style={{ scrollbarGutter: 'stable' }}
        rows={tall ? 20 : 7}
        placeholder=""
        spellCheck={false}
        value={value}
        onChange={(e) => {
          const val = e.target.value;
          onChange(val);
          requestAnimationFrame(() => {
            syncFromTa();
            if (!taRef.current) return;
            const pos = taRef.current.selectionStart || 0;
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
        onBlur={() => {
          setTimeout(() => setShowSuggest(false), 200);
        }}
        onDoubleClick={handleDoubleClick}
        onScroll={syncFromTa}
      />
      {showSuggest && filteredVars.length > 0 && (
        <ul className="absolute left-4 bottom-3 w-max min-w-[280px] max-w-[420px] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-[100] max-h-56 overflow-auto flex flex-col py-1 text-xs font-mono text-slate-200 backdrop-blur-md">
          {filteredVars.map((v, i) => (
            <li
              key={`${v.source}_${v.name}`}
              className={`px-3 py-1.5 cursor-pointer flex justify-between items-center gap-3 transition-colors ${
                i === suggestIndex ? 'bg-emerald-700/80 text-white font-bold' : 'hover:bg-slate-800'
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
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
