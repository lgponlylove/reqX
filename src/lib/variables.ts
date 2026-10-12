import type { ApiRequest, Collection } from '../types/api';

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
 */
export function countVarRefs(
  key: string,
  requests: Record<string, ApiRequest>,
  collections: Collection[],
): number {
  const needle = `{{${key}}}`;
  const has = (txt?: string) => (txt ?? '').includes(needle);
  let n = 0;
  for (const r of Object.values(requests)) {
    if (
      has(r.url) || has(r.body) || has(r.preRequest) || has(r.tests) ||
      (r.params ?? []).some((kv) => has(kv.key) || has(kv.value)) ||
      (r.headers ?? []).some((kv) => has(kv.key) || has(kv.value)) ||
      has(r.auth?.token) || has(r.auth?.username) || has(r.auth?.password) ||
      has(r.auth?.apiKey) || has(r.auth?.apiKeyName)
    ) n++;
  }
  return n + collections.filter(
    (c) =>
      has(c.preRequest) || has(c.tests) ||
      (c.folders ?? []).some((f) => has(f.preRequest) || has(f.tests)),
  ).length;
}
