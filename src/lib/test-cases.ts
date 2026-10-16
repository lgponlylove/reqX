import type { ApiRequest, Collection } from '../types/api';
import { uid } from './variables';
import { toCurl } from './codegen';
import { runOneRequest, type RunnerHooks } from './runner';
import { maskSensitiveBody, maskUrl } from './mask';

/** Giá trị đặc biệt người dùng/AI điền vào ô dữ liệu để xóa field hoặc gửi null. */
export const OMIT_VALUE = '<<xóa field>>';
export const NULL_VALUE = '<<null>>';

export type CaseGroup = 'valid' | 'missing' | 'null' | 'type' | 'boundary' | 'text' | 'security' | 'enum';

export const GROUP_LABEL: Record<CaseGroup, string> = {
  valid: 'Hợp lệ',
  missing: 'Thiếu field',
  null: 'null',
  type: 'Sai kiểu',
  boundary: 'Biên',
  text: 'Ký tự',
  security: 'Bảo mật',
  enum: 'Quét giá trị',
};

export interface TestCaseExpect {
  /** "2xx" | "4xx" | "5xx" | "any" | "200" | "!=200" | ">=400" */
  status: string;
  /** Chuỗi phải xuất hiện trong response body (bỏ trống = không kiểm) */
  contains?: string;
}

export interface TestCase {
  id: string;
  name: string;
  group: CaseGroup;
  /** key = tên field body, hoặc "header:Name" / "query:name" / "url" */
  data: Record<string, string>;
  expect: TestCaseExpect;
  note?: string;
  /** false = bỏ qua khi chạy (mặc định chạy) */
  enabled?: boolean;
}

export interface CaseRunResult {
  caseId: string;
  /** Khớp mong đợi (status + contains + không crash test) */
  pass: boolean;
  expected: string;
  status?: number;
  timeMs?: number;
  /** Lý do ❌ (hoặc mô tả ✅) */
  why: string;
  error?: string;
  body: string;
  curl: string;
}

/** Một field có thể ghi đè trong request. */
interface Target {
  /** key dùng trong TestCase.data */
  key: string;
  label: string;
  type: 'number' | 'string' | 'boolean' | 'array' | 'object';
  value: string;
  /** field nằm trong body JSON */
  inBody: boolean;
}

/* ------------------------------------------------------------------ tách field */

