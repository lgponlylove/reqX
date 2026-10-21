import type { ApiRequest, AuthConfig, Collection } from '../types/api';
import { findCollectionOf } from './script-chain';

const NO_AUTH: AuthConfig = { type: 'none' };

/** Collection chứa request này đang đặt auth thật (không tính 'none'/'inherit'). */
export function parentAuthOf(
  collections: Collection[],
  req: ApiRequest,
): { collection: Collection; auth: AuthConfig } | null {
  const col = findCollectionOf(collections, req);
  const auth = col?.auth;
  if (!col || !auth) return null;
  if (auth.type === 'none' || auth.type === 'inherit') return null;
  return { collection: col, auth };
}

/**
 * Auth thật sự dùng khi gửi. Request thắng; 'inherit' lấy của collection;
 * collection không đặt auth thì coi như No Auth.
 */
export function resolveRequestAuth(collections: Collection[], req: ApiRequest): AuthConfig {
  const own = req.auth ?? NO_AUTH;
  if (own.type !== 'inherit') return own;
  return parentAuthOf(collections, req)?.auth ?? NO_AUTH;
}

/**
 * Bản copy đã giải quyết auth để đưa vào sendRequest — bản lưu trong store không bị đổi,
 * nên "No Auth" của một request không bỗng thành Basic trên đĩa.
 */
export function applyResolvedAuth(collections: Collection[], req: ApiRequest): ApiRequest {
  const auth = resolveRequestAuth(collections, req);
  return auth === req.auth ? req : { ...req, auth };
}

/** Một dòng đủ rõ cho UI: auth nào sẽ thật sự đi, và lấy từ đâu. */
export function describeAuth(auth: AuthConfig, hasTokenValue = true): string {
  switch (auth.type) {
    case 'bearer':
      return hasTokenValue ? 'Bearer Token' : 'Bearer Token (chưa đặt token)';
    case 'basic':
      return `Basic (username: ${auth.username?.trim() || '—'})`;
    case 'apikey':
      return `API Key → ${auth.apiKeyIn === 'query' ? 'query' : 'header'} "${auth.apiKeyName || 'X-API-Key'}"`;
    case 'oauth2':
      return `OAuth 2.0 (${auth.oauth2?.grantType ?? 'client_credentials'})`;
    case 'digest':
      return 'Digest';
    case 'awsv4':
      return 'AWS SigV4';
    case 'ntlm':
      return 'NTLM';
    case 'inherit':
      return 'Kế thừa collection';
    default:
      return 'No Auth';
  }
}
