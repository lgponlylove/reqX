import type { OAuth2Config } from '../types/api';
import { fetchOAuth2Token, getTokenExpiryStatus } from './oauth2';
import { resolveVariables } from './variables';

/** Còn dưới ngưỡng này (giây) thì làm mới trước khi gửi, để request không rơi vào 401. */
export const REFRESH_LEEWAY_SEC = 60;

/** Sau khi lỗi, chờ bấy lâu mới gọi lại IdP — tránh spam mỗi lần gửi. */
export const ERROR_COOLDOWN_MS = 30_000;

interface OAuth2Session {
  config: OAuth2Config;
  /** thời điểm điểm cập nhật token gần nhất (ms) */
  at: number;
  count: number;
  error?: string;
}

/**
 * Cache phiên: RAM-only, đúng policy secret — refresh token và access token
 * không bao giờ đi qua partialize/persist.
 */
const sessions = new Map<string, OAuth2Session>();
const inflight = new Map<string, Promise<OAuth2Config>>();

function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Định danh phiên OAuth2: token endpoint + client + scope + dấu vết refresh token.
 * Không chứa secret thô — chỉ hash, để còn dùng làm khoá map và hiển thị nhãn.
 */
export function oauth2SessionKey(
  cfg: OAuth2Config,
  envVars: Record<string, string> = {},
  globalVars: Record<string, string> = {},
): string {
  const tokenUrl = resolveVariables(cfg.tokenUrl || '', envVars, globalVars).resolved.trim();
  const clientId = resolveVariables(cfg.clientId || '', envVars, globalVars).resolved.trim();
  const scope = resolveVariables(cfg.scope || '', envVars, globalVars).resolved.trim();
  const refresh = resolveVariables(cfg.refreshToken || '', envVars, globalVars).resolved.trim();
  return `${tokenUrl}|${clientId}|${scope}|${simpleHash(refresh)}`;
}

/**
 * `exp` (giây) trong payload JWT — nhiều IdP trả JWT mà không kèm expires_in.
 * Không đoán mò: chỉ đọc khi token thật sự là JWT hợp lệ.
 */
export function expiryFromJwt(token: string): number | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(payload + '='.repeat((4 - (payload.length % 4)) % 4)));
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

/** Giây còn lại của token; null = không có cách nào biết. */
export function oauth2RemainingSec(cfg: OAuth2Config): number | null {
  const known = getTokenExpiryStatus(cfg);
  if (known.remainingSec !== null) return known.remainingSec;

  const token = cfg.accessToken || cfg.token || '';
  const exp = expiryFromJwt(token);
  if (exp === null) return null;
  return Math.floor(exp - Date.now() / 1000);
}

export function shouldAutoRefresh(cfg: OAuth2Config): boolean {
  const token = cfg.accessToken || cfg.token;
  if (!token) return false;
  const refresh = (cfg.refreshToken || '').trim();
  if (!refresh) return false;
  const left = oauth2RemainingSec(cfg);
  if (left === null) return false;
  return left <= REFRESH_LEEWAY_SEC;
}

