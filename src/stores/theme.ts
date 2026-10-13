import { create } from 'zustand';

export type Theme = 'dark' | 'light';

const LS_KEY = 'reqx_theme';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const getInitialTheme = (): Theme => {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    // Tự động kiểm tra cài đặt giao diện của hệ điều hành
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
  } catch {
    // fallback
  }
  return 'dark';
};

export const applyThemeToDOM = (theme: Theme) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'light') {
    root.classList.remove('dark');
    root.classList.add('light');
    root.setAttribute('data-theme', 'light');
    root.style.colorScheme = 'light';
  } else {
    root.classList.remove('light');
    root.classList.add('dark');
    root.setAttribute('data-theme', 'dark');
    root.style.colorScheme = 'dark';
  }
};

// Khởi tạo theme trên DOM ngay khi file được import
if (typeof window !== 'undefined') {
  applyThemeToDOM(getInitialTheme());
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: typeof window !== 'undefined' ? getInitialTheme() : 'dark',
  setTheme: (theme: Theme) => {
    try {
      localStorage.setItem(LS_KEY, theme);
    } catch {
      // ignore
    }
    applyThemeToDOM(theme);
    set({ theme });
  },
  toggleTheme: () => {
    set((state) => {
      const next: Theme = state.theme === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(LS_KEY, next);
      } catch {
        // ignore
      }
      applyThemeToDOM(next);
      return { theme: next };
    });
  },
}));
