import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Suggestion {
  label: string;
  insert: string;
  detail: string;
  kind: 'function' | 'property' | 'snippet';
}

const POSTMAN_SUGGESTIONS: Suggestion[] = [
  // pm.test
  {
    label: 'pm.test(...)',
    insert: 'pm.test("Status is 200", () => {\n  pm.expect(pm.response.status).to.equal(200);\n});',
    detail: 'Định nghĩa 1 test case kiểm tra kết quả',
    kind: 'snippet',
  },
  {
    label: 'pm.expect(...)',
    insert: 'pm.expect(val).to.',
    detail: 'Khẳng định giá trị (Chai Assertion)',
    kind: 'function',
  },
  // pm.response
  {
    label: 'pm.response.json()',
    insert: 'pm.response.json()',
    detail: 'Parse body response sang JSON object',
    kind: 'function',
  },
  {
    label: 'pm.response.status',
    insert: 'pm.response.status',
    detail: 'Mã HTTP status (vd: 200, 404)',
    kind: 'property',
  },
  {
    label: 'pm.response.text()',
    insert: 'pm.response.text()',
    detail: 'Lấy toàn bộ nội dung body dạng chuỗi thô',
    kind: 'function',
  },
  {
    label: 'pm.response.headers.get(...)',
    insert: 'pm.response.headers.get("content-type")',
    detail: 'Đọc giá trị của 1 header từ response',
    kind: 'function',
  },
  // pm.environment
  {
    label: 'pm.environment.get(...)',
    insert: 'pm.environment.get("key")',
    detail: 'Đọc biến môi trường',
    kind: 'function',
  },
  {
    label: 'pm.environment.set(...)',
    insert: 'pm.environment.set("key", value)',
    detail: 'Ghi biến môi trường',
    kind: 'function',
  },
  // pm.globals
  {
    label: 'pm.globals.get(...)',
    insert: 'pm.globals.get("key")',
    detail: 'Đọc biến toàn cục (globals)',
    kind: 'function',
  },
  {
    label: 'pm.globals.set(...)',
    insert: 'pm.globals.set("key", value)',
    detail: 'Ghi biến toàn cục (globals)',
    kind: 'function',
  },
  // pm.variables
  {
    label: 'pm.variables.get(...)',
    insert: 'pm.variables.get("key")',
    detail: 'Đọc biến (ưu tiên env rồi tới global)',
    kind: 'function',
  },
  // pm.sendRequest
  {
    label: 'pm.sendRequest(...)',
    insert: 'const res = await pm.sendRequest("https://api/endpoint");',
    detail: 'Gửi HTTP request phụ từ bên trong script',
    kind: 'snippet',
  },
  // pm.iterationData
  {
    label: 'pm.iterationData.get(...)',
    insert: 'pm.iterationData.get("key")',
    detail: 'Lấy dữ liệu dòng CSV/JSON trong Runner',
    kind: 'function',
  },
  // Common expect chains
  {
    label: '.to.equal(...)',
    insert: '.to.equal()',
    detail: 'So sánh bằng tuyệt đối',
    kind: 'function',
  },
  {
    label: '.to.eql(...)',
    insert: '.to.eql()',
    detail: 'So sánh bằng deep-equal đối tượng',
    kind: 'function',
  },
  {
    label: '.to.include(...)',
    insert: '.to.include()',
    detail: 'Kiểm tra chuỗi hoặc mảng có chứa phần tử',
    kind: 'function',
  },
  {
    label: '.to.be.true',
    insert: '.to.be.true;',
    detail: 'Khẳng định giá trị là true',
    kind: 'property',
  },
  {
    label: '.to.be.above(...)',
    insert: '.to.be.above(0)',
    detail: 'Khẳng định số lớn hơn',
    kind: 'function',
  },
  {
    label: '.to.be.below(...)',
    insert: '.to.be.below(100)',
    detail: 'Khẳng định số nhỏ hơn',
    kind: 'function',
  },
  {
    label: 'pm.response.to.have.jsonSchema(schema)',
    insert: 'pm.response.to.have.jsonSchema({\n  type: "object",\n  required: ["id"],\n  properties: {\n    id: { type: "number" }\n  }\n});',
    detail: 'Kiểm tra cấu trúc response khớp với JSON Schema',
    kind: 'snippet',
  },
  {
    label: '.to.have.jsonSchema(schema)',
    insert: '.to.have.jsonSchema(schema)',
    detail: 'Kiểm tra đối tượng thỏa mãn JSON Schema',
    kind: 'function',
  },
  {
    label: '.to.matchSchema(schema)',
    insert: '.to.matchSchema(schema)',
    detail: 'Kiểm tra đối tượng khớp với JSON Schema',
    kind: 'function',
  },
  // Request mutations (pre-request)
  {
    label: 'request.headers[...] = ...',
    insert: 'request.headers["Authorization"] = "Bearer " + token;',
    detail: 'Sửa đổi Header của request trước khi gửi',
    kind: 'snippet',
  },
  {
    label: 'request.url = ...',
    insert: 'request.url = "https://...";',
    detail: 'Đổi URL đích của request trước khi gửi',
    kind: 'snippet',
  },
];

