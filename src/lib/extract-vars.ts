import type { ApiRequest } from '../types/api';

export type VarField = 'url' | 'param' | 'header' | 'body' | 'auth';

export interface Occurrence {
  requestId: string;
  requestName: string;
  field: VarField;
  /** tên header/param/đường dẫn JSON — để gợi ý tên biến */
  label: string;
}

export interface Candidate {
  value: string;
  /** tên biến gợi ý, user sửa được trong bảng duyệt */
  name: string;
  occurrences: Occurrence[];
  /** số request khác nhau có dùng giá trị này */
  requestCount: number;
  looksSecret: boolean;
  origin: boolean;
}

/** Giá trị không bao giờ nên tách thành biến */
const STOP = new Set([
  'application/json', 'text/plain', 'text/html', 'application/x-www-form-urlencoded',
  'multipart/form-data', 'application/xml', 'true', 'false', 'null', 'utf-8', 'gzip',
  'no-cache', 'keep-alive', 'close', 'content-type', 'bearer',
]);

const SECRET_RE = /(token|authoriz|secret|password|passwd|pwd|api[-_]?key|apikey|bearer|cookie|session|access[-_]?key|refresh)/i;

function snake(s: string): string {
  return s
    .replace(/\{\{|\}\}/g, ' ')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 40);
}

function isJwt(v: string): boolean {
  const parts = v.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 8);
}

function looksSecret(name: string, value: string): boolean {
  return SECRET_RE.test(name) || isJwt(value) || /^[A-Za-z0-9+/_-]{24,}=*$/.test(value);
}

/** Tên biến kiểu bí mật (token/authorization/secret…) — mặc định nên mark secret khi tạo lại */
export function looksLikeSecretName(name: string): boolean {
  return SECRET_RE.test(name);
}

/** "https://host:port/seg/..." → "https://host:port" nếu parse được */
function originOf(url: string): string | null {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]+)/.exec(url.trim());
  return m ? m[1] : null;
}

function lastPathSegment(url: string): string {
  const segs = url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '').split(/[/?#]/).filter(Boolean);
  const clean = segs.filter((s) => !/^\d+$/.test(s) && !s.includes('.'));
  return clean[clean.length - 1] ?? '';
}

/** Lá của JSON body: { "data": { "id": "ORD1" } } → [{value:'ORD1', path:'data.id'}] */
function jsonLeaves(text: string, out: { value: string; path: string }[], depth = 0): void {
  if (depth > 6 || out.length > 400) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  const walk = (v: unknown, path: string) => {
    if (path.split('.').length > 7 || out.length > 400) return;
    if (typeof v === 'string' || typeof v === 'number') {
      out.push({ value: String(v), path });
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, `${path}[]`);
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, sub] of Object.entries(v as Record<string, unknown>)) walk(sub, path ? `${path}.${k}` : k);
    }
  };
  walk(parsed, '');
}

function usable(value: string): boolean {
  const v = value.trim();
  if (v.length < 3 || v.length > 300) return false;
  if (v.includes('{{') || v.includes('}}')) return false;
  if (STOP.has(v.toLowerCase())) return false;
  if (/^[\d.,\s-]+$/.test(v)) return false; // số thuần / ngày tháng
  if (/\s/.test(v) && v.length > 60) return false; // câu dài
  return true;
}

/** Thu thập mọi giá trị có thể tách biến trong 1 request */
function scanRequest(req: ApiRequest): { value: string; field: VarField; label: string }[] {
  const out: { value: string; field: VarField; label: string }[] = [];
  const url = req.url?.trim();
  if (url) {
    out.push({ value: url, field: 'url', label: lastPathSegment(url) || 'request_url' });
    const origin = originOf(url);
    if (origin) out.push({ value: origin, field: 'url', label: 'base_url' });
  }
  for (const kv of req.params ?? []) {
    if (kv.enabled !== false && usable(kv.value)) out.push({ value: kv.value.trim(), field: 'param', label: kv.key || 'param' });
  }
  for (const kv of req.headers ?? []) {
    if (kv.enabled !== false && usable(kv.value)) out.push({ value: kv.value.trim(), field: 'header', label: kv.key || 'header' });
  }
  if (req.bodyType !== 'none' && (req.body ?? '').trim()) {
    const leaves: { value: string; path: string }[] = [];
    jsonLeaves(req.body, leaves);
    if (leaves.length) {
      for (const l of leaves) out.push({ value: l.value, field: 'body', label: l.path.split('.').pop() ?? 'body' });
    } else if (usable(req.body)) {
      out.push({ value: req.body.trim(), field: 'body', label: 'body' });
    }
  }
  const a = req.auth;
  if (a) {
    if (usable(a.token ?? '')) out.push({ value: a.token!.trim(), field: 'auth', label: 'auth_token' });
    if (usable(a.username ?? '')) out.push({ value: a.username!.trim(), field: 'auth', label: 'auth_username' });
    if (usable(a.password ?? '')) out.push({ value: a.password!.trim(), field: 'auth', label: 'auth_password' });
    if (usable(a.apiKey ?? '')) out.push({ value: a.apiKey!.trim(), field: 'auth', label: 'api_key' });
  }
  return out.filter((s) => usable(s.value));
}

/**
 * Quét nhiều request → danh sách ứng viên tách biến, sắp theo "đáng tách" giảm dần:
 * giữ giá trị xuất hiện ≥2 lần, hoặc chỉ 1 lần nhưng là base URL / token.
 */
