import { useRef } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** trả về true nếu tên biến đã có giá trị */
  hasVar: (name: string) => boolean;
  onMissing?: (names: string[]) => void;
}

const VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** Input 1 dòng highlight {{var}}: có → xanh, thiếu → đỏ gạch chân. */
export default function VarHighlightInput({ value, onChange, placeholder, hasVar }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLDivElement>(null);

  function syncScroll() {
    if (inputRef.current && backRef.current) {
      backRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  }

  // Tách value thành đoạn thường / biến
  const parts: { text: string; name: string | null }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(value)) !== null) {
    if (m.index > last) parts.push({ text: value.slice(last, m.index), name: null });
    parts.push({ text: m[0], name: m[1] });
    last = m.index + m[0].length;
  }
  if (last < value.length) parts.push({ text: value.slice(last), name: null });

  return (
    <div className="relative flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded">
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
          onChange(e.target.value);
          requestAnimationFrame(syncScroll);
        }}
        onScroll={syncScroll}
        placeholder=""
        spellCheck={false}
        autoComplete="off"
        className="relative w-full px-3 py-2 font-mono text-sm bg-transparent outline-none text-transparent caret-emerald-300 selection:bg-emerald-900"
      />
    </div>
  );
}