/** Regex tô màu syntax JS/TS cơ bản */
const JS_TOKEN_RE =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b(?:const|let|var|function|return|if|else|for|while|await|async|try|catch|throw|new|typeof|instanceof)\b)|(\b(?:true|false|null|undefined)\b)|(\b(?:pm|console|request|response|JSON|Date|Math|Object|Array)\b)|(\b\d+(?:\.\d+)?\b)|([{}()\[\].,;])/g;

function highlightJs(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  JS_TOKEN_RE.lastIndex = 0;

  while ((m = JS_TOKEN_RE.exec(code)) !== null) {
    if (m.index > last) out.push(<span key={k++}>{code.slice(last, m.index)}</span>);
    const [tok, comment, str, kw, lit, builtin, num] = m;
    if (comment) {
      out.push(<span key={k++} className="text-slate-500 italic">{comment}</span>);
    } else if (str) {
      out.push(<span key={k++} className="text-amber-200">{str}</span>);
    } else if (kw) {
      out.push(<span key={k++} className="text-violet-400 font-semibold">{kw}</span>);
    } else if (lit) {
      out.push(<span key={k++} className="text-rose-300 font-semibold">{lit}</span>);
    } else if (builtin) {
      out.push(<span key={k++} className="text-emerald-400 font-semibold">{builtin}</span>);
    } else if (num) {
      out.push(<span key={k++} className="text-sky-300">{num}</span>);
    } else {
      out.push(<span key={k++} className="text-slate-400">{tok}</span>);
    }
    last = m.index + tok.length;
  }
  if (last < code.length) out.push(<span key={k++}>{code.slice(last)}</span>);
  return out;
}

