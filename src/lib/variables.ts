import type { ApiRequest, Collection, KeyValue } from '../types/api';

/** Thay thế {{var}} bằng giá trị từ environment + global. */
export function resolveVariables(
  input: string,
  envVars: Record<string, string>,
  globalVars: Record<string, string> = {},
): { resolved: string; missing: string[] } {
  const missing = new Set<string>();
  const resolved = input.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, name: string) => {
    if (name in envVars) return envVars[name];
    if (name in globalVars) return globalVars[name];
    missing.add(name);
    return _m; // giữ nguyên để user thấy biến thiếu
  });
  return { resolved, missing: [...missing] };
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Đếm số nơi đang tham chiếu `{{key}}` — cùng tập trường mà renameVarRefs() xử lý,
 * dùng để hiển thị "biến này đang được dùng ở bao nhiêu nơi" trong UI.
 * `extra` = các chuỗi khác cũng được sync khi đổi tên (giá trị của biến khác),
 * tính mỗi chuỗi một lần cho khớp với những gì rename thực sự làm.
 */
export function countVarRefs(
  key: string,
  requests: Record<string, ApiRequest>,
  collections: Collection[],
  extra: string[] = [],
): number {
  let n = 0;
  for (const r of Object.values(requests)) if (requestHasVarRef(key, r)) n++;
  n += collections.filter(
    (c) =>
      hasVarRef(key, c.preRequest) || hasVarRef(key, c.tests) ||
      (c.folders ?? []).some((f) => hasVarRef(key, f.preRequest) || hasVarRef(key, f.tests)),
  ).length;
  return n + extra.filter((txt) => hasVarRef(key, txt)).length;
}

function keySource(key: string): string {
  return key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `{{key}}` có thật sự nằm trong chuỗi không — chấp nhận khoảng trắng thừa
 * (`{{ key }}`) vì `resolveVariables()` cũng đọc được dạng đó.
 */
export function hasVarRef(key: string, txt?: string): boolean {
  return !!txt && new RegExp(`\\{\\{\\s*${keySource(key)}\\s*\\}\\}`).test(txt);
}

/** Thay mọi `{{key}}` (kể cả có khoảng trắng) bằng `{{newKey}}`. */
export function renameVarRef(txt: string | undefined, key: string, newKey: string): string | undefined {
  if (!txt) return txt;
  return txt.replace(new RegExp(`\\{\\{\\s*${keySource(key)}\\s*\\}\\}`, 'g'), `{{${newKey}}}`);
}

/** Các trường text của auth có thể chứa `{{var}}` — kể cả cấu hình OAuth2 lồng trong auth. */
const AUTH_TEXT_FIELDS = ['token', 'username', 'password', 'apiKey', 'apiKeyName'] as const;
const OAUTH_TEXT_FIELDS = ['token', 'accessToken', 'refreshToken', 'clientId', 'clientSecret', 'username', 'password', 'tokenUrl', 'authUrl', 'redirectUri', 'autoSaveVar'] as const;

/** Một request có tham chiếu `{{key}}` ở bất kỳ trường nào không? */
export function requestHasVarRef(key: string, req: ApiRequest): boolean {
  const at = req.auth;
  return (
    hasVarRef(key, req.url) || hasVarRef(key, req.body) ||
    hasVarRef(key, req.preRequest) || hasVarRef(key, req.tests) ||
    (req.params ?? []).some((kv) => hasVarRef(key, kv.key) || hasVarRef(key, kv.value)) ||
    (req.headers ?? []).some((kv) => hasVarRef(key, kv.key) || hasVarRef(key, kv.value)) ||
    (!!at && (AUTH_TEXT_FIELDS.some((f) => hasVarRef(key, at[f])) ||
      (!!at.oauth2 && OAUTH_TEXT_FIELDS.some((f) => hasVarRef(key, at.oauth2![f])))))
  );
}

/**
 * Bản sao request đã đổi `{{oldKey}}` → `{{newKey}}` ở mọi trường text
 * (URL, params, headers, body, script, auth + cấu hình OAuth2). Trả nguyên object
 * cũ khi không có tham chiếu nào — giữ so sánh tham chiếu cho UI.
 */
export function renameVarInRequest(req: ApiRequest, oldKey: string, newKey: string): ApiRequest {
  if (!requestHasVarRef(oldKey, req)) return req;
  const swap = (txt?: string) => renameVarRef(txt, oldKey, newKey);
  const swapKv = (list: KeyValue[]) =>
    list.map((kv) => ({ ...kv, key: swap(kv.key) ?? kv.key, value: swap(kv.value) ?? kv.value }));
  const out: ApiRequest = {
    ...req,
    url: swap(req.url) ?? req.url,
    body: swap(req.body) ?? req.body,
    preRequest: swap(req.preRequest),
    tests: swap(req.tests),
    params: swapKv(req.params ?? []),
    headers: swapKv(req.headers ?? []),
  };
  const a = req.auth;
  if (a) {
    const nextAuth = { ...a };
    for (const f of AUTH_TEXT_FIELDS) if (a[f]) nextAuth[f] = swap(a[f]);
    if (a.oauth2) {
      const nextOAuth = { ...a.oauth2 };
      for (const f of OAUTH_TEXT_FIELDS) if (a.oauth2[f]) nextOAuth[f] = swap(a.oauth2[f]);
      nextAuth.oauth2 = nextOAuth;
    }
    out.auth = nextAuth;
  }
  return out;
}
