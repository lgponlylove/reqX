import type { ApiRequest, AuthConfig } from '../types/api';

const SECRET_WORDS = new Set([
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'secret', 'secretkey', 'clientsecret',
  'password', 'passwd', 'pwd', 'apikey', 'credential', 'credentials', 'bearer',
  'authorization', 'cookie', 'jsessionid', 'phpsessid', 'sessionid', 'privatekey', 'accesskey',
  'sessiontoken',
]);

/** Tách tên biến thành từ thường: `accessToken` -> [access, token], `api_key` -> [api, key]. */
function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/**
 * Tên biến hoặc giá trị nghi là credential -> mặc định coi là secret (chỉ giữ trong RAM).
 * `key` chỉ tính khi đứng cạnh api/access/secret/private để không chặn nhầm `monkeyKey`.
 */
export function looksSecret(name: string, value = ''): boolean {
  const ws = wordsOf(name);
  if (ws.some((w) => w === 'key' && ws.some((x) => ['api', 'access', 'secret', 'private'].includes(x)))) return true;
  if (ws.some((w) => SECRET_WORDS.has(w))) return true;
  const v = value.trim();
  // Giá trị hình JWT / PEM thì bất kể tên
  if (/^eyJ[\w-]{8,}\.[\w-]{8,}/.test(v) || /^-----BEGIN /.test(v)) return true;
  // "Bearer xxx" — nhiều API nhét nguyên cả cụm vào 1 biến (autoSaveFormat "có loại").
  // Bắt buộc phần sau là 1 chuỗi dài như token, không chặn nhầm ô ghi chú "basic info about ...".
  return /^(bearer|basic|token|mac|digest)\s+\S{12,}$/i.test(v);
}

/** Xóa secrets khỏi auth — chỉ giữ lại cấu trúc (type, tên key), không giữ giá trị. */
export function stripAuth(auth: AuthConfig): AuthConfig {
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', token: '' };
    case 'basic':
      return { type: 'basic', username: auth.username ?? '', password: '' };
    case 'apikey':
      return { type: 'apikey', apiKey: '', apiKeyIn: auth.apiKeyIn, apiKeyName: auth.apiKeyName };
    case 'oauth2':
      return {
        type: 'oauth2',
        oauth2: auth.oauth2 ? {
          ...auth.oauth2,
          accessToken: '',
          token: '',
          refreshToken: '',
          clientSecret: '',
          password: '',
        } : undefined,
      };
    case 'digest':
      return {
        type: 'digest',
        digest: auth.digest ? { ...auth.digest, password: '' } : undefined,
      };
    case 'awsv4':
      return {
        type: 'awsv4',
        awsv4: auth.awsv4 ? { ...auth.awsv4, secretAccessKey: '', sessionToken: '' } : undefined,
      };
    case 'ntlm':
      return {
        type: 'ntlm',
        ntlm: auth.ntlm ? { ...auth.ntlm, password: '' } : undefined,
      };
    default:
      return { type: 'none' };
  }
}

/** Bản request an toàn để persist — auth secrets bị xóa. */
export function stripRequestSecrets<T extends ApiRequest>(req: T): T {
  return { ...req, auth: stripAuth(req.auth) };
}