function kindOf(v: unknown): Target['type'] {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (Array.isArray(v)) return 'array';
  if (v && typeof v === 'object') return 'object';
  return 'string';
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Duyệt JSON: vừa lá vừa node chứa (array/object) để test được "mảng rỗng", "object rỗng". */
function leaves(node: unknown, prefix: string, out: { path: string; value: unknown }[], depth = 0): void {
  if (depth > 6 || out.length > 60) return;
  if (Array.isArray(node)) {
    // không tính node gốc (độ rộng 0) — đã có case "body = []" riêng
    if (prefix) out.push({ path: prefix, value: node });
    node.slice(0, 5).forEach((v, i) => leaves(v, prefix ? `${prefix}.${i}` : `${i}`, out, depth + 1));
    return;
  }
  if (node && typeof node === 'object') {
    if (prefix) out.push({ path: prefix, value: node });
    for (const [k, v] of Object.entries(node)) leaves(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
    return;
  }
  if (prefix) out.push({ path: prefix, value: node });
}

const DATE_RE = /(date|time|_at$|birthday|birth)/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?)?$/;
const ID_RE = /(^id$|id$|_id$|code$|no$|symbol$|pattern$)/i;
/** Tên field nghi là bắt buộc — quyết định mong đợi khi thiếu/null/trống là 4xx thay vì "any" */
const REQUIRED_RE = /(id$|^id|_id|no$|code$|symbol$|pattern$|date$|time$|amount|total|price|qty|quantity|status|action|type|token|number|name)/i;

/** Danh sách field ghi đè được: lá body JSON + query + header (không tính header auth). */
export function collectTargets(req: ApiRequest): Target[] {
  const out: Target[] = [];
  const body = (req.body ?? '').trim();
  if (req.bodyType !== 'none' && (body.startsWith('{') || body.startsWith('['))) {
    try {
      const parsed = JSON.parse(body);
      const ls: { path: string; value: unknown }[] = [];
      leaves(parsed, '', ls);
      for (const l of ls) {
        out.push({
          key: l.path,
          label: l.path,
          type: kindOf(l.value),
          value: asText(l.value),
          inBody: true,
        });
      }
    } catch { /* body không phải JSON hợp lệ — chỉ test query/header */ }
  }
  for (const p of req.params ?? []) {
    if (p.enabled && p.key.trim()) out.push({ key: `query:${p.key}`, label: `?${p.key}`, type: 'string', value: p.value, inBody: false });
  }
  for (const h of req.headers ?? []) {
    const k = h.key.trim();
    if (!h.enabled || !k) continue;
    if (/^(authorization|cookie|content-type)$/i.test(k)) continue; // để nhóm bảo mật tự thêm có kiểm soát
    out.push({ key: `header:${k}`, label: `H:${k}`, type: 'string', value: h.value, inBody: false });
  }
  return out;
}

/* ------------------------------------------------------------------ sinh case */

const LONG_TEXT = 'A'.repeat(301);
const VN_TEXT = 'Hoá đơn nhập kho “IOa8” — Hà Nội, Việt Nam';
const INJECT_TEXT = `' OR 1=1-- <script>alert(1)</script>`;

function mk(name: string, group: CaseGroup, key: string, value: string, expect: TestCaseExpect, note?: string): TestCase {
  return { id: uid('tc'), name, group, data: { [key]: value }, expect, note };
}

function isNumeric(v: string): boolean {
  return v.trim() !== '' && !Number.isNaN(Number(v));
}

/**
 * Sinh bộ key test từ cấu trúc request: 1 case hợp lệ + các case cực đoan theo từng field.
 * Case của mỗi field được xoay vòng (mỗi field lấy lần lượt 1 case) để khi chạm max_cases
 * vẫn phủ đủ mọi field, thay vì mới xét hết field đầu tiên.
 */
export function generateCases(req: ApiRequest, maxCases = 40): TestCase[] {
  const targets = collectTargets(req);
  const expectBad: TestCaseExpect = { status: '4xx' };
  const expectOk: TestCaseExpect = { status: '2xx' };
  const limit = Math.max(2, maxCases);

  const baseline: TestCase = {
    id: uid('tc'),
    name: 'Baseline: nguyên dữ liệu hiện tại',
    group: 'valid',
    data: {},
    expect: expectOk,
    note: 'Nếu case này ❌ thì kiểm tra token/môi trường trước khi xét các case sai.',
  };

  const perField: TestCase[][] = [];
  for (const t of targets) {
    const list: TestCase[] = [];
    const push = (c: TestCase) => list.push(c);
    const isDate = DATE_RE.test(t.key) || ISO_DATE_RE.test(t.value);
    // field có vẻ bắt buộc theo tên (id/no/code/amount/date...) → mong đợi 4xx khi trống;
    // field còn lại coi là optional → mong đợi "any" để không báo nhầm lỗi
    const last = t.key.split('.').pop() ?? t.key;
    const required = t.inBody && (isDate || REQUIRED_RE.test(last));
    const blank: TestCaseExpect = required ? { status: '4xx' } : { status: 'any' };
    const optNote = required ? undefined : 'Field có vẻ không bắt buộc — nếu API vẫn 2xx là đúng, muốn chặn thì sửa mong đợi thành 4xx.';

    if (t.inBody) {
      // Nhóm null/rỗng đặt đầu danh sách để không bị cắt khi chạm max_cases
      push(mk(`Thiếu ${t.label}`, 'missing', t.key, OMIT_VALUE, { ...blank },
        `Xóa hẳn key "${t.key}" khỏi body.${optNote ? ' ' + optNote : ''}`));
      push(mk(`null cho ${t.label}`, 'null', t.key, NULL_VALUE, { ...blank }, optNote));
      if (t.type === 'string') {
        push(mk(`Bỏ trống ${t.label}`, 'boundary', t.key, '', { ...blank }, optNote));
        if (required) push(mk(`Chỉ khoảng trắng ${t.label}`, 'boundary', t.key, '   ', { status: '4xx' }, 'Nhiều API chỉ kiểm rỗng mà quên trim — chuỗi dấu cách vẫn qua.'));
      } else if (t.type === 'number' || t.type === 'boolean') {
        push(mk(`Bỏ trống ${t.label} (chuỗi "")`, 'boundary', t.key, '', { status: required ? '4xx' : 'any' },
          'Gửi "" thay vì số/bool — thường phải 400.'));
      } else if (t.type === 'array') {
        push(mk(`Mảng rỗng ${t.label}`, 'null', t.key, '[]', { status: 'any' }, 'Nếu nghiệp vụ bắt buộc ≥ 1 phần tử thì đổi mong đợi thành 4xx.'));
        push(mk(`Mảng chứa null ${t.label}`, 'null', t.key, '[null]', { status: 'any' }));
      } else if (t.type === 'object') {
        push(mk(`Object rỗng ${t.label}`, 'null', t.key, '{}', { ...blank }, optNote));
      }

      if (t.type === 'string') {
        if (isDate) {
          push(mk(`Ngày sai định dạng ${t.label}`, 'type', t.key, '31/12/2026 25:99', expectBad));
          push(mk(`Ngày không tồn tại ${t.label}`, 'type', t.key, '2026-13-45T00:00:00', expectBad));
          push(mk(`Ngày chuỗi lạ ${t.label}`, 'type', t.key, 'khong-phai-ngay', expectBad));
        } else {
          push(mk(`Sai kiểu số ${t.label}`, 'type', t.key, '123abc', { ...blank }));
          push(mk(`Ký tự Việt + ${t.label}`, 'text', t.key, VN_TEXT, { status: 'any' }, 'Kiểm API có lưu/echo đúng Unicode không.'));
          push(mk(`Chuỗi 301 ký tự ${t.label}`, 'boundary', t.key, LONG_TEXT, { status: 'any' }, 'Nếu 200 = API không chặn độ dài.'));
          push(mk(`Chèn ký tự đặc biệt ${t.label}`, 'security', t.key, INJECT_TEXT, { status: 'any' }, 'Không được phép trả 500 hay echo nguyên văn vào SQL.'));
        }
      }
      if (t.type === 'number') {
        push(mk(`Sai kiểu chữ ${t.label}`, 'type', t.key, 'abc', expectBad));
        push(mk(`Số âm ${t.label}`, 'boundary', t.key, '-1', expectBad));
        push(mk(`Bằng 0 ${t.label}`, 'boundary', t.key, '0', { status: 'any' }, 'Nếu 200 = API chấp nhận 0, cân nhắc chặn.'));
        if (ID_RE.test(t.key)) push(mk(`ID không tồn tại ${t.label}`, 'boundary', t.key, '999999999', { status: 'any' }, 'Thường mong đợi 404 hoặc mã nghiệp vụ.'));
        push(mk(`Số rất lớn ${t.label}`, 'boundary', t.key, '99999999999999', { status: 'any' }));
      }
      if (t.type === 'boolean') {
        push(mk(`Kiểu sai cho ${t.label}`, 'type', t.key, 'not-bool', expectBad));
      }
    } else {
      // query / header: giá trị trống thường không làm sập API → "any", người dùng sửa sau nếu bắt buộc
      push(mk(`Bỏ trống ${t.label}`, 'boundary', t.key, '', { status: 'any' }, 'Nhiều API vẫn 200 — sửa thành 4xx nếu nghiệp vụ bắt buộc.'));
      push(mk(`Ký tự đặc biệt ${t.label}`, 'security', t.key, INJECT_TEXT, { status: 'any' }));
    }
    if (list.length) perField.push(list);
  }

  // Các case không gắn với một field cụ thể — xếp ngay sau baseline vì hay lộ lỗi thật
  const specials: TestCase[] = [];
  const action = targets.find((t) => t.inBody && /^(action|type|status|mode)$/i.test(t.key) && isNumeric(t.value));
  if (action) {
    const cur = Math.trunc(Number(action.value));
    for (const v of [0, 1, 2, 3, cur + 10].filter((x, i, a) => x !== cur && a.indexOf(x) === i).slice(0, 4)) {
      specials.push(mk(`${action.key}=${v}`, 'enum', action.key, String(v), { status: 'any' }, `Thử giá trị enum ${v}.`));
    }
  }
  if (req.auth?.type === 'bearer') {
    specials.push(mk('Bearer sai token', 'security', 'header:Authorization', 'Bearer token-khong-hop-le', { status: '401' }));
    specials.push(mk('Không có Authorization', 'security', 'header:Authorization', OMIT_VALUE, { status: '401' }));
  }
  if (req.bodyType === 'json') {
    specials.push(mk('Content-Type sai', 'security', 'header:Content-Type', 'text/plain', { status: 'any' }, 'Nhiều API trả 415 hoặc 500 ở đây.'));
    specials.push(mk('Body = {} (mọi field trống)', 'null', 'body', '{}', { status: '4xx' }, 'Gửi object rỗng — API phải chặn thiếu trường bắt buộc.'));
    specials.push(mk('Bỏ hẳn body', 'null', 'body', OMIT_VALUE, { status: 'any' }, 'Thường 400/415; nếu 200 thì API đang bỏ qua body.'));
  }

  const out: TestCase[] = [baseline];
  for (const s of specials) {
    if (out.length >= limit) break;
    out.push(s);
  }
  for (let round = 0; out.length < limit; round++) {
    let added = false;
    for (const list of perField) {
      if (round >= list.length) continue;
      if (out.length >= limit) break;
      out.push(list[round]);
      added = true;
    }
    if (!added) break;
  }
  return out;
}

/* ------------------------------------------------------------------ áp case vào request */

type KeyKind = 'url' | 'header' | 'query' | 'body' | 'field';

function splitKey(k: string): { kind: KeyKind; path: string } {
  const t = k.trim();
  if (/^url$/i.test(t)) return { kind: 'url', path: '' };
  if (/^body$/i.test(t)) return { kind: 'body', path: '' };
  const m = /^(header|query|body)\s*:\s*(.*)$/i.exec(t);
  if (m) {
    const kind = m[1].toLowerCase() as KeyKind;
    return { kind, path: m[2].trim() };
  }
  return { kind: 'field', path: t };
}

function parentOf(obj: Record<string, unknown> | unknown[], path: string[]): { holder: any; last: string | number } | null {
  let cur: any = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (cur == null) return null;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx)) return null;
      cur = cur[idx];
    } else if (typeof cur === 'object') {
      cur = cur[seg];
    } else return null;
  }
  const last = path[path.length - 1];
  if (cur == null || typeof cur !== 'object') return null;
  return { holder: cur, last: Array.isArray(cur) ? Number(last) : last };
}

