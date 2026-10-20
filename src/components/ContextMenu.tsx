import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

/** Menu chuột phải: render bằng createPortal ra document.body để không bao giờ bị overflow/backdrop-blur che mất. */
export default function ContextMenu({ x, y, items, onClose }: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const w = 240;
  const itemH = 33;
  const maxVisible = 12; // tối đa 12 item hiển thị trước khi scroll
  const h = Math.min(items.length * itemH + 8, maxVisible * itemH + 8);
  const left = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - h - 8));

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[9998]"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-[9999] bg-slate-900 dark:bg-[#0d1622] border border-teal-500/40 rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.8)] py-1 text-xs overflow-y-auto backdrop-blur-xl"
        style={{ left, top, width: w, maxHeight: h }}
      >
        {items.map((it, i) => (
          <button
            key={i}
            onClick={() => {
              onClose();
              it.onClick();
            }}
            className={`w-full text-left px-3.5 py-2 hover:bg-teal-950/70 hover:text-cyan-300 transition-colors whitespace-nowrap ${
              it.danger ? 'text-red-400 hover:text-red-300' : 'text-slate-200'
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}
