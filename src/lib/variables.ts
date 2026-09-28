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