function setLeaf(root: unknown, pathStr: string, value: unknown, remove: boolean): unknown {
  const path = pathStr.split('.').filter(Boolean);
  if (!path.length || root == null || typeof root !== 'object') return root;
  const at = parentOf(root as any, path);
  if (!at) return root;
  if (remove) {
    if (Array.isArray(at.holder)) {
      if (Number.isInteger(at.last as number)) delete at.holder[at.last as number];
    } else delete at.holder[at.last as string];
    return root;
  }
  if (Array.isArray(at.holder)) {
    if (Number.isInteger(at.last as number)) at.holder[at.last as number] = value;
    return root;
  }
  at.holder[at.last as string] = value;
  return root;
}

function hasLeaf(root: unknown, pathStr: string): boolean {
  const path = pathStr.split('.').filter(Boolean);
  let cur: any = root;
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return false;
    cur = Array.isArray(cur) ? cur[Number(seg)] : cur[seg];
  }
  return cur !== undefined;
}

function coerce(raw: string, old: unknown): unknown {
  if (raw === NULL_VALUE) return null;
  const t = raw.trim();
  if ((Array.isArray(old) || (old && typeof old === 'object')) && (t.startsWith('{') || t.startsWith('['))) {
    try { return JSON.parse(t); } catch { /* để nguyên chuỗi — đó chính là case sai kiểu */ }
  }
  if (typeof old === 'number' && t !== '' && !Number.isNaN(Number(t))) return Number(t);
  if (typeof old === 'boolean' && /^(true|false)$/i.test(t)) return /^true$/i.test(t);
  return raw;
}

