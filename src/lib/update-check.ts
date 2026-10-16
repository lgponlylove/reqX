/**
 * Kiểm tra phiên bản mới (nấc 1: check + báo, không tự cài).
 * Feed là file latest.json host trên GitHub cùng chỗ với ReqX-Portable.zip.
 * Lỗi mạng/offline thì im lặng bỏ qua — app offline-first.
 */

/** Đổi theo package.json mỗi lần release. */
export const APP_VERSION = '0.2.0';

export const UPDATE_FEED_URL =
  'https://raw.githubusercontent.com/lgponlylove/reqX/main/latest.json';

const LS_CHECK = 'reqx_update_check';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 ngày check 1 lần

export interface UpdateInfo {
  latest: string;
  url: string;
  notes: string;
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

/**
 * Trả về thông tin bản mới nếu có (và chưa bị dismiss), ngược lại null.
 * force = true để check ngay (nút "kiểm tra cập nhật"), bỏ qua cache ngày.
 */
export async function checkForUpdate(force = false): Promise<UpdateInfo | null> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return null;
  const cached = readCache();
  if (!force && cached && Date.now() - cached.at < CHECK_INTERVAL_MS) {
    if (isNewer(cached.latest, APP_VERSION) && cached.dismissed !== cached.latest) return cached;
    return null;
  }
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(UPDATE_FEED_URL, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) return cached && isNewer(cached.latest, APP_VERSION) ? cached : null;
    const j = (await res.json()) as Partial<UpdateInfo>;
    if (!j.latest || !isNewer(j.latest, APP_VERSION)) return null;
    const info: UpdateInfo = {
      latest: j.latest,
      url: j.url || 'https://github.com/lgponlylove/reqX/releases',
      notes: j.notes || '',
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