export default function ScriptCodeEditor({
  value,
  onChange,
  placeholder,
  rows = 8,
  minHeight = '180px',
  onSaveShortcut,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  minHeight?: string;
  onSaveShortcut?: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selIdx, setSelIdx] = useState(0);

  const syncScroll = () => {
    if (backRef.current && taRef.current) {
      backRef.current.scrollTop = taRef.current.scrollTop;
      backRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  // Lọc gợi ý theo từ khóa hiện tại
  const filtered = POSTMAN_SUGGESTIONS.filter((s) =>
    s.label.toLowerCase().includes(query.toLowerCase()) ||
    s.detail.toLowerCase().includes(query.toLowerCase())
  );

  function insertSuggestion(s: Suggestion) {
    if (!taRef.current) return;
    const el = taRef.current;
    const start = el.selectionStart;
    const end = el.selectionEnd;

    // Tìm từ khóa đang gõ dở trước con trỏ
    const before = value.slice(0, start);
    const lastWordMatch = before.match(/[\w.]+$/);
    const replaceFrom = lastWordMatch ? start - lastWordMatch[0].length : start;

    const nextVal = value.slice(0, replaceFrom) + s.insert + value.slice(end);
    onChange(nextVal);
    setMenuOpen(false);

    requestAnimationFrame(() => {
      const newPos = replaceFrom + s.insert.length;
      el.selectionStart = newPos;
      el.selectionEnd = newPos;
      el.focus();
      syncScroll();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSaveShortcut?.();
      return;
    }

    if (menuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelIdx((i) => (i + 1) % Math.max(1, filtered.length));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelIdx((i) => (i - 1 + filtered.length) % Math.max(1, filtered.length));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered[selIdx]) {
          e.preventDefault();
          insertSuggestion(filtered[selIdx]);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuOpen(false);
        return;
      }
    }

    // Nhấn Tab để thụt dòng 2 spaces
    if (e.key === 'Tab' && !menuOpen) {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const nextVal = value.slice(0, start) + '  ' + value.slice(end);
      onChange(nextVal);
      requestAnimationFrame(() => {
        el.selectionStart = start + 2;
        el.selectionEnd = start + 2;
        syncScroll();
      });
      return;
    }

    // Ctrl+Space: Bật popup gợi ý thủ công
    if (e.key === ' ' && e.ctrlKey) {
      e.preventDefault();
      setQuery('');
      setSelIdx(0);
      setMenuOpen(true);
      return;
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    onChange(next);
    requestAnimationFrame(syncScroll);

    const pos = e.target.selectionStart;
    const textBefore = next.slice(0, pos);
    const wordMatch = textBefore.match(/(?:pm\.|pm|expect|\.to\.|request\.)[\w.]*$/);

    if (wordMatch) {
      setQuery(wordMatch[0]);
      setSelIdx(0);
      setMenuOpen(true);
    } else if (menuOpen && !textBefore.endsWith('.')) {
      setMenuOpen(false);
    }
  }

  return (
    <div className="relative flex flex-col bg-slate-950 border border-slate-700 focus-within:border-emerald-600 rounded">
      {/* Vùng editor riêng để lớp highlight ôm khít textarea — inset-0 của container ngoài
          sẽ tràn xuống cả footer phụ trợ và chữ lọt ra sau footer. */}
      <div className="relative">
        {/* Background Syntax Highlight */}
        <div
          ref={backRef}
          aria-hidden
          className="absolute inset-0 p-2.5 font-mono text-xs whitespace-pre-wrap break-words overflow-hidden pointer-events-none text-slate-200"
          // Lớp highlight phải rộng đúng bằng phần chữ của textarea: textarea có scrollbar
          // chiếm ~8px, nếu không chừa gutter giống nhau thì 2 lớp xuống dòng lệch nhau
          // và chữ nhân đôi khi cuộn.
          style={{ minHeight, scrollbarGutter: 'stable' }}
        >
          {value ? highlightJs(value) : <span className="text-slate-600 italic">{placeholder}</span>}
        </div>

        {/* Interactive Textarea */}
        <textarea
          ref={taRef}
          rows={rows}
          spellCheck={false}
          style={{ minHeight, scrollbarGutter: 'stable' }}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onScroll={syncScroll}
          onBlur={() => setTimeout(() => setMenuOpen(false), 200)}
          placeholder=""
          className="relative block w-full p-2.5 font-mono text-xs bg-transparent outline-none text-transparent caret-emerald-400 selection:bg-emerald-900/60 whitespace-pre-wrap break-words resize-y"
        />
      </div>

      {/* Autocomplete Popup */}
      {menuOpen && filtered.length > 0 && (
        <div className="absolute left-4 bottom-2 z-50 w-80 max-h-56 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-y-auto divide-y divide-slate-800 text-xs font-mono">
          <div className="px-2 py-1 text-[10px] text-slate-500 font-sans font-bold bg-slate-950 flex justify-between">
            <span>GỢI Ý POSTMAN SCRIPT (Tab / Enter để chèn)</span>
            <span>Esc để đóng</span>
          </div>
          {filtered.slice(0, 10).map((s, idx) => (
            <div
              key={s.label}
              onMouseDown={(e) => {
                e.preventDefault();
                insertSuggestion(s);
              }}
              className={`px-2.5 py-1.5 cursor-pointer flex items-center justify-between gap-2 ${
                idx === selIdx ? 'bg-emerald-700/80 text-white' : 'hover:bg-slate-800 text-slate-300'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[10px] opacity-75 font-bold text-amber-300">
                  {s.kind === 'function' ? 'ƒ' : s.kind === 'snippet' ? '⧉' : '•'}
                </span>
                <span className="font-semibold truncate">{s.label}</span>
              </div>
              <span className="text-[10px] opacity-60 font-sans truncate">{s.detail}</span>
            </div>
          ))}
        </div>
      )}

      {/* Mini Helper Footer */}
      <div className="flex items-center justify-between px-2 py-1 bg-slate-900/80 border-t border-slate-800 text-[10px] text-slate-500 font-mono">
        <span>Gõ <code className="text-emerald-400">pm.</code> hoặc bấm <kbd className="bg-slate-800 px-1 rounded text-slate-300">Ctrl+Space</kbd> để gợi ý code</span>
        <span>Tab = 2 spaces</span>
      </div>
    </div>
  );
}
