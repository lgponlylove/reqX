import { useState } from 'react';
import ScriptCodeEditor from './ScriptCodeEditor';
import ScriptSnippetMenu, { insertSnippet } from './ScriptSnippetMenu';

export interface ScriptsValue {
  preRequest: string;
  tests: string;
}

/**
 * Hộp sửa script ở mức collection/folder (thay vì trong tab request như bình thường).
 * Lưu ngay khi bấm "Lưu" — đóng cửa sổ mà chưa lưu thì bỏ thay đổi.
 */
export default function ScriptEditorModal({
  title,
  subtitle,
  value,
  onSave,
  onClose,
}: {
  title: string;
  subtitle: string;
  value: ScriptsValue;
  onSave: (v: ScriptsValue) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'pre' | 'tests'>('pre');
  const [draft, setDraft] = useState<ScriptsValue>(value);

  const dirty = draft.preRequest !== value.preRequest || draft.tests !== value.tests;
  const code = tab === 'pre' ? draft.preRequest : draft.tests;

  const setCode = (v: string) => setDraft((d) => (tab === 'pre' ? { ...d, preRequest: v } : { ...d, tests: v }));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-slate-900 border border-slate-700 rounded-lg shadow-2xl">
        <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-slate-800">
          <div>
            <h3 className="font-bold">📜 {title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white px-2" title="Đóng (Esc)">✕</button>
        </div>

        <div className="flex gap-1 px-4 pt-3">
          {(['pre', 'tests'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-t text-sm ${
                tab === t ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/50'
              }`}
            >
              {t === 'pre' ? 'Pre-request' : 'Tests'}
              {(t === 'pre' ? draft.preRequest : draft.tests).trim() && (
                <span className="ml-1.5 text-emerald-400">●</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 mx-4 my-3 flex flex-col min-h-[320px]">
          <ScriptCodeEditor
            rows={14}
            minHeight="320px"
            value={code}
            placeholder={tab === 'pre' ? 'Script chạy TRƯỚC mỗi request trong phạm vi này…' : 'Script kiểm tra response SAU mỗi request trong phạm vi này…'}
            onChange={setCode}
            onSaveShortcut={() => onSave(draft)}
          />
        </div>

        <div className="flex items-center gap-2 px-4 pb-3">
          <ScriptSnippetMenu
            kind={tab}
            align="left"
            placement="above"
            onPick={(picked) => setCode(insertSnippet(code, picked))}
          />
          <button
            onClick={() => setCode('')}
            disabled={!code.trim()}
            className="text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-40"
          >
            Xóa script
          </button>
          <span className="flex-1 text-xs text-slate-600">
            Script này chạy cho MỌI request trong phạm vi, trước/sau script của chính request. Ctrl+S để lưu.
          </span>
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border border-slate-700 hover:bg-slate-800">
            Hủy
          </button>
          <button
            onClick={() => { onSave(draft); onClose(); }}
            disabled={!dirty}
            className="text-sm px-4 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 font-bold disabled:opacity-40"
          >
            Lưu
          </button>
        </div>
      </div>
    </div>
  );
}
