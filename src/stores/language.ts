import { create } from 'zustand';
import { translations, type Language, type TranslationSchema } from '../i18n/translations';

const LS_KEY = 'reqx_language';

interface LanguageState {
  lang: Language;
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: TranslationSchema;
}

const getInitialLang = (): Language => {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved === 'vi' || saved === 'en') return saved;
  } catch {
    // fallback
  }
  return 'vi';
};

export const useLanguageStore = create<LanguageState>((set) => {
  const initialLang = getInitialLang();
  return {
    lang: initialLang,
    language: initialLang,
    t: translations[initialLang],
    setLanguage: (lang: Language) => {
      try {
        localStorage.setItem(LS_KEY, lang);
      } catch {
        // ignore
      }
      set({ lang, language: lang, t: translations[lang] });
    },
    toggleLanguage: () => {
      set((state) => {
        const next: Language = state.lang === 'vi' ? 'en' : 'vi';
        try {
          localStorage.setItem(LS_KEY, next);
        } catch {
          // ignore
        }
        return { lang: next, language: next, t: translations[next] };
      });
    },
  };
});

/** Hook tiện ích để lấy trực tiếp từ điển t và hàm đổi ngôn ngữ */
export function useTranslation() {
  const { lang, language, t, setLanguage, toggleLanguage } = useLanguageStore();
  return { lang, language, t, setLanguage, toggleLanguage };
}
