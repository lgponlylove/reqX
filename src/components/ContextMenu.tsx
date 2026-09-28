import { useEffect } from 'react';

export interface MenuItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

/** Menu chuột phải: hiện tại vị trí click, tự nép vào viewport, đóng khi click ra ngoài / Esc / scroll. */
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

  const w = 230;
  const h = items.length * 33 + 8;
  const left = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - h - 8));

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-50 bg-slate-800 border border-slate-600 rounded-md shadow-xl py-1 text-sm"
        style={{ left, top, width: w }}
      >
        {items.map((it, i) => (
          <button
            key={i}
            onClick={() => {
              onClose();
              it.onClick();
            }}
            className={`w-full text-left px-3 py-1.5 hover:bg-slate-700 ${it.danger ? 'text-red-300' : 'text-slate-200'}`}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}
