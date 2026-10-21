import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../stores/language';
import { PRE_REQUEST_SAMPLE, TESTS_SAMPLE } from '../lib/scripts';
import { snippetsFor, type ScriptSnippet, type SnippetKind } from '../lib/script-snippets';

/** Chèn code mẫu vào ô script: rỗng thì thay, đã có code thì nối thêm (không phá script đang viết). */
export function insertSnippet(current: string, code: string): string {
  const base = current ?? '';
  if (!base.trim()) return code;
  return base.replace(/\s+$/, '') + '\n\n' + code;
}

/**
 * Menu "Chèn mẫu ▾" — danh sách snippet pre-request/tests **đã chạy thật qua sandbox**
 * (test: src/lib/__tests__/script-snippets.test.ts). QA/BA không cần nhớ cú pháp `pm`.
 */
export default function ScriptSnippetMenu({
  kind,
  onPick,
  align = 'right',
  placement = 'below',
  className = '',
}: {
  kind: SnippetKind;
  onPick: (code: string, snippet?: ScriptSnippet) => void;
  align?: 'left' | 'right';
  /** 'above' dùng cho nút nằm cuối hộp thoại (kẻo danh sách tràn xuống ngoài màn hình). */
  placement?: 'above' | 'below';
  /** Vị trí trong hàng nút (vd "ml-auto" để đẩy sang phải). */
  className?: string;
}) {
  const { lang } = useTranslation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const L = (v: { vi: string; en: string }) => (lang === 'en' ? v.en : v.vi);
  const items = snippetsFor(kind);

  return (
    <div ref={box} className={`relative shrink-0 ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={lang === 'en' ? 'Insert a tested script snippet' : 'Chèn một mẫu script đã chạy thật'}
        className="text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-1"
      >
        ⧉ {lang === 'en' ? 'Insert sample' : 'Chèn mẫu'} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div
          className={`absolute z-40 ${placement === 'above' ? 'bottom-full mb-1' : 'mt-1'} w-[420px] max-w-[80vw] max-h-[60vh] overflow-auto bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-1.5 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <p className="text-[11px] text-slate-500 px-2 py-1">
            {lang === 'en'
              ? 'Every snippet below really ran in the ReqX sandbox (vitest). Only edit the "// SỬA" spots.'
              : 'Mỗi mẫu dưới đây đã chạy thật trong sandbox ReqX (có vitest chứng minh) — chỉ sửa chỗ đánh "// SỬA".'}
          </p>
          <button
            onClick={() => { onPick(kind === 'pre' ? PRE_REQUEST_SAMPLE : TESTS_SAMPLE); setOpen(false); }}
            className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-800 text-sm text-slate-300"
          >
            📝 {lang === 'en' ? 'Basic sample (comments only)' : 'Mẫu cơ bản (chỉ có comment)'}
          </button>
          <div className="border-t border-slate-800 my-1" />
          {items.map((s) => (
            <button
              key={s.id}
              onClick={() => { onPick(s.code, s); setOpen(false); }}
              title={L(s.hint)}
              className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-800"
            >
              <div className="text-sm text-slate-200">{L(s.label)}</div>
              <div className="text-[11px] text-slate-500">{L(s.hint)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
