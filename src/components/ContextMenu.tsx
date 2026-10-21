import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

const ITEM_H = 33;
const MAX_VISIBLE = 12;

/** Menu chuột phải: portal ra document.body, cao tối đa bằng màn hình, cuộn được và có điều hướng ↑/↓/Enter. */
export default function ContextMenu({ x, y, items, onClose }: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  const w = 240;
  const h = Math.min(
    Math.max(items.length, 1) * ITEM_H + 8,
    MAX_VISIBLE * ITEM_H + 8,
    Math.max(120, window.innerHeight - 16),
  );
  const left = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - h - 8));

  const run = (i: number) => {
    const it = items[i];
    if (!it) return;
    onClose();
    it.onClick();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Enter') {
        if (active >= 0) {
          e.preventDefault();
          run(active);
        }
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = items.length;
        if (!n) return;
        setActive((i) => (e.key === 'ArrowDown' ? (i + 1 + n) % n : (i - 1 + n) % n));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, items, onClose]);

  useEffect(() => {
    if (active < 0) return;
    boxRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Đóng khi chạy nền bị cuộn, NHƯNG cuộn ngay trong menu thì phải giữ menu lại —
  // nếu không thì phần đuôi menu (Đổi tên/Xóa) không bao giờ với tới được.
  useEffect(() => {
    const onScroll = (e: Event) => {
      const box = boxRef.current;
      if (box && e.target instanceof Node && box.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [onClose]);

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
        ref={boxRef}
        className="fixed z-[9999] bg-slate-900/95 dark:bg-[#0d1622]/95 border border-teal-500/40 rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.8)] py-1 text-xs overflow-y-auto overscroll-contain backdrop-blur-xl"
        style={{ left, top, width: w, maxHeight: h }}
        onMouseLeave={() => setActive(-1)}
      >
        {items.map((it, i) => (
          <button
            key={i}
            data-idx={i}
            onClick={() => run(i)}
            onMouseEnter={() => setActive(i)}
            className={`w-full text-left px-3.5 py-2 transition-colors whitespace-nowrap ${
              active === i ? 'bg-teal-950' : 'hover:bg-teal-950/70'
            } ${it.danger ? 'text-red-400' : 'text-slate-200 hover:text-cyan-300'}`}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}