export function collectCandidates(requests: ApiRequest[]): Candidate[] {
  const groups = new Map<string, Occurrence[]>();
  const labels = new Map<string, { field: VarField; label: string }>();

  for (const req of requests) {
    for (const hit of scanRequest(req)) {
      const key = hit.value;
      const list = groups.get(key) ?? [];
      if (!list.some((o) => o.requestId === req.id && o.field === hit.field && o.label === hit.label)) {
        list.push({ requestId: req.id, requestName: req.name, field: hit.field, label: hit.label });
      }
      groups.set(key, list);
      if (!labels.has(key)) labels.set(key, { field: hit.field, label: hit.label });
    }
  }

  const usedNames = new Set<string>();
  const nameFor = (value: string, field: VarField, label: string): string => {
    const origin = originOf(value);
    let base = '';
    if (origin && value.trim() === origin) base = 'base_url';
    else if (field === 'url') base = snake(lastPathSegment(value) || 'request') + '_url';
    else base = snake(label || field);
    if (!base) base = field === 'body' ? 'body_value' : 'var';
    let name = base;
    let i = 2;
    while (usedNames.has(name)) name = `${base}_${i++}`;
    usedNames.add(name);
    return name;
  };

  const out: Candidate[] = [];
  for (const [value, occ] of groups) {
    const meta = labels.get(value)!;
    const origin = !!originOf(value) && value.trim() === originOf(value)!;
    const secret = looksSecret(meta.label, value);
    if (occ.length < 2 && !origin && !secret) continue;
    out.push({
      value,
      name: nameFor(value, meta.field, meta.label),
      occurrences: occ,
      requestCount: new Set(occ.map((o) => o.requestId)).size,
      looksSecret: secret,
      origin,
    });
  }

  return out.sort((a, b) => {
    if (a.origin !== b.origin) return a.origin ? -1 : 1;
    if (b.occurrences.length !== a.occurrences.length) return b.occurrences.length - a.occurrences.length;
    return a.value.localeCompare(b.value);
  });
}

export interface Pick {
  name: string;
  value: string;
}export interface ApplyResult {
  /** map requests đã thay {{name}} — đưa thẳng vào store */
  requests: Record<string, ApiRequest>;
  /** số vị trí đã thay */
  positions: number;
  /** số request bị đụng tới */
  touched: number;
}

/**
 * Thay giá trị thật bằng `{{name}}` trong mọi request.
 * Thay theo độ dài giá trị giảm dần để base URL không "ăn" mất phần URL đã tách trước đó.
 */
export function applyExtraction(
  all: Record<string, ApiRequest>,
  ids: string[],
  picks: Pick[],
): ApplyResult {
  const sorted = [...picks].sort((a, b) => b.value.length - a.value.length);
  const requests: Record<string, ApiRequest> = { ...all };
  let positions = 0;
  let touched = 0;

  const swap = (txt: string | undefined): string | undefined => {
    if (!txt) return txt;
    let next = txt;
    for (const p of sorted) {
      if (!next.includes(p.value)) continue;
      const parts = next.split(p.value);
      positions += parts.length - 1;
      next = parts.join(`{{${p.name}}}`);
    }
    return next === txt ? txt : next;
  };

  for (const id of ids) {
    const req = all[id];
    if (!req) continue;
    const before = positions;
    const url = swap(req.url);
    const body = swap(req.body);
    const params = (req.params ?? []).map((kv) => ({ ...kv, value: swap(kv.value)! }));
    const headers = (req.headers ?? []).map((kv) => ({ ...kv, value: swap(kv.value)! }));
    const a = req.auth;
    const auth = a
      ? { ...a, token: swap(a.token), username: swap(a.username), password: swap(a.password), apiKey: swap(a.apiKey) }
      : a;
    if (positions !== before) {
      touched++;
      requests[id] = { ...req, url: url ?? req.url, body: body ?? req.body, params, headers, auth };
    }
  }

  return { requests, positions, touched };
}

export interface VarUsage {
  name: string;
  /** số lần xuất hiện `{{name}}` trong phạm vi quét */
  occurrences: number;
  /** số request khác nhau có dùng */
  requestCount: number;
}

/**
 * Liệt kê mọi `{{ten_bien}}` được các request đang dùng — để đối chiếu xem biến nào
 * chưa có trong môi trường (sau khi tách biến rồi xoá nhầm, hoặc import collection từ Postman).
 */
export function collectVarUsages(requests: ApiRequest[]): VarUsage[] {
  const re = /\{\{\s*([\w.-]+)\s*\}\}/g;
  const byName = new Map<string, { occurrences: number; ids: Set<string> }>();
  const feed = (id: string, txt?: string) => {
    if (!txt) return;
    for (const m of txt.matchAll(re)) {
      const cur = byName.get(m[1]) ?? { occurrences: 0, ids: new Set<string>() };
      cur.occurrences++;
      cur.ids.add(id);
      byName.set(m[1], cur);
    }
  };

  for (const r of requests) {
    feed(r.id, r.url);
    feed(r.id, r.body);
    feed(r.id, r.preRequest);
    feed(r.id, r.tests);
    for (const kv of r.params ?? []) { feed(r.id, kv.key); feed(r.id, kv.value); }
    for (const kv of r.headers ?? []) { feed(r.id, kv.key); feed(r.id, kv.value); }
    const a = r.auth;
    if (a) for (const v of [a.token, a.username, a.password, a.apiKey, a.apiKeyName]) feed(r.id, v);
  }

  return [...byName.entries()]
    .map(([name, v]) => ({ name, occurrences: v.occurrences, requestCount: v.ids.size }))
    .sort((a, b) => b.occurrences - a.occurrences || a.name.localeCompare(b.name));
}
