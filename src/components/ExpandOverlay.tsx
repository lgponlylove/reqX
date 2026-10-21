import { useEffect, type ReactNode } from 'react';
import { useTranslation } from '../stores/language';

/**
 * Khung phóng to cho những ô nội dung bị giới hạn chiều cao (script, body, response).
 * Không giữ bản copy: con gọi truyền thẳng editor vào đúng state gốc, nên đóng popup
 * bằng cách nào thì nội dung vẫn đúng — "trở về chỗ cũ" chỉ là bỏ lớp phủ.
 */
export default function ExpandOverlay({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t: i18n } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // defaultPrevented = phím đã bị editor ăn mất (Esc đóng menu gợi ý code), không tính là đóng popup
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[min(1200px,94vw)] h-[88vh] flex flex-col bg-slate-900 border border-slate-700 rounded-lg shadow-2xl">
        <div className="flex items-center gap-4 px-4 py-2.5 border-b border-slate-800 shrink-0">
          <h3 className="font-bold text-sm truncate">{title}</h3>
          <span className="flex-1 text-right text-[11px] text-slate-500">{i18n.request.expandHint}</span>
          <button onClick={onClose} title="Esc" className="text-slate-400 hover:text-white px-1.5">✕</button>
        </div>
        <div className="flex-1 min-h-0 p-3 flex flex-col">{children}</div>
      </div>
    </div>
  );
}
