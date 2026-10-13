import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generatePkcePair,
  buildAuthorizationUrl,
  parseCallbackUrl,
  getTokenExpiryStatus,
  fetchOAuth2Token,
} from '../oauth2';
import type { OAuth2Config } from '../../types/api';
import * as httpClient from '../http-client';

vi.mock('../http-client', async () => {
  const actual = await vi.importActual<typeof httpClient>('../http-client');
  return {
    ...actual,
    sendRequest: vi.fn(),
  };
});

describe('OAuth 2.0 Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. PKCE Generation (RFC 7636)', () => {
    it('sinh code_verifier và code_challenge chuẩn base64url SHA-256', async () => {
      const { codeVerifier, codeChallenge } = await generatePkcePair();
      expect(codeVerifier).toBeTruthy();
      expect(codeChallenge).toBeTruthy();
      expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
      // Code challenge không chứa ký tự +, /, = của base64 tiêu chuẩn
      expect(codeChallenge).not.toMatch(/[+/=]/);
    });
  });

  describe('2. Build Authorization URL', () => {
    it('tạo URL đăng nhập đúng chuẩn với query parameters', () => {
      const config: OAuth2Config = {
        authUrl: 'https://auth.example.com/oauth/authorize',
        clientId: 'client-123',
        redirectUri: 'http://localhost:3000/callback',
        scope: 'read write',
        codeChallenge: 'challenge_abc_xyz',
      };

      const urlStr = buildAuthorizationUrl(config);
      const url = new URL(urlStr);

      expect(url.origin + url.pathname).toBe('https://auth.example.com/oauth/authorize');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('client-123');
      expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/callback');
      expect(url.searchParams.get('scope')).toBe('read write');
      expect(url.searchParams.get('code_challenge')).toBe('challenge_abc_xyz');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('hỗ trợ giải quyết biến {{var}} trong authUrl và clientId', () => {
      const config: OAuth2Config = {
        authUrl: '{{authEndpoint}}/authorize',
        clientId: '{{appId}}',
      };
      const envVars = {
        authEndpoint: 'https://idp.test.com',
        appId: 'my-app-id',
      };

      const urlStr = buildAuthorizationUrl(config, envVars);
      const url = new URL(urlStr);
      expect(url.origin + url.pathname).toBe('https://idp.test.com/authorize');
      expect(url.searchParams.get('client_id')).toBe('my-app-id');
    });

    it('dùng response_type=token cho implicit grant', () => {
      const config: OAuth2Config = {
        grantType: 'implicit',
        authUrl: 'https://auth.example.com/authorize',
      };
      const urlStr = buildAuthorizationUrl(config);
      const url = new URL(urlStr);
      expect(url.searchParams.get('response_type')).toBe('token');
    });
  });

  describe('3. Parse Callback URL', () => {
    it('trích code từ full redirect URL', () => {
      const input = 'http://localhost:8080/callback?code=AUTH_CODE_XYZ123&state=state_abc';
      const parsed = parseCallbackUrl(input);
      expect(parsed.code).toBe('AUTH_CODE_XYZ123');
    });

    it('trích access_token từ hash fragment của implicit flow', () => {
      const input = 'https://app.example.com/callback#access_token=token_789&token_type=Bearer&expires_in=3600';
      const parsed = parseCallbackUrl(input);
      expect(parsed.accessToken).toBe('token_789');
    });

    it('trích lỗi khi IDP trả về error trong URL', () => {
      const input = 'http://localhost:8080/callback?error=access_denied&error_description=User+declined';
      const parsed = parseCallbackUrl(input);
      expect(parsed.error).toContain('User declined');
    });

    it('chấp nhận mã code thuần nếu user dán trực tiếp', () => {
      const input = 'MY_RAW_AUTH_CODE';
      const parsed = parseCallbackUrl(input);
      expect(parsed.code).toBe('MY_RAW_AUTH_CODE');
    });
  });

  describe('4. Token Expiry Status', () => {
    it('báo chưa có token khi không có accessToken', () => {
      const res = getTokenExpiryStatus({});
      expect(res.formatted).toBe('Chưa có token');
      expect(res.isExpired).toBe(false);
    });

    it('tính toán thời hạn còn lại và cờ cảnh báo', () => {
      const now = Date.now();
      const validTokenConfig: OAuth2Config = {
        accessToken: 'valid_tok',
        expiresIn: 3600, // 1 tiếng
        issuedAt: now - 600 * 1000, // đã trôi qua 10 phút
      };
      const res = getTokenExpiryStatus(validTokenConfig);
      expect(res.isExpired).toBe(false);
      expect(res.isExpiringSoon).toBe(false);
      expect(res.formatted).toContain('50m');

      // Sắp hết hạn (còn 60 giây)
      const expiringSoonConfig: OAuth2Config = {
        accessToken: 'valid_tok',
        expiresIn: 300,
        issuedAt: now - 240 * 1000,
      };
      const resSoon = getTokenExpiryStatus(expiringSoonConfig);
      expect(resSoon.isExpiringSoon).toBe(true);

      // Đã hết hạn
      const expiredConfig: OAuth2Config = {
        accessToken: 'expired_tok',
        expiresIn: 100,
        issuedAt: now - 500 * 1000,
      };
      const resExpired = getTokenExpiryStatus(expiredConfig);
      expect(resExpired.isExpired).toBe(true);
      expect(resExpired.formatted).toBe('Đã hết hạn');
    });
  });

  describe('5. Fetch OAuth2 Token (Get Token)', () => {
    it('lấy token thành công cho client_credentials với Basic Auth Header', async () => {
      const config: OAuth2Config = {
        grantType: 'client_credentials',
        tokenUrl: 'https://auth.example.com/oauth/token',
        clientId: 'my-client',
        clientSecret: 'my-secret',
        scope: 'api:read',
        clientAuth: 'header',
      };

      vi.mocked(httpClient.sendRequest).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_token: 'jwt-access-token-123',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'api:read',
        }),
        bodyKind: 'text',
        timeMs: 45,
        sizeBytes: 150,
      });

      const res = await fetchOAuth2Token(config);

      expect(res.accessToken).toBe('jwt-access-token-123');
      expect(res.expiresIn).toBe(3600);
      expect(res.tokenType).toBe('Bearer');
      expect(httpClient.sendRequest).toHaveBeenCalledTimes(1);

      // Kiểm tra header Basic Auth được truyền đúng
      const executedReq = vi.mocked(httpClient.sendRequest).mock.calls[0][0];
      const authHeader = executedReq.headers.find((h: { key: string }) => h.key === 'Authorization');
      expect(authHeader).toBeDefined();
      expect(authHeader?.value).toBe(`Basic ${btoa('my-client:my-secret')}`);
    });

    it('lấy token thành công cho password grant', async () => {
      const config: OAuth2Config = {
        grantType: 'password',
        tokenUrl: 'https://auth.example.com/oauth/token',
        clientId: 'app',
        clientSecret: 'secret',
        username: 'john_doe',
        password: 'password123',
      };

      vi.mocked(httpClient.sendRequest).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_token: 'token_pwd_grant',
          refresh_token: 'refresh_tok_123',
          expires_in: 7200,
        }),
        bodyKind: 'text',
        timeMs: 50,
        sizeBytes: 120,
      });

      const res = await fetchOAuth2Token(config);
      expect(res.accessToken).toBe('token_pwd_grant');
      expect(res.refreshToken).toBe('refresh_tok_123');

      const executedReq = vi.mocked(httpClient.sendRequest).mock.calls[0][0];
      expect(executedReq.body).toContain('grant_type=password');
      expect(executedReq.body).toContain('username=john_doe');
    });

    it('lấy token thành công cho authorization_code với PKCE', async () => {
      const config: OAuth2Config = {
        grantType: 'authorization_code',
        tokenUrl: 'https://auth.example.com/oauth/token',
        clientId: 'app',
        code: 'auth_code_999',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'verifier_secret_str',
      };

      vi.mocked(httpClient.sendRequest).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_token: 'token_code_grant',
          expires_in: 1800,
        }),
        bodyKind: 'text',
        timeMs: 30,
        sizeBytes: 100,
      });

      const res = await fetchOAuth2Token(config);
      expect(res.accessToken).toBe('token_code_grant');

      const executedReq = vi.mocked(httpClient.sendRequest).mock.calls[0][0];
      expect(executedReq.body).toContain('grant_type=authorization_code');
      expect(executedReq.body).toContain('code=auth_code_999');
      expect(executedReq.body).toContain('code_verifier=verifier_secret_str');
    });

    it('ném lỗi mô tả rõ ràng khi IDP trả về lỗi 400 hoặc invalid_client', async () => {
      const config: OAuth2Config = {
        grantType: 'client_credentials',
        tokenUrl: 'https://auth.example.com/oauth/token',
        clientId: 'wrong_client',
      };

      vi.mocked(httpClient.sendRequest).mockResolvedValue({
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          error: 'invalid_client',
          error_description: 'Client authentication failed (e.g., unknown client)',
        }),
        bodyKind: 'text',
        timeMs: 20,
        sizeBytes: 80,
      });

      await expect(fetchOAuth2Token(config)).rejects.toThrow(
        /Client authentication failed/
      );
    });
  });
});
