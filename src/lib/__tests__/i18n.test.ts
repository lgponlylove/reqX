import { describe, it, expect, beforeEach } from 'vitest';
import { translations } from '../../i18n/translations';
import { useLanguageStore } from '../../stores/language';

// Mock localStorage for node test environment
const mockStorage: Record<string, string> = {};
globalThis.localStorage = {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, val: string) => { mockStorage[key] = val; },
  removeItem: (key: string) => { delete mockStorage[key]; },
  clear: () => { for (const k in mockStorage) delete mockStorage[k]; },
  length: 0,
  key: () => null,
};

describe('i18n Multi-language System', () => {
  beforeEach(() => {
    localStorage.clear();
    useLanguageStore.getState().setLanguage('vi');
  });

  it('contains consistent translation keys for vi and en', () => {
    expect(translations.vi).toBeDefined();
    expect(translations.en).toBeDefined();

    // Check main top-level namespaces
    const namespaces = Object.keys(translations.vi) as (keyof typeof translations.vi)[];
    expect(namespaces).toContain('common');
    expect(namespaces).toContain('nav');
    expect(namespaces).toContain('dock');
    expect(namespaces).toContain('header');
    expect(namespaces).toContain('sidebar');
    expect(namespaces).toContain('request');
    expect(namespaces).toContain('response');

    for (const ns of namespaces) {
      const viKeys = Object.keys(translations.vi[ns]);
      const enKeys = Object.keys(translations.en[ns]);
      expect(enKeys).toEqual(expect.arrayContaining(viKeys));
      expect(viKeys).toEqual(expect.arrayContaining(enKeys));
    }
  });

  it('switches language and persists to localStorage', () => {
    const store = useLanguageStore.getState();
    expect(store.lang).toBe('vi');
    expect(store.t.common.save).toBe('Lưu');

    // Switch to English
    store.setLanguage('en');
    const updatedStore = useLanguageStore.getState();
    expect(updatedStore.lang).toBe('en');
    expect(updatedStore.t.common.save).toBe('Save');
    expect(localStorage.getItem('reqx_language')).toBe('en');

    // Toggle back to Vietnamese
    updatedStore.toggleLanguage();
    const finalStore = useLanguageStore.getState();
    expect(finalStore.lang).toBe('vi');
    expect(finalStore.t.common.save).toBe('Lưu');
    expect(localStorage.getItem('reqx_language')).toBe('vi');
  });
});