/** Bản sao request với dữ liệu của case đã ghi đè (request gốc không bị sửa). */
export function applyCase(base: ApiRequest, c: TestCase): ApiRequest {
  const r: ApiRequest = {
    ...base,
    params: (base.params ?? []).map((p) => ({ ...p })),
    headers: (base.headers ?? []).map((h) => ({ ...h })),
  };
  const bodyText = (base.body ?? '').trim();
  let bodyObj: unknown = null;
  let bodyJson = false;
  if (base.bodyType !== 'none' && (bodyText.startsWith('{') || bodyText.startsWith('['))) {
    try {
      bodyObj = JSON.parse(bodyText);
      bodyJson = true;
    } catch { /* giữ body nguyên văn nếu không parse được */ }
  }

  for (const [rawKey, rawVal] of Object.entries(c.data)) {
    const key = rawKey.trim();
    if (!key) continue;
    const { kind, path } = splitKey(key);
    const remove = rawVal === OMIT_VALUE;

    if (kind === 'url') {
      if (remove) continue;
      r.url = rawVal;
      continue;
    }
    if (kind === 'header' || kind === 'query') {
      const list = kind === 'header' ? r.headers : r.params;
      const i = list.findIndex((kv) => kv.key.toLowerCase() === path.toLowerCase());
      if (remove) {
        if (i >= 0) list.splice(i, 1);
        continue;
      }
      if (i >= 0) list[i] = { ...list[i], value: rawVal, enabled: true };
      else list.push({ id: uid('kv'), key: path, value: rawVal, enabled: true });
      continue;
    }
    if (kind === 'body' && path === '') {
      // "body" không kèm đường dẫn = thay cả body: gửi {}, [], hoặc bỏ hẳn body
      if (remove) {
        r.body = '';
        bodyJson = false;
      } else {
        const t = rawVal.trim();
        let parsed: unknown = undefined;
        try { parsed = JSON.parse(t); } catch { parsed = undefined; }
        if (parsed === undefined) {
          r.body = rawVal;
          bodyJson = false;
        } else {
          bodyObj = parsed;
          bodyJson = typeof parsed === 'object' && parsed !== null && (t.startsWith('{') || t.startsWith('['));
          r.body = bodyJson ? JSON.stringify(parsed, null, 2) : rawVal;
        }
      }
      continue;
    }
    if (!bodyJson) continue;
    const fieldPath = kind === 'field'
      ? (hasLeaf(bodyObj, path) ? path : undefined)
      : path;
    if (kind === 'field' && fieldPath === undefined) {
      // tên không có trong body → coi là query param để không âm thầm mất dữ liệu
      const i = r.params.findIndex((kv) => kv.key.toLowerCase() === path.toLowerCase());
      if (remove) { if (i >= 0) r.params.splice(i, 1); continue; }
      if (i >= 0) r.params[i] = { ...r.params[i], value: rawVal, enabled: true };
      else r.params.push({ id: uid('kv'), key: path, value: rawVal, enabled: true });
      continue;
    }
    if (fieldPath === undefined) continue;
    const old = hasLeaf(bodyObj, fieldPath) ? ((): unknown => {
      const seg = fieldPath.split('.');
      const at = parentOf(bodyObj as any, seg);
      return at ? at.holder[at.last as any] : undefined;
    })() : undefined;
    bodyObj = setLeaf(bodyObj, fieldPath, remove ? null : coerce(rawVal, old), remove);
  }

  if (bodyJson) r.body = JSON.stringify(bodyObj, null, 2);
  return r;
}

