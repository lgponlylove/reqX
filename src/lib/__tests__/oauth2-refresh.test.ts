import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OAuth2Config } from '../../types/api';
import {
  ensureFreshOAuth2,
  expiryFromJwt,
  oauth2RemainingSec,
  shouldAutoRefresh,
  getOAuth2SessionInfo,
  clearOAuth2Sessions,
  REFRESH_LEEWAY_SEC,
} from '../oauth2-refresh';
import * as oauth2 from '../oauth2';

vi.mock('../oauth2', async () => {
  const actual = await vi.importActual<typeof oauth2>('../oauth2');
  return { ...actual, fetchOAuth2Token: vi.fn() };
});

const fetchMock = oauth2.fetchOAuth2Token as unknown as ReturnType<typeof vi.fn>;

/** Thời điểm cố định để nhiều lần gọi trong cùng test có issuedAt bằng nhau */
const T0 = Date.now();

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jwtWithExp(expSecondsFromNow: number): string {
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  return `${b64url({ alg: 'none' })}.${b64url({ exp })}.sig`;
}

function baseConfig(over: Partial<OAuth2Config> = {}): OAuth2Config {
  return {
    grantType: 'authorization_code',
    tokenUrl: 'https://auth.test/oauth/token',
    clientId: 'client-1',
    accessToken: 'old-token',
    token: 'old-token',
    refreshToken: 'refresh-1',
    issuedAt: T0,
    expiresIn: 30, // còn 30s < leeway 60s -> phải tự gia hạn
    ...over,
  };
}

function tokenResult(over: Partial<oauth2.OAuth2TokenResult> = {}): oauth2.OAuth2TokenResult {
  return {
    accessToken: 'new-token',
    tokenType: 'Bearer',
    issuedAt: Date.now(),
    expiresIn: 3600,
    raw: {},
    ...over,
  };
}

describe('N6 — OAuth2 auto-refresh trong phiên (RAM-only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearOAuth2Sessions();
  });

  it('không gọi IdP khi chưa có access token', async () => {
    const r = await ensureFreshOAuth2(baseConfig({ accessToken: undefined, token: '' }));
    expect(r.skipped).toBe('no-token');
    expect(r.refreshed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('không gọi IdP khi không có refresh token', async () => {
    const r = await ensureFreshOAuth2(baseConfig({ refreshToken: undefined }));
    expect(r.skipped).toBe('no-refresh-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('token còn hạn (> leeway) thì giữ nguyên', async () => {
    const cfg = baseConfig({ expiresIn: 3600 });
    const r = await ensureFreshOAuth2(cfg);
    expect(r.skipped).toBe('still-valid');
    expect(r.config.accessToken).toBe('old-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('token sắp hết hạn -> refresh bằng grant_type=refresh_token và dùng token mới', async () => {
    fetchMock.mockResolvedValue(tokenResult());
    const cfg = baseConfig();
    const r = await ensureFreshOAuth2(cfg);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].grantType).toBe('refresh_token');
    expect(r.refreshed).toBe(true);
    expect(r.config.accessToken).toBe('new-token');
    expect(r.config.token).toBe('new-token');
  });

  it('IdP không trả lại refresh_token thì giữ bản cũ', async () => {
    fetchMock.mockResolvedValue(tokenResult({ refreshToken: undefined }));
    const r = await ensureFreshOAuth2(baseConfig());
    expect(r.config.refreshToken).toBe('refresh-1');
  });

  it('lần gửi tiếp theo trong cùng phiên dùng cache, không gọi IdP lần hai', async () => {
    fetchMock.mockResolvedValue(tokenResult());
    await ensureFreshOAuth2(baseConfig());
    const second = await ensureFreshOAuth2(baseConfig());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.config.accessToken).toBe('new-token');
    expect(second.refreshed).toBe(true);
  });

  it('nhiều request gửi đồng thời chỉ refresh một lần', async () => {
    let resolveFetch: (v: unknown) => void;
    fetchMock.mockImplementation(
      () => new Promise((res) => { resolveFetch = res; }),
    );

    const p1 = ensureFreshOAuth2(baseConfig());
    const p2 = ensureFreshOAuth2(baseConfig());
    resolveFetch!(tokenResult());

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r1.config.accessToken).toBe('new-token');
    expect(r2.config.accessToken).toBe('new-token');
  });

  it('lỗi refresh -> gửi tiếp bằng token cũ, rồi nghỉ cooldown không spam IdP', async () => {
    fetchMock.mockRejectedValue(new Error('invalid_grant'));
    const first = await ensureFreshOAuth2(baseConfig());
    expect(first.refreshed).toBe(false);
    expect(first.error).toBe('invalid_grant');
    expect(first.config.accessToken).toBe('old-token');

    const second = await ensureFreshOAuth2(baseConfig());
    expect(second.skipped).toBe('cooldown');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('JWT không kèm expires_in: đọc exp làm hạn token', () => {
    expect(expiryFromJwt(jwtWithExp(120))).toBeTypeOf('number');
    expect(expiryFromJwt('not-a-jwt')).toBeNull();
    expect(expiryFromJwt('a.b.c')).toBeNull();

    const cfg = baseConfig({ expiresIn: undefined, accessToken: jwtWithExp(5), token: jwtWithExp(5) });
    const left = oauth2RemainingSec(cfg);
    expect(left).not.toBeNull();
    expect(left!).toBeLessThanOrEqual(REFRESH_LEEWAY_SEC);
    expect(shouldAutoRefresh(cfg)).toBe(true);
  });

  it('token đã hết hạn (exp quá khứ) cũng được làm mới', async () => {
    fetchMock.mockResolvedValue(tokenResult());
    const expired = jwtWithExp(-30);
    const r = await ensureFreshOAuth2(
      baseConfig({ expiresIn: undefined, issuedAt: undefined, accessToken: expired, token: expired }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.config.accessToken).toBe('new-token');
  });

  it('nút "Lấy Token" vừa chạy (issuedAt mới hơn) không bị cache ghi đè', async () => {
    fetchMock.mockResolvedValue(tokenResult({ expiresIn: 30, issuedAt: Date.now() - 60_000 }));
    await ensureFreshOAuth2(baseConfig()); // tạo session có token cũ hơn

    const manual = baseConfig({ accessToken: 'manual', token: 'manual', issuedAt: Date.now(), expiresIn: 3600 });
    const r = await ensureFreshOAuth2(manual);
    expect(r.skipped).toBe('still-valid');
    expect(r.config.accessToken).toBe('manual');
  });

  it('getOAuth2SessionInfo cho UI biết số lần và thời điểm gia hạn', async () => {
    expect(getOAuth2SessionInfo(baseConfig())).toBeNull();
    fetchMock.mockResolvedValue(tokenResult());
    await ensureFreshOAuth2(baseConfig());

    const info = getOAuth2SessionInfo(baseConfig());
    expect(info).not.toBeNull();
    expect(info!.count).toBe(1);
    expect(info!.label).toContain('auth.test');
    expect(info!.remainingSec!).toBeGreaterThan(3000);
  });

  it('clearOAuth2Sessions xoá sạch trạng thái phiên', async () => {
    fetchMock.mockResolvedValue(tokenResult());
    await ensureFreshOAuth2(baseConfig());
    clearOAuth2Sessions();
    expect(getOAuth2SessionInfo(baseConfig())).toBeNull();
  });
});
