export interface CookieRecord {
  domain: string;
  path: string;
  key: string;
  value: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  /** Cookie do server gán session (không có Expires/Max-Age) — chỉ sống tới khi đóng app. */
  hostOnly?: boolean;
}

/** Kho cũ (trước 12/10) ghi jar xuống localStorage; chỉ còn dùng để dọn dẹp một lần. */
const LEGACY_STORAGE_KEY = 'reqx-cookie-jar-v1';

/**
 * Kiểm tra `path` của cookie khớp `requestPath` theo RFC 6265 §5.1.4
 * (có so khớp ở ranh giới dấu `/`, không dùng startsWith thô).
 */
function pathMatches(cookiePath: string, requestPath: string): boolean {
  const cp = cookiePath || '/';
  const rp = requestPath || '/';
  if (cp === rp) return true;
  if (!rp.startsWith(cp)) return false;
  if (cp.endsWith('/')) return true;
  return rp[cp.length] === '/';
}

/**
 * Chặn đặt cookie cho suffix công cộng (vd `domain=com`, `domain=co`) —
 * nếu không, một response độc hại có thể đầu độc cả họ tên miền.
 * Không cần danh sách PSL đầy đủ: chỉ nhận domain có >= 2 nhãn.
 */
function isRegistrableDomain(domain: string): boolean {
  const parts = domain.split('.');
  return parts.length >= 2 && parts.every((p) => p !== '') && parts[parts.length - 1].length >= 2;
}

export class CookieJar {
  private cookies: CookieRecord[] = [];

  constructor() {
    this.migrateFromStorage();
  }

  /**
   * Dọn bản sao trên đĩa: jar chỉ sống trong RAM (đúng policy secret).
   * Session cookie của phiên trước bị mất có chủ đích — đó là hành vi của trình duyệt.
   */
  private migrateFromStorage() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LEGACY_STORAGE_KEY) : null;
      if (!raw) return;
      const parsed = JSON.parse(raw) as CookieRecord[];
      if (Array.isArray(parsed)) {
        const now = Date.now();
        this.cookies = parsed.filter((c) => c && c.key && c.domain && (!c.expires || c.expires > now));
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch { /* bỏ qua */ }
    }
  }

  public getAll(): CookieRecord[] {
    const now = Date.now();
    this.cookies = this.cookies.filter((c) => !c.expires || c.expires > now);
    return [...this.cookies];
  }

  public clear(): void {
    this.cookies = [];
  }

  public remove(domain: string, key: string): void {
    const d = domain.toLowerCase();
    this.cookies = this.cookies.filter((c) => !(c.domain.toLowerCase() === d && c.key === key));
  }

  /**
   * Parse response Set-Cookie header và giữ cookie trong RAM.
   */
  public setCookie(urlString: string | URL, headerValue: string): void {
    if (!headerValue) return;
    const url = typeof urlString === 'string' ? new URL(urlString, 'http://localhost') : urlString;
    const defaultDomain = url.hostname.toLowerCase();
    const isHttps = url.protocol === 'https:';
    const rawPath = url.pathname || '/';
    // RFC 6265: path mặc định là thư mục cha, không phải chính pathname
    const defaultPath = rawPath.includes('/') ? rawPath.slice(0, rawPath.lastIndexOf('/') || 1) : '/';

    const rawCookies = headerValue.split(/\r?\n/);
    for (const raw of rawCookies) {
      const parts = raw.split(';').map((s) => s.trim());
      if (parts.length === 0 || !parts[0].includes('=')) continue;

      const [first, ...attrs] = parts;
      const eqIdx = first.indexOf('=');
      const key = first.slice(0, eqIdx).trim();
      const value = first.slice(eqIdx + 1).trim();
      if (!key) continue;

      let domain = defaultDomain;
      let path = defaultPath;
      let expires: number | undefined;
      let httpOnly = false;
      let secure = false;
      let hostOnly = true;
      let maxAgeSeen = false;

      for (const attr of attrs) {
        const [aKey, ...aValParts] = attr.split('=');
        const aName = aKey.trim().toLowerCase();
        const aVal = aValParts.join('=').trim();

        if (aName === 'domain' && aVal) {
          const candidate = aVal.replace(/^\./, '').toLowerCase();
          // Chỉ nhận domain là chính host hoặc suffix của host
          if (
            isRegistrableDomain(candidate) &&
            (defaultDomain === candidate || defaultDomain.endsWith('.' + candidate))
          ) {
            domain = candidate;
            hostOnly = false;
          }
        } else if (aName === 'path' && aVal.startsWith('/')) {
          path = aVal;
        } else if (aName === 'expires' && aVal) {
          const parsed = Date.parse(aVal);
          if (!isNaN(parsed)) expires = parsed;
        } else if (aName === 'max-age' && aVal) {
          const secs = parseInt(aVal, 10);
          if (!isNaN(secs)) {
            maxAgeSeen = true;
            expires = secs <= 0 ? 0 : Date.now() + secs * 1000;
          }
        } else if (aName === 'httponly') {
          httpOnly = true;
        } else if (aName === 'secure') {
          secure = true;
        }
      }

      // Prefix rules (RFC draft): __Host- phải secure + path=/ + không có Domain;
      // __Secure- phải secure.
      if (key.startsWith('__Host-') && (!secure || path !== '/' || !hostOnly)) continue;
      if (key.startsWith('__Secure-') && !secure) continue;
      // Cookie Secure chỉ được nhận qua HTTPS
      if (secure && !isHttps) continue;
      // Max-Age<=0 hoặc Expires quá khứ = xoá cookie
      if (maxAgeSeen && expires === 0) {
        this.cookies = this.cookies.filter((c) => !(c.domain === domain && c.path === path && c.key === key));
        continue;
      }

      this.cookies = this.cookies.filter(
        (c) => !(c.domain === domain && c.path === path && c.key === key),
      );
      if (expires === undefined || expires > Date.now()) {
        this.cookies.push({ domain, path, key, value, expires, httpOnly, secure, hostOnly });
      }
    }
  }

  /**
   * Trả về chuỗi header Cookie cho request URL (rỗng nếu không có cookie khớp).
   */
  public getCookieHeader(urlString: string | URL): string {
    const url = typeof urlString === 'string' ? new URL(urlString, 'http://localhost') : urlString;
    const host = url.hostname.toLowerCase();
    const path = url.pathname || '/';
    const isHttps = url.protocol === 'https:';
    const now = Date.now();

    const matches = this.cookies.filter((c) => {
      if (c.expires && c.expires <= now) return false;
      if (c.secure && !isHttps) return false;
      const domainMatch =
        c.hostOnly
          ? host === c.domain
          : host === c.domain || host.endsWith('.' + c.domain);
      if (!domainMatch) return false;
      return pathMatches(c.path, path);
    });

    if (matches.length === 0) return '';
    // Cookie dài path hơn ưu tiên trước (RFC 6265 §5.4)
    return matches
      .sort((a, b) => b.path.length - a.path.length || a.key.localeCompare(b.key))
      .map((c) => `${c.key}=${c.value}`)
      .join('; ');
  }
}

export const cookieJar = new CookieJar();