/** Gọi thẳng token endpoint với grant_type=refresh_token và trộn kết quả vào config. */
export async function refreshOAuth2Config(
  cfg: OAuth2Config,
  envVars: Record<string, string> = {},
  globalVars: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<OAuth2Config> {
  const result = await fetchOAuth2Token({ ...cfg, grantType: 'refresh_token' }, envVars, globalVars, signal);
  return {
    ...cfg,
    accessToken: result.accessToken,
    token: result.accessToken,
    // IdP thường không trả lại refresh_token — giữ bản cũ nếu thiếu
    refreshToken: result.refreshToken ?? cfg.refreshToken,
    expiresIn: result.expiresIn,
    tokenType: result.tokenType,
    issuedAt: result.issuedAt,
    scope: result.scope ?? cfg.scope,
  };
}

/**
 * Viết token mới trở lại state trong RAM (tab đang mở + biến autoSave) để UI
 * thấy hạn mới và các request dùng {{accessToken}} cũng được cập nhật.
 * Best-effort: môi trường headless/test không có store thì bỏ qua.
 */
async function writeBackToSession(
  cfg: OAuth2Config,
  prev: OAuth2Config,
  requestId?: string,
): Promise<void> {
  const varName = cfg.autoSaveVar?.trim();
  if (!requestId && !varName) return;
  try {
    if (requestId) {
      const { useRequestStore } = await import('../stores/request');
      const st = useRequestStore.getState();
      if (st.current.id === requestId && st.current.auth.type === 'oauth2') {
        st.set({ auth: { ...st.current.auth, oauth2: cfg } });
      }
    }
    if (varName) {
      const { useAppStore } = await import('../stores/app');
      const st = useAppStore.getState();
      if (st.activeEnvId) st.setEnvVar(st.activeEnvId, varName, cfg.accessToken ?? cfg.token ?? '');
    }
  } catch {
    /* store chưa sẵn sàng (test/headless) — token vẫn dùng được cho request này */
    void prev;
  }
}

export interface EnsureFreshResult {
  config: OAuth2Config;
  refreshed: boolean;
  /** Lý do bỏ qua khi không làm mới — hữu ích cho UI/test. */
  skipped?: 'no-token' | 'no-refresh-token' | 'unknown-expiry' | 'still-valid' | 'cooldown';
  error?: string;
}

/**
 * N6 — tự gia hạn trong phiên: token còn <= 60s (hoặc đã hết hạn) và có refresh token
 * thì âm thầm lấy token mới TRƯỚC khi gửi. Thất bại thì gửi tiếp bằng token cũ
 * (server tự trả 401) rồi nghỉ 30s để không spam IdP.
 */
export async function ensureFreshOAuth2(
  cfg: OAuth2Config,
  envVars: Record<string, string> = {},
  globalVars: Record<string, string> = {},
  opts: { requestId?: string; signal?: AbortSignal } = {},
): Promise<EnsureFreshResult> {
  const token = cfg.accessToken || cfg.token;
  if (!token) return { config: cfg, refreshed: false, skipped: 'no-token' };
  if (!(cfg.refreshToken || '').trim()) return { config: cfg, refreshed: false, skipped: 'no-refresh-token' };

  const key = oauth2SessionKey(cfg, envVars, globalVars);
  const cached = sessions.get(key);

  // Nơi khác (nút Lấy Token, tab khác) vừa có token mới hơn -> nhận của họ, đừng ghi đè
  if (cached && (cfg.issuedAt ?? 0) > (cached.config.issuedAt ?? 0)) {
    sessions.set(key, { config: cfg, at: Date.now(), count: cached.count, error: cached.error });
    return { config: cfg, refreshed: false, skipped: 'still-valid' };
  }

  // Cache đã có token còn hạn (lần refresh trước trong phiên) -> dùng lại, khỏi gọi IdP
  if (cached && !shouldAutoRefresh(cached.config)) {
    return { config: cached.config, refreshed: true, skipped: 'still-valid' };
  }

  if (cached?.error && Date.now() - cached.at < ERROR_COOLDOWN_MS) {
    return { config: cfg, refreshed: false, skipped: 'cooldown', error: cached.error };
  }

  if (!shouldAutoRefresh(cfg)) {
    return { config: cfg, refreshed: false, skipped: 'still-valid' };
  }

  const running = inflight.get(key);
  if (running) return { config: await running, refreshed: true };

  const task = (async (): Promise<OAuth2Config> => {
    const fresh = await refreshOAuth2Config(cfg, envVars, globalVars, opts.signal);
    sessions.set(key, { config: fresh, at: Date.now(), count: (cached?.count ?? 0) + 1 });
    return fresh;
  })();
  inflight.set(key, task);

  try {
    const fresh = await task;
    await writeBackToSession(fresh, cfg, opts.requestId);
    return { config: fresh, refreshed: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sessions.set(key, { config: cached?.config ?? cfg, at: Date.now(), count: cached?.count ?? 0, error: msg });
    return { config: cfg, refreshed: false, error: msg };
  } finally {
    inflight.delete(key);
  }
}

export interface OAuth2SessionInfo {
  /** nhãn hiển thị: host của token endpoint + client id */
  label: string;
  at: number;
  count: number;
  error?: string;
  remainingSec: number | null;
}

function labelFor(key: string): string {
  const [tokenUrl, clientId] = key.split('|');
  let host = tokenUrl;
  try {
    host = new URL(tokenUrl).host;
  } catch {
    /* url tương đối */
  }
  return `${host || '(no token url)'}${clientId ? ` · ${clientId}` : ''}`;
}

/** Tình trạng phiên của đúng config đang mở — cho OAuth2Editor hiển thị. */
export function getOAuth2SessionInfo(
  cfg: OAuth2Config,
  envVars: Record<string, string> = {},
  globalVars: Record<string, string> = {},
): OAuth2SessionInfo | null {
  const key = oauth2SessionKey(cfg, envVars, globalVars);
  const s = sessions.get(key);
  if (!s) return null;
  return { label: labelFor(key), at: s.at, count: s.count, error: s.error, remainingSec: oauth2RemainingSec(s.config) };
}

/** Dọn cache — dùng khi đăng xuất/đóng phiên và cho test. */
export function clearOAuth2Sessions(): void {
  sessions.clear();
  inflight.clear();
}
