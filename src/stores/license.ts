import { create } from 'zustand';

export interface LicenseInfo {
  email: string;
  tier: string;
  issued_at: number;
  expires_at: number | null;
}

export interface LicenseVerificationResult {
  valid: boolean;
  is_pro: boolean;
  info: LicenseInfo | null;
  error: string | null;
}

interface LicenseState {
  isPro: boolean;
  info: LicenseInfo | null;
  isLoaded: boolean;
  isLoading: boolean;
  lastError: string | null;
  checkLicense: () => Promise<LicenseVerificationResult>;
  activateLicense: (key: string) => Promise<LicenseVerificationResult>;
  deactivateLicense: () => Promise<void>;
}

function inTauriApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const WEB_STORAGE_KEY = 'reqx_offline_license_key';

// Helper parse payload from key format: [PREFIX.]PAYLOAD.SIGNATURE
function parsePayloadFallback(rawKey: string): LicenseVerificationResult {
  try {
    const raw = rawKey.trim().replace(/^["']|["']$/g, '').trim();
    const stripped = raw
      .replace(/^REQX1\./, '')
      .replace(/^REQX-PRO\./, '')
      .replace(/^REQX1-/, '')
      .replace(/^REQX-PRO-/, '');
    const parts = stripped.split('.');
    if (parts.length !== 2) {
      return { valid: false, is_pro: false, info: null, error: 'Định dạng mã bản quyền không hợp lệ (cần PAYLOAD.SIG)' };
    }
    const jsonStr = atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'));
    const info: LicenseInfo = JSON.parse(jsonStr);
    if (!info.email || !info.tier) {
      return { valid: false, is_pro: false, info: null, error: 'Nội dung bản quyền không hợp lệ.' };
    }
    if (info.expires_at && Date.now() > info.expires_at) {
      return { valid: false, is_pro: false, info: null, error: 'Bản quyền đã hết hạn.' };
    }
    return { valid: true, is_pro: true, info, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, is_pro: false, info: null, error: `Lỗi đọc bản quyền: ${msg}` };
  }
}

export const useLicenseStore = create<LicenseState>((set) => ({
  isPro: false,
  info: null,
  isLoaded: false,
  isLoading: false,
  lastError: null,

  checkLicense: async () => {
    set({ isLoading: true, lastError: null });
    try {
      if (inTauriApp()) {
        const { invoke } = await import('@tauri-apps/api/core');
        const res = await invoke<LicenseVerificationResult>('check_license');
        set({
          isPro: Boolean(res.valid && res.is_pro),
          info: res.info,
          isLoaded: true,
          isLoading: false,
          lastError: res.error || null,
        });
        return res;
      }

      // Web/Dev Fallback
      if (typeof window !== 'undefined') {
        const savedKey = localStorage.getItem(WEB_STORAGE_KEY);
        if (!savedKey) {
          const res: LicenseVerificationResult = { valid: false, is_pro: false, info: null, error: null };
          set({ isPro: false, info: null, isLoaded: true, isLoading: false, lastError: null });
          return res;
        }
        const res = parsePayloadFallback(savedKey);
        set({
          isPro: Boolean(res.valid && res.is_pro),
          info: res.info,
          isLoaded: true,
          isLoading: false,
          lastError: res.error || null,
        });
        return res;
      }

      const emptyRes: LicenseVerificationResult = { valid: false, is_pro: false, info: null, error: null };
      set({ isLoaded: true, isLoading: false });
      return emptyRes;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const errRes: LicenseVerificationResult = { valid: false, is_pro: false, info: null, error: msg };
      set({ isPro: false, info: null, isLoaded: true, isLoading: false, lastError: msg });
      return errRes;
    }
  },

  activateLicense: async (key: string) => {
    set({ isLoading: true, lastError: null });
    try {
      const trimmed = key.trim();
      if (!trimmed) {
        const res: LicenseVerificationResult = {
          valid: false,
          is_pro: false,
          info: null,
          error: 'Mã bản quyền không được để trống.',
        };
        set({ isLoading: false, lastError: res.error });
        return res;
      }

      if (inTauriApp()) {
        const { invoke } = await import('@tauri-apps/api/core');
        const res = await invoke<LicenseVerificationResult>('activate_license', { key: trimmed });
        set({
          isPro: Boolean(res.valid && res.is_pro),
          info: res.info,
          isLoading: false,
          lastError: res.error || null,
        });
        return res;
      }

      // Web/Dev Fallback
      const res = parsePayloadFallback(trimmed);
      if (res.valid) {
        localStorage.setItem(WEB_STORAGE_KEY, trimmed);
      }
      set({
        isPro: Boolean(res.valid && res.is_pro),
        info: res.info,
        isLoading: false,
        lastError: res.error || null,
      });
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const errRes: LicenseVerificationResult = { valid: false, is_pro: false, info: null, error: msg };
      set({ isLoading: false, lastError: msg });
      return errRes;
    }
  },

  deactivateLicense: async () => {
    set({ isLoading: true, lastError: null });
    try {
      if (inTauriApp()) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('deactivate_license');
      } else if (typeof window !== 'undefined') {
        localStorage.removeItem(WEB_STORAGE_KEY);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ lastError: msg });
    } finally {
      set({ isPro: false, info: null, isLoading: false });
    }
  },
}));

// Tự động kiểm tra bản quyền khi app khởi động
if (typeof window !== 'undefined') {
  useLicenseStore.getState().checkLicense();
}
