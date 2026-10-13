import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLanguageStore } from '../stores/language';
import type { Language } from '../i18n/translations';

const LANGUAGES: { id: Language; label: string; flag: string }[] = [
  { id: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { id: 'en', label: 'English', flag: '🇬🇧' },
];

export default function LanguageSwitcher() {
  const { lang, setLanguage } = useLanguageStore();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });

  const updatePos = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    }
  };

  const handleToggle = () => {
    if (!open) {
      updatePos();
    }
    setOpen((prev) => !prev);
  };

  useEffect(() => {
    if (!open) return;
    const handleScrollOrResize = () => updatePos();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const current = LANGUAGES.find((l) => l.id === lang) ?? LANGUAGES[0];

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        title="Chuyển đổi ngôn ngữ / Change language"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700/80 hover:border-teal-500/50 text-xs font-semibold text-slate-300 hover:text-cyan-300 transition-all shadow-sm"
      >
        <span className="text-sm leading-none">{current.flag}</span>
        <span className="tracking-wider uppercase font-mono text-[11px] font-bold text-cyan-300">{current.id}</span>
        <span className="text-[9px] text-slate-500">▼</span>
      </button>

      {open &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[9998]"
              onClick={() => setOpen(false)}
            />
            <div
              style={{ top: pos.top, right: pos.right }}
              className="fixed z-[9999] w-36 bg-slate-900 dark:bg-[#0c1622] border border-teal-500/50 rounded-xl p-1 shadow-[0_4px_25px_rgba(0,0,0,0.85)] backdrop-blur-xl"
            >
              {LANGUAGES.map((item) => {
                const isActive = item.id === lang;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setLanguage(item.id);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-teal-950/80 text-cyan-300 font-semibold border border-teal-500/40 shadow-sm'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{item.flag}</span>
                      <span>{item.label}</span>
                    </div>
                    {isActive && <span className="text-emerald-400 text-xs font-bold">✓</span>}
                  </button>
                );
              })}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
