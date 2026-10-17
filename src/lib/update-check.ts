/**
 * Kiểm tra phiên bản mới & Tự động cập nhật (Tauri v2 Native Updater).
 * - Trong desktop (Tauri): tự động kết nối GitHub Release (qua tauri-plugin-updater),
 *   tự tải và cài đặt cập nhật chỉ với 1 click.
 * - Trong web/fallback: đọc feed latest.json và hiện link tải thủ công.
 * Lỗi mạng/offline thì im lặng bỏ qua — app offline-first.
 */

import { isTauri } from './http-client';

/** Đổi theo package.json mỗi lần release. */
export const APP_VERSION = '0.2.2';

export const UPDATE_FEED_URLS = [
  'https://raw.githubusercontent.com/lgponlylove/reqX-releases/main/latest.json',
  'https://raw.githubusercontent.com/lgponlylove/reqX/main/latest.json',
];
export const UPDATE_FEED_URL = UPDATE_FEED_URLS[0];

const LS_CHECK = 'reqx_update_check';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 ngày check 1 lần

export interface UpdateInfo {
  latest: string;
  url: string;
  notes: string;
  /** Link trực tiếp tới file cài đúng OS của máy này (nếu dò được). */
  downloadUrl?: string;
  /** Cho biết có thể tự động tải và cài đặt bằng Tauri Native Updater không */
  isNative?: boolean;
}

interface FeedAssets {
  win_nsis?: string;
  win_msi?: string;
  mac_arm?: string;
  mac_intel?: string;
  linux_appimage?: string;
  linux_deb?: string;
}

export type OsKind = 'win' | 'mac-arm' | 'mac-intel' | 'linux' | 'unknown';

/** Dò OS từ userAgent (chạy được cả web lẫn Tauri WebView). arch: 'arm'|'x86' nếu lấy được từ userAgentData. */
export function detectOs(ua: string, arch = ''): OsKind {
  const s = ua.toLowerCase();
  const a = arch.toLowerCase();
  if (s.includes('windows')) return 'win';
  if (s.includes('macintosh') || s.includes('mac os')) {
    if (a.includes('arm')) return 'mac-arm';
    return 'mac-intel'; // UA mac không phân biệt chip → mặc định Intel, user chip M tự đổi file trên trang release
  }
  if (s.includes('linux') || s.includes('x11')) return 'linux';
  return 'unknown';
}

/** Chọn file asset đúng OS. Windows ưu tiên NSIS .exe (cài không cần admin). */
export function pickAsset(os: OsKind, assets: FeedAssets): string | null {
  switch (os) {
    case 'win': return assets.win_nsis || assets.win_msi || null;
    case 'mac-arm': return assets.mac_arm || assets.mac_intel || null;
    case 'mac-intel': return assets.mac_intel || assets.mac_arm || null;
    case 'linux': return assets.linux_appimage || assets.linux_deb || null;
    default: return null;
  }
}

function currentOs(): OsKind {
  if (typeof navigator === 'undefined') return 'unknown';
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string; architecture?: string };
  };
  const ua = nav.userAgentData?.platform
    ? `${nav.userAgentData.platform}`
    : navigator.userAgent;
  // userAgentData.platform chỉ cho "Windows"/"macOS" chung chung → ghép architecture khi có
  const arch = nav.userAgentData?.architecture ?? '';
  if (nav.userAgentData?.platform) {
    const p = nav.userAgentData.platform.toLowerCase();
    if (p.includes('win')) return 'win';
    if (p.includes('mac')) return arch.toLowerCase().includes('arm') ? 'mac-arm' : 'mac-intel';
    if (p.includes('linux')) return 'linux';
    return detectOs(navigator.userAgent, arch);
  }
  return detectOs(ua, arch);
}

interface CacheEntry extends UpdateInfo {
  at: number;
  dismissed: string; // version user đã bấm "để sau"
}

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(LS_CHECK);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

function writeCache(e: CacheEntry): void {
  try {
    localStorage.setItem(LS_CHECK, JSON.stringify(e));
  } catch { /* ignore */ }
}

