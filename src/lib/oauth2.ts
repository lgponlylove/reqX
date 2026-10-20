import type { ApiRequest, KeyValue, OAuth2Config } from '../types/api';
import { resolveVariables } from './variables';
import { sendRequest, btoaUtf8 } from './http-client';

export interface OAuth2TokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType: string;
  scope?: string;
  issuedAt: number;
  raw: Record<string, any>;
}

/**
 * Sinh cặp mã PKCE (RFC 7636): code_verifier và code_challenge (S256)
 */
export async function generatePkcePair(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const codeVerifier = Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const base64 = btoa(String.fromCharCode.apply(null, hashArray));
  const codeChallenge = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return { codeVerifier, codeChallenge };
}

/**
 * Xây dựng URL đăng nhập ủy quyền OAuth2 (Authorization URL)
 */
export function buildAuthorizationUrl(
  config: OAuth2Config,
  envVars: Record<string, string> = {},
  globalVars: Record<string, string> = {},
): string {
  const rawAuthUrl = resolveVariables(config.authUrl || '', envVars, globalVars).resolved.trim();
  if (!rawAuthUrl) return '';

  try {
    const url = new URL(rawAuthUrl);
    const clientId = resolveVariables(config.clientId || '', envVars, globalVars).resolved.trim();
    const redirectUri = resolveVariables(config.redirectUri || '', envVars, globalVars).resolved.trim();
    const scope = resolveVariables(config.scope || '', envVars, globalVars).resolved.trim();

    const responseType = config.grantType === 'implicit' ? 'token' : 'code';
    url.searchParams.set('response_type', responseType);

    if (clientId) url.searchParams.set('client_id', clientId);
    if (redirectUri) url.searchParams.set('redirect_uri', redirectUri);
    if (scope) url.searchParams.set('scope', scope);
    if (config.codeChallenge) {
      url.searchParams.set('code_challenge', config.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }

    return url.toString();
  } catch {
    return rawAuthUrl;
  }
}

/**
 * Trích xuất Authorization Code hoặc Access Token từ URL callback/redirect mà user dán vào
 */
export function parseCallbackUrl(input: string): { code?: string; accessToken?: string; error?: string } {
  const text = input.trim();
  if (!text) return {};

  // Nếu user dán thẳng code thuần không có ký tự URL
  if (!text.includes('://') && !text.includes('?') && !text.includes('#') && !text.includes('&') && !text.includes('=')) {
    return { code: text };
  }

  try {
    // Nếu dán cả URL: vd http://localhost:8080/callback?code=abc... hoặc fragment #access_token=...
    const url = new URL(text.includes('://') ? text : `http://localhost/?${text}`);
    
    // Tìm trong query parameters (ưu tiên error_description nếu có)
    const err = url.searchParams.get('error_description') || url.searchParams.get('error');
    if (err) return { error: err };
    const code = url.searchParams.get('code');
    if (code) return { code };

    // Tìm trong URL hash fragment (vd implicit flow #access_token=...)
    if (url.hash && url.hash.length > 1) {
      const hashParams = new URLSearchParams(url.hash.slice(1));
      const hashErr = hashParams.get('error_description') || hashParams.get('error');
      if (hashErr) return { error: hashErr };
      const token = hashParams.get('access_token');
      if (token) return { accessToken: token };
    }
  } catch {
    // Fallback: nếu lỗi parse URL thì trả về text như là code
    return { code: text };
  }

  return { code: text };
}

/**
 * Thực hiện gửi request lấy Access Token từ Token Endpoint (hỗ trợ client_credentials, password, authorization_code, refresh_token)
 */
export async function fetchOAuth2Token(
  config: OAuth2Config,
  envVars: Record<string, string> = {},
  globalVars: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<OAuth2TokenResult> {
  const grantType = config.grantType || 'client_credentials';

  const tokenUrl = resolveVariables(config.tokenUrl || '', envVars, globalVars).resolved.trim();
  if (!tokenUrl) {
    throw new Error('Vui lòng nhập Access Token URL');
  }

  const clientId = resolveVariables(config.clientId || '', envVars, globalVars).resolved.trim();
  const clientSecret = resolveVariables(config.clientSecret || '', envVars, globalVars).resolved.trim();
  const scope = resolveVariables(config.scope || '', envVars, globalVars).resolved.trim();
  const username = resolveVariables(config.username || '', envVars, globalVars).resolved.trim();
  const password = resolveVariables(config.password || '', envVars, globalVars).resolved.trim();
  const code = resolveVariables(config.code || '', envVars, globalVars).resolved.trim();
  const refreshToken = resolveVariables(config.refreshToken || '', envVars, globalVars).resolved.trim();
  const redirectUri = resolveVariables(config.redirectUri || '', envVars, globalVars).resolved.trim();
  const codeVerifier = config.codeVerifier ? resolveVariables(config.codeVerifier, envVars, globalVars).resolved.trim() : '';

  const clientAuth = config.clientAuth || 'header';

  // Kiểm tra tính hợp lệ cơ bản
  if (grantType === 'password') {
    if (!username) throw new Error('Password grant yêu cầu nhập Username');
  } else if (grantType === 'authorization_code') {
    if (!code) throw new Error('Authorization Code grant yêu cầu nhập hoặc lấy Code trước');
  } else if (grantType === 'refresh_token') {
    if (!refreshToken) throw new Error('Refresh Token grant yêu cầu có Refresh Token');
  }

  // Xây dựng body urlencoded
  const params = new URLSearchParams();
  params.set('grant_type', grantType);

  if (scope) params.set('scope', scope);

  if (grantType === 'password') {
    params.set('username', username);
    params.set('password', password);
  } else if (grantType === 'authorization_code') {
    params.set('code', code);
    if (redirectUri) params.set('redirect_uri', redirectUri);
    if (codeVerifier) params.set('code_verifier', codeVerifier);
  } else if (grantType === 'refresh_token') {
    params.set('refresh_token', refreshToken);
  }

  // Client Authentication: Basic Header vs Request Body
  const headers: KeyValue[] = [
    { id: 'ct', key: 'Content-Type', value: 'application/x-www-form-urlencoded', enabled: true },
    { id: 'acc', key: 'Accept', value: 'application/json, text/plain, */*', enabled: true },
  ];

  if (clientAuth === 'body') {
    if (clientId) params.set('client_id', clientId);
    if (clientSecret) params.set('client_secret', clientSecret);
  } else {
    // Header Basic Auth
    if (clientId) {
      const basic = btoaUtf8(`${clientId}:${clientSecret}`);
      headers.push({ id: 'auth', key: 'Authorization', value: `Basic ${basic}`, enabled: true });
    }
  }

  const dummyReq: ApiRequest = {
    id: 'oauth2_token_fetch',
    name: 'OAuth2 Token Fetcher',
    method: 'POST',
    url: tokenUrl,
    params: [],
    headers,
    bodyType: 'urlencoded',
    body: params.toString(),
    auth: { type: 'none' },
    updatedAt: Date.now(),
  };

  const res = await sendRequest(dummyReq, envVars, globalVars, { timeoutMs: 25000 }, signal);

  // Phân tích kết quả
  let data: Record<string, any> = {};
  try {
    data = JSON.parse(res.body || '{}');
  } catch {
    // Không phải JSON
    throw new Error(`Server trả về mã ${res.status} không đúng định dạng JSON: ${res.body.slice(0, 200)}`);
  }

  if (res.status >= 400 || data.error) {
    const errMsg = data.error_description || data.error || data.message || `Lỗi HTTP ${res.status}`;
    throw new Error(`Lấy token thất bại: ${errMsg}`);
  }

  const accessToken = data.access_token || data.accessToken || data.id_token;
  if (!accessToken) {
    throw new Error(`Response không chứa access_token: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return {
    accessToken,
    refreshToken: data.refresh_token || data.refreshToken || undefined,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : undefined,
    tokenType: data.token_type || data.tokenType || 'Bearer',
    scope: data.scope,
    issuedAt: Date.now(),
    raw: data,
  };
}

/**
 * Tính toán thời hạn còn lại của token
 */
export function getTokenExpiryStatus(config: OAuth2Config): {
  isExpired: boolean;
  isExpiringSoon: boolean;
  remainingSec: number | null;
  formatted: string;
} {
  if (!config.accessToken && !config.token) {
    return { isExpired: false, isExpiringSoon: false, remainingSec: null, formatted: 'Chưa có token' };
  }

  if (!config.expiresIn || !config.issuedAt) {
    return { isExpired: false, isExpiringSoon: false, remainingSec: null, formatted: 'Không rõ thời hạn' };
  }

  const elapsedSec = Math.floor((Date.now() - config.issuedAt) / 1000);
  const remainingSec = config.expiresIn - elapsedSec;

  if (remainingSec <= 0) {
    return { isExpired: true, isExpiringSoon: false, remainingSec: 0, formatted: 'Đã hết hạn' };
  }

  const isExpiringSoon = remainingSec < 120; // Dưới 2 phút

  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  const formatted = mins > 60 
    ? `Còn ~${Math.floor(mins / 60)}h ${mins % 60}m` 
    : mins > 0 
      ? `Còn ${mins}m ${secs}s` 
      : `Còn ${secs}s`;

  return {
    isExpired: false,
    isExpiringSoon,
    remainingSec,
    formatted,
  };
}
