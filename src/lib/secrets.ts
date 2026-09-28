import type { ApiRequest, AuthConfig } from '../types/api';

/** Xóa secrets khỏi auth — chỉ giữ lại cấu trúc (type, tên key), không giữ giá trị. */
export function stripAuth(auth: AuthConfig): AuthConfig {
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', token: '' };
    case 'basic':
      return { type: 'basic', username: auth.username ?? '', password: '' };
    case 'apikey':
      return { type: 'apikey', apiKey: '', apiKeyIn: auth.apiKeyIn, apiKeyName: auth.apiKeyName };
    default:
      return { type: 'none' };
  }
}

/** Bản request an toàn để persist — auth secrets bị xóa. */
export function stripRequestSecrets<T extends ApiRequest>(req: T): T {
  return { ...req, auth: stripAuth(req.auth) };
}
