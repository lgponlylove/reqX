import { useThemeStore } from '../stores/theme';
import { useTranslation } from '../stores/language';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useThemeStore();
  const { t } = useTranslation();

  const isDark = theme === 'dark';
  const label = isDark ? t.header.themeLight : t.header.themeDark;

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      className="p-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700/80 hover:border-teal-500/50 text-slate-300 transition-all shadow-sm flex items-center justify-center group shrink-0"
    >
      {isDark ? (
        // Icon Mặt trời (vàng cam ấm) hiển thị khi đang Dark Mode -> click chuyển sang Light Mode
        <svg
          viewBox="0 0 24 24"
          className="w-4 h-4 text-amber-400 group-hover:rotate-45 group-hover:scale-110 transition-transform duration-300 fill-none stroke-current"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        // Icon Mặt trăng (xanh tím) hiển thị khi đang Light Mode -> click chuyển sang Dark Mode
        <svg
          viewBox="0 0 24 24"
          className="w-4 h-4 text-indigo-600 group-hover:-rotate-12 group-hover:scale-110 transition-transform duration-300 fill-none stroke-current"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
        </svg>
      )}
    </button>
  );
}
