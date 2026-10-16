import { create } from 'zustand';

export interface LicenseInfo {
  email: string;
  machine_id?: string | null;
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
  machineId: string;
  isLoaded: boolean;
  isLoading: boolean;
  lastError: string | null;
  getMachineId: () => Promise<string>;
  checkLicense: () => Promise<LicenseVerificationResult>;
  activateLicense: (email: string, key: string) => Promise<LicenseVerificationResult>;
  deactivateLicense: () => Promise<void>;
}

function inTauriApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const WEB_STORAGE_KEY = 'reqx_offline_license_key';
const WEB_MACHINE_ID_KEY = 'reqx_machine_id';

export async function getLocalMachineId(): Promise<string> {
  if (inTauriApp()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const mid = await invoke<string>('get_machine_id');
      if (mid && mid.trim().length >= 8) {
        return mid.trim();
      }
    } catch (e) {
      console.warn('Không thể lấy native machine id từ Tauri:', e);
    }
  }

  // Web fallback: Đọc hoặc sinh UUID bền vững lưu trong localStorage
  if (typeof window !== 'undefined') {
    let saved = localStorage.getItem(WEB_MACHINE_ID_KEY);
    if (!saved) {
      const rand = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1).toUpperCase();
      saved = `REQX-${rand()}-${rand()}-${rand()}`;
      localStorage.setItem(WEB_MACHINE_ID_KEY, saved);
    }
    return saved;
  }
  return 'REQX-0000-0000-0000';
}

// Helper parse payload from key format: [PREFIX.]PAYLOAD.SIGNATURE
export function parsePayloadFallback(
  rawKey: string,
  currentMachineId?: string,
  expectedEmail?: string
): LicenseVerificationResult {
  try {
    const raw = rawKey.trim().replace(/^["']|["']$/g, '').trim();
    if (!raw) {
      return { valid: false, is_pro: false, info: null, error: 'Mã bản quyền không được để trống.' };
    }
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

    // Kiểm tra email nếu người dùng nhập vào
    if (expectedEmail) {
      if (info.email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) {
        return {
          valid: false,
          is_pro: false,
          info: null,
          error: `Email kích hoạt ('${expectedEmail.trim()}') không khớp với thông tin trong mã bản quyền ('${info.email}').`,
        };
      }
    }

    // Kiểm tra ràng buộc thiết bị (Machine ID) nếu có
    if (info.machine_id && info.machine_id !== '*' && currentMachineId) {
      if (info.machine_id.trim().toUpperCase() !== currentMachineId.trim().toUpperCase()) {
        return {
          valid: false,
          is_pro: false,
          info: null,
          error: `Mã bản quyền này được cấp cho thiết bị '${info.machine_id}', không hợp lệ trên thiết bị hiện tại ('${currentMachineId}').`,
        };
      }
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

export const useLicenseStore = create<LicenseState>((set, get) => ({
  isPro: false,
  info: null,
  machineId: 'REQX-0000-0000-0000',
  isLoaded: false,
  isLoading: false,
  lastError: null,

  getMachineId: async () => {
    const mid = await getLocalMachineId();
    set({ machineId: mid });
    return mid;
  },

  checkLicense: async () => {
    set({ isLoading: true, lastError: null });
    try {
      const mid = await getLocalMachineId();
      set({ machineId: mid });

      if (inTauriApp()) {
        const { invoke } = await import('@tauri-apps/api/core');
        const res = await invoke<LicenseVerificationResult>('check_license');
        set({
          isPro: Boolean(res.valid && res.is_pro),
          info: res.info,
          machineId: mid,
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
          set({ isPro: false, info: null, machineId: mid, isLoaded: true, isLoading: false, lastError: null });
          return res;
        }
        const res = parsePayloadFallback(savedKey, mid);
        set({
          isPro: Boolean(res.valid && res.is_pro),
          info: res.info,
          machineId: mid,
          isLoaded: true,
          isLoading: false,
          lastError: res.error || null,
        });
        return res;
      }

      const emptyRes: LicenseVerificationResult = { valid: false, is_pro: false, info: null, error: null };
      set({ isLoaded: true, isLoading: false, machineId: mid });
      return emptyRes;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const errRes: LicenseVerificationResult = { valid: false, is_pro: false, info: null, error: msg };
      set({ isPro: false, info: null, isLoaded: true, isLoading: false, lastError: msg });
      return errRes;
    }
  },

  activateLicense: async (email: string, key: string) => {
    set({ isLoading: true, lastError: null });
    try {
      const trimmedEmail = email.trim();
      const trimmedKey = key.trim();
      if (!trimmedEmail) {
        const res: LicenseVerificationResult = {
          valid: false,
          is_pro: false,
          info: null,
          error: 'Vui lòng nhập Email đã đăng ký bản quyền.',
        };
        set({ isLoading: false, lastError: res.error });
        return res;
      }
      if (!trimmedKey) {
        const res: LicenseVerificationResult = {
          valid: false,
          is_pro: false,
          info: null,
          error: 'Mã bản quyền không được để trống.',
        };
        set({ isLoading: false, lastError: res.error });
        return res;
      }

      const mid = await getLocalMachineId();
      set({ machineId: mid });

      if (inTauriApp()) {
        const { invoke } = await import('@tauri-apps/api/core');
        const res = await invoke<LicenseVerificationResult>('activate_license', {
          email: trimmedEmail,
          key: trimmedKey,
        });
        set({
          isPro: Boolean(res.valid && res.is_pro),
          info: res.info,
          machineId: mid,
          isLoading: false,
          lastError: res.error || null,
        });
        return res;
      }

      // Web/Dev Fallback
      const res = parsePayloadFallback(trimmedKey, mid, trimmedEmail);
      if (res.valid) {
        localStorage.setItem(WEB_STORAGE_KEY, trimmedKey);
      }
      set({
        isPro: Boolean(res.valid && res.is_pro),
        info: res.info,
        machineId: mid,
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

// Tự động kiểm tra bản quyền và tải mã máy khi app khởi động
if (typeof window !== 'undefined') {
  useLicenseStore.getState().checkLicense();
}
