import { useRef, type ReactNode } from 'react';

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

/** Textarea nhiều dòng highlight JSON: key xanh, chuỗi vàng, số tím, true/false/null hồng, {{biến}} xanh lá. */
export default function JsonBodyEditor({ value, onChange, placeholder, tall, fill }: Props) {
  const backRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  /** tall = lấp đầy popup; fill = lấp đầy pane với sàn 128px. */
  const stretch = tall || fill;

  function syncFromTa() {
    if (backRef.current && taRef.current) {
      backRef.current.scrollTop = taRef.current.scrollTop;
      backRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  }

  return (
    <div className={`relative bg-slate-900 border border-slate-700 rounded ${tall ? 'flex-1 min-h-0' : ''} ${fill ? 'flex-1 min-h-32' : ''}`}>
      <div
        ref={backRef}
        aria-hidden
        className="absolute inset-0 p-2.5 font-mono text-sm whitespace-pre-wrap break-words overflow-hidden pointer-events-none text-slate-100"
        // Cùng rộng phần chữ với textarea (scrollbar ~8px) để 2 lớp không lệch dòng khi cuộn
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
          onChange(e.target.value);
          requestAnimationFrame(syncFromTa);
        }}
        onScroll={syncFromTa}
      />
    </div>
  );
}