/* ------------------------------------------------------------------ so khớp mong đợi */

export function statusMatches(spec: string, status?: number): boolean {
  const s = (spec ?? '').trim().toLowerCase().replace(/\s/g, '');
  if (!s || s === 'any') return true;
  if (status == null) return false;
  let m = /^(\d)(x){2}$/.exec(s);
  if (m) return Math.floor(status / 100) === Number(m[1]);
  m = /^(?:[!<>]=?)(\d+)$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (s.startsWith('!=')) return status !== n;
    if (s.startsWith('>=')) return status >= n;
    if (s.startsWith('>')) return status > n;
    if (s.startsWith('<=')) return status <= n;
    return status < n;
  }
  if (/^\d+$/.test(s)) return status === Number(s);
  return false;
}

export function describeExpect(e: TestCaseExpect): string {
  const st = (e.status ?? '').trim() || 'any';
  return e.contains?.trim() ? `${st} + chứa "${e.contains.trim().slice(0, 40)}"` : st;
}

/** Phán xét 1 kết quả chạy theo mong đợi của case. */
export function judge(
  c: TestCase,
  res: { ok: boolean; status?: number; error?: string; testsPassed: number; testsTotal: number; response?: { body: string } },
): { pass: boolean; why: string } {
  const expected = describeExpect(c.expect);
  if (res.error && res.status == null && !/^(HTTP|\d)/.test(res.error)) {
    return { pass: false, why: `Không gửi được: ${res.error.slice(0, 200)}` };
  }
  if (!statusMatches(c.expect.status, res.status)) {
    return { pass: false, why: `Mong đợi ${c.expect.status || 'any'}, nhận ${res.status ?? '—'}` };
  }
  const needle = (c.expect.contains ?? '').trim();
  if (needle) {
    const body = res.response?.body ?? '';
    if (!body.includes(needle)) return { pass: false, why: `Status khớp ${res.status} nhưng body không chứa "${needle.slice(0, 40)}"` };
  }
  if (res.testsTotal > 0 && res.testsPassed < res.testsTotal) {
    return { pass: false, why: `pm.test fail ${res.testsPassed}/${res.testsTotal}: ${(res.error ?? '').slice(0, 150)}` };
  }
  return { pass: true, why: `${res.status} khớp ${c.expect.status || 'any'}${needle ? ` + chứa "${needle.slice(0, 30)}"` : ''}` };
}

