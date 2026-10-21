import { useState, useEffect } from 'react';
import { useRequestStore } from '../stores/request';
import { useAppStore } from '../stores/app';
import { generateAiTests } from '../lib/ai/ai-test-generator';
import ScriptCodeEditor from './ScriptCodeEditor';

interface Props {
  onClose: () => void;
}

export default function AiTestModal({ onClose }: Props) {
  const { current, set } = useRequestStore();
  const { response } = useAppStore();

  const [loading, setLoading] = useState(true);
  const [generatedCode, setGeneratedCode] = useState('');
  const [note, setNote] = useState('');
  const [isAi, setIsAi] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!response) {
      setLoading(false);
      return;
    }

    let isMounted = true;
    generateAiTests(current, response)
      .then((res) => {
        if (isMounted) {
          setGeneratedCode(res.tests);
          setIsAi(res.isAiGenerated);
          setNote(res.note || '');
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [current, response]);

  function handleAppend() {
    const existing = (current.tests || '').trim();
    const updated = existing ? `${existing}\n\n${generatedCode}` : generatedCode;
    set({ tests: updated });
    onClose();
  }

  function handleReplace() {
    set({ tests: generatedCode });
    onClose();
  }

  function handleCopy() {
    navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-750 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[88vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-950/80 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">✨</span>
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                Sinh Test Script tự động từ Response
                {isAi ? (
                  <span className="text-[10px] bg-fuchsia-950/80 text-fuchsia-300 border border-fuchsia-500/40 px-2 py-0.5 rounded font-mono">
                    🤖 AI Powered
                  </span>
                ) : (
                  <span className="text-[10px] bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded font-mono">
                    ⚡ Heuristic Engine
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {current.name} • {current.method} {current.url}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 text-sm rounded hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center flex-1 py-16 text-slate-400 gap-3">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs font-semibold animate-pulse">
                Đang phân tích cấu trúc Response và sinh các kịch bản kiểm thử assertions...
              </p>
            </div>
          ) : !response ? (
            <div className="p-8 text-center text-xs text-amber-400">
              Chưa có dữ liệu Response. Hãy bấm <b>Send</b> gửi request trước khi sinh test!
            </div>
          ) : (
            <>
              {note && (
                <div className="px-3 py-1.5 rounded bg-slate-950/60 border border-slate-800 text-[11px] text-slate-300 flex items-center justify-between">
                  <span>ℹ️ {note}</span>
                  <span className="text-slate-500 font-mono">
                    Status: {response.status} • {response.timeMs}ms
                  </span>
                </div>
              )}

              <div className="flex-1 min-h-[240px] flex flex-col border border-slate-800 rounded-lg overflow-hidden bg-slate-950">
                <ScriptCodeEditor
                  tall
                  value={generatedCode}
                  onChange={(v) => setGeneratedCode(v)}
                  placeholder="// Mã kiểm thử được sinh ra ở đây..."
                />
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-950/80 border-t border-slate-800 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            disabled={loading || !generatedCode}
            className="px-3 py-1.5 rounded text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors disabled:opacity-50"
          >
            {copied ? '✓ Đã sao chép' : '📋 Sao chép mã'}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleAppend}
              disabled={loading || !generatedCode}
              className="px-3 py-1.5 rounded text-xs bg-emerald-700 hover:bg-emerald-600 text-white font-semibold shadow-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              <span>➕</span>
              <span>Thêm vào cuối tab Tests</span>
            </button>
            <button
              type="button"
              onClick={handleReplace}
              disabled={loading || !generatedCode}
              className="px-3 py-1.5 rounded text-xs bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold shadow-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              <span>🔄</span>
              <span>Ghi đè tab Tests</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