/** So sánh semver đơn giản: 0.2.0 > 0.1.2 */
export function isNewer(latest: string, current: string): boolean {
  const pa = latest.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = current.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const a = pa[i] ?? 0;
    const b = pb[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

// Lưu instance update của Tauri để tải và khởi động lại
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedTauriUpdate: any = null;

/** Kiểm tra cập nhật trực tiếp qua Tauri Updater */
export async function checkNativeUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri()) return null;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (update) {
      cachedTauriUpdate = update;
      const tag = `v${update.version}`;
      return {
        latest: update.version,
        url: `https://github.com/lgponlylove/reqX-releases/releases/tag/${tag}`,
        notes: update.body || '',
        downloadUrl: `https://github.com/lgponlylove/reqX-releases/releases/tag/${tag}`,
        isNative: true,
      };
    }
  } catch (err) {
    console.warn('[updater] native check notice:', err);
  }
  return null;
}

/**
 * Tải và cài đặt tự động bản cập nhật thông qua Tauri plugin.
 * Hoàn tất xong sẽ tự động khởi động lại ứng dụng vào phiên bản mới.
 */
export async function installNativeUpdate(
  onProgress?: (pct: number, downloadedBytes: number, totalBytes?: number) => void
): Promise<void> {
  if (!cachedTauriUpdate) {
    throw new Error('Chưa có bản cập nhật nào sẵn sàng để tải.');
  }

  let downloaded = 0;
  let total: number | undefined = undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await cachedTauriUpdate.downloadAndInstall((event: any) => {
    if (event.event === 'Started') {
      total = event.data?.contentLength;
      onProgress?.(0, 0, total);
    } else if (event.event === 'Progress') {
      downloaded += event.data?.chunkLength ?? 0;
      const pct = total && total > 0 ? Math.min(99, Math.round((downloaded / total) * 100)) : 0;
      onProgress?.(pct, downloaded, total);
    } else if (event.event === 'Finished') {
      onProgress?.(100, downloaded, total);
    }
  });

  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

/**
 * Trả về thông tin bản mới nếu có (và chưa bị dismiss), ngược lại null.
 * force = true để check ngay (nút "kiểm tra cập nhật"), bỏ qua cache ngày.
 */
export async function checkForUpdate(force = false): Promise<UpdateInfo | null> {
  if (typeof window === 'undefined') return null;

  // 1. Thử native updater nếu đang chạy trong Tauri
  if (isTauri()) {
    const native = await checkNativeUpdate();
    if (native) {
      const prev = readCache();
      writeCache({ ...native, at: Date.now(), dismissed: prev?.dismissed ?? '' });
      if (!force && prev?.dismissed === native.latest) return null;
      return native;
    }
  }

  // 2. Fallback sang HTTP feed
  if (typeof fetch === 'undefined') return null;
  const cached = readCache();
  if (!force && cached && Date.now() - cached.at < CHECK_INTERVAL_MS) {
    if (isNewer(cached.latest, APP_VERSION) && cached.dismissed !== cached.latest) return cached;
    return null;
  }

  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 8000);
  try {
    let res: Response | null = null;
    for (const url of UPDATE_FEED_URLS) {
      try {
        const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
        if (r.ok) {
          res = r;
          break;
        }
      } catch {
        // thử url tiếp theo
      }
    }

    if (!res || !res.ok) return cached && isNewer(cached.latest, APP_VERSION) ? cached : null;
    const j = (await res.json()) as Partial<UpdateInfo> & { assets?: FeedAssets };
    if (!j.latest || !isNewer(j.latest, APP_VERSION)) return null;
    const tag = `v${j.latest}`;
    const fallbackUrl = j.url || `https://github.com/lgponlylove/reqX/releases/tag/${tag}`;
    const file = j.assets ? pickAsset(currentOs(), j.assets) : null;
    const info: UpdateInfo = {
      latest: j.latest,
      url: fallbackUrl,
      notes: j.notes || '',
      downloadUrl: file ? `https://github.com/lgponlylove/reqX/releases/download/${tag}/${file}` : fallbackUrl,
      isNative: false,
    };
    const prev = readCache();
    writeCache({ ...info, at: Date.now(), dismissed: prev?.dismissed ?? '' });
    const after = readCache();
    if (after && after.dismissed === info.latest) return null;
    return info;
  } catch {
    return null; // offline / bị chặn mạng: im lặng
  } finally {
    window.clearTimeout(timer);
  }
}

/** User bấm "để sau" — không nhắc lại version này nữa. */
export function dismissUpdate(version: string): void {
  const cached = readCache();
  if (cached) writeCache({ ...cached, dismissed: version });
  else writeCache({ latest: version, url: '', notes: '', at: Date.now(), dismissed: version });
}