const flatten = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Che secret trong curl trước khi ghi ra file. */
export function maskCurl(curl: string): string {
  return curl
    .replace(/(-H\s+["']?)(authorization|cookie|x-api-key|api-key)\s*:\s*[^"'\n]+/gi, (_m, p1, p2) => `${p1}${p2}: ***`)
    .replace(/(--?[bu]\s+["'])([^"'\s]+:\/\/[^"'\s@]+):[^"'\s@]+@/gi, '$1$2:***@')
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]{6,}/gi, '$1***')
    .replace(/(JSESSIONID=)[A-Za-z0-9]{6,}/gi, '$1***')
    // URL trong curl cũng mang credential: ?token=abc&api_key=xyz
    .replace(/(["'])(https?:\/\/[^"'\s]+)\1/gi, (_m, q, u) => `${q}${maskUrl(u)}${q}`)
    // body trong --data*/--form vẫn là text thường — che theo key như mọi output khác
    .replace(/(--(?:data|data-raw|data-binary|data-urlencode|form|json)\s+)(["'])([\s\S]*?)\2/gi, (_m, p1, q, body) => `${p1}${q}${maskSensitiveBody(body)}${q}`);
}

/* ------------------------------------------------------------------ chạy bộ case */

export interface RunCasesOpts {
  timeoutMs?: number;
  delayMs?: number;
  signal?: AbortSignal;
  collections?: Collection[];
  onResult?: (c: TestCase, r: CaseRunResult) => void;
  /** Số case chạy song song cùng lúc (mặc định 5). */
  concurrency?: number;
}

export async function runTestCases(
  base: ApiRequest,
  cases: TestCase[],
  hooks: RunnerHooks,
  opts: RunCasesOpts = {},
): Promise<CaseRunResult[]> {
  const out: CaseRunResult[] = [];
  const { envVars, globals } = hooks.getVars();
  const active = cases.filter((x) => x.enabled !== false);
  const limit = Math.max(1, Math.min(20, opts.concurrency ?? 5));

  // Pool bất đồng bộ: chạy tối đa `limit` case cùng lúc.
  let cursor = 0;
  async function worker() {
    while (!opts.signal?.aborted && cursor < active.length) {
      const idx = cursor++;
      const c = active[idx];
      const clone = applyCase(base, c);
      const r = await runOneRequest(clone, hooks, opts.timeoutMs ?? 30000, opts.signal, undefined, opts.collections);
      const v = judge(c, r);
      const row: CaseRunResult = {
        caseId: c.id,
        pass: v.pass,
        expected: describeExpect(c.expect),
        status: r.status,
        timeMs: r.timeMs,
        why: v.why,
        error: r.error?.slice(0, 300),
        // Che credential ngay lúc tạo kết quả: body này đi vào cả bảng UI, CSV lẫn HTML report.
        body: maskSensitiveBody(flatten(r.response?.body ?? '')).slice(0, 1000),
        curl: maskCurl(toCurl(clone, envVars, globals)),
      };
      out.push(row);
      opts.onResult?.(c, row);
      if (opts.delayMs && opts.delayMs > 0 && !opts.signal?.aborted) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, opts.delayMs);
          opts.signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
        });
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return out;
}

/* ------------------------------------------------------------------ xuất CSV (mở bằng Excel) */

function esc(s: string | number | undefined): string {
  const t = String(s ?? '');
  return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function dataPreview(c: TestCase): string {
  const e = Object.entries(c.data);
  if (!e.length) return '(nguyên bản)';
  return e.map(([k, v]) => `${k}=${v}`).join(' | ');
}

const CSV_HEAD = [
  '#', 'Ten case', 'Nhom', 'Du lieu thay the', 'Mong doi', 'Status', 'Ket luan', 'Ly do',
  'Thoi gian (ms)', 'Loi', 'Response (tom tat)', 'curl (da che secret)',
];

/** Một dòng = một case. Có BOM để Excel mở đúng tiếng Việt. */
export function casesToCsv(base: ApiRequest, cases: TestCase[], results: Record<string, CaseRunResult>): string {
  const lines = cases.map((c, i) => {
    const r = results[c.id];
    return [
      i + 1, c.name, GROUP_LABEL[c.group], dataPreview(c), c.expect.status || 'any',
      r?.status ?? '', r ? (r.pass ? 'DAT' : 'FAIL') : 'chua chay', r?.why ?? '',
      r?.timeMs ?? '', r?.error ?? '', r?.body ?? '', r?.curl ?? '',
    ].map(esc).join(',');
  });
  const meta = [
    `# Test case: ${base.name} — ${base.method} ${maskUrl(base.url)}`,
    `# Sinh luc: ${new Date().toLocaleString('vi-VN')} — ${cases.length} case`,
    `# Mong doi: status = 2xx/4xx/any/200/!=200; Cot "Ket luan" DAT = khop mong doi`,
  ].join('\n');
  return '\uFEFF' + meta + '\n' + CSV_HEAD.map(esc).join(',') + '\n' + lines.join('\n') + '\n';
}

export function csvFileName(base: ApiRequest): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const slug = base.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'request';
  return `reqx-testcases-${slug}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.csv`;
}
