import type { ApiRequest, Collection, KeyValue } from '../types/api';
import { collectTargets, GROUP_LABEL, maskCurl, type CaseRunResult, type TestCase } from './test-cases';
import { maskSensitiveBody, maskUrl } from './mask';
import { looksLikeSecretName } from './extract-vars';
import { toCurl } from './codegen';
import { resolveRequestAuth } from './auth-chain';

/**
 * Sinh tài liệu API (Markdown) từ collection/request đang có trong app.
 * Hàm thuần: chỉ đổi dữ liệu thành chuỗi nên test được mà không cần filesystem.
 * Quy tắc che secret giống hệt báo cáo chạy test — giá trị credential không bao
 * giờ đi ra file, kể cả file .md anh commit lên repo.
 * Mọi nhãn đều lấy từ `LABELS[lang]` để file tài liệu theo đúng ngôn ngữ đang chọn.
 */

export type DocsLang = 'vi' | 'en';

export interface DocsEnv {
  name?: string;
  variables: Record<string, string>;
  globals?: Record<string, string>;
}

/** Một lần gửi trong lịch sử — dùng làm mẫu response (đã che secret khi lưu). */
export interface DocsSample {
  requestId?: string;
  method?: string;
  url?: string;
  status: number;
  body: string;
  timeMs?: number;
}

/** Only what the docs need from a flow, so the renderer stays free of stores. */
export interface DocsFlow {
  name: string;
  steps: { requestId: string; extract: { name: string }[] }[];
}

/** Bộ Key test vừa chạy trong phiên này (store không lưu ra đĩa). */
export interface DocsTestRun {
  requestId: string;
  cases: TestCase[];
  results: Record<string, CaseRunResult>;
}

export interface DocsInput {
  lang?: DocsLang;
  env?: DocsEnv;
  folderId?: string;
  samples?: DocsSample[];
  flows?: DocsFlow[];
  testRun?: DocsTestRun;
  now?: Date;
  /** Bật/tắt bảng nguồn "Phần nào ReqX lấy từ đâu" (mặc định true trong lib thuần, false khi xuất từ UI) */
  includeProvenance?: boolean;
  /** Để tài liệu hiện đúng auth kế thừa từ collection khi gửi (lib/auth-chain.ts) */
  collections?: Collection[];
}

interface LabelSet {
  generatedBy: string;
  environment: string;
  updated: string;
  scope: string;
  secretNote: string;
  toc: string;
  noRequests: string;
  url: string;
  noUrl: string;
  headers: string;
  query: string;
  body: string;
  noBody: string;
  responseOk: string;
  response401: string;
  noSample: string;
  extractedVars: string;
  curl: string;
  keyTest: string;
  keyTestNone: string;
  keyTestSummary: string;
  colKey: string;
  colValue: string;
  colRequired: string;
  colField: string;
  colType: string;
  colDesc: string;
  colGroup: string;
  colCase: string;
  colExpect: string;
  colActual: string;
  colResult: string;
  notRun: string;
  emptyValue: string;
  secretHidden: string;
  example: string;
  usesVar: string;
  noData: string;
  auth: string;
  authNone: string;
  authBearer: string;
  authBasic: string;
  authApikey: string;
  authOauth2: string;
  authOther: string;
  authInHeader: string;
  authInQuery: string;
  hiddenNote: string;
  noDescription: string;
  hasPreScript: string;
  hasTestScript: string;
  requiredDeriveNote: string;
  envVars: string;
  envVarsSet: string;
  envVarsMissing: string;
  envVarsNone: string;
  provenance: string;
  provenanceColWhat: string;
  provenanceColSource: string;
  noEnvName: string;
  untitled: string;
  prov: { what: string; source: string }[];
}

const LABELS: Record<DocsLang, LabelSet> = {
  vi: {
    generatedBy: 'Sinh tự động bởi ReqX',
    environment: 'Môi trường',
    updated: 'Cập nhật',
    scope: 'Phạm vi',
    secretNote: 'Token / mật khẩu / API key **đã ẩn** trong tài liệu này.',
    toc: 'Mục lục',
    noRequests: '_Chưa có request nào ở phạm vi này._',
    url: 'URL',
    noUrl: '(chưa đặt URL)',
    headers: 'Headers',
    query: 'Query parameters',
    body: 'Body',
    noBody: '_Không có body._',
    responseOk: 'Response',
    response401: 'Response 401',
    noSample: '_Chưa có mẫu — chạy request trong app để lấy response thật._',
    extractedVars: 'Biến được trích ra',
    curl: 'cURL',
    keyTest: 'Kết quả Key test gần nhất',
    keyTestNone: '_Chưa chạy Key test trong phiên này (kết quả không lưu ra đĩa)._',
    keyTestSummary: '{total} case · {pass} ✅ · {fail} ❌',
    colKey: 'Key',
    colValue: 'Value',
    colRequired: 'Bắt buộc',
    colField: 'Field',
    colType: 'Kiểu',
    colDesc: 'Mô tả',
    colGroup: 'Nhóm',
    colCase: 'Case',
    colExpect: 'Mong đợi',
    colActual: 'Thực tế',
    colResult: 'Kết quả',
    notRun: 'chưa chạy',
    emptyValue: 'chưa đặt giá trị',
    secretHidden: '🔒 secret — đã ẩn',
    example: 'vd',
    usesVar: 'lấy từ biến',
    noData: '_Không có._',
    auth: 'Xác thực',
    authNone: 'Không xác thực (hoặc kế thừa từ collection).',
    authBearer: 'Bearer token — `Authorization: Bearer <token>` (giá trị lấy từ biến môi trường).',
    authBasic: 'Basic auth — username `{user}`, mật khẩu **không ghi trong tài liệu**.',
    authApikey: 'API key `{name}` gửi ở {where} — giá trị **không ghi trong tài liệu**.',
    authOauth2: 'OAuth 2.0 — access token từ biến `{name}`, không ghi giá trị.',
    authOther: 'Kiểu xác thực `{type}` — credential **không ghi trong tài liệu**.',
    authInHeader: 'header',
    authInQuery: 'query',
    hiddenNote: '(ẩn)',
    noDescription: '_Chưa có mô tả — thêm ở ô Mô tả của request để tài liệu đầy đủ._',
    hasPreScript: '> Có script **Pre-request** — request này phụ thuộc biến do script đặt.',
    hasTestScript: '> Có script **Tests** (`pm.test`) — xem assertion trong app.',
    requiredDeriveNote:
      '_`Bắt buộc` ReqX **suy ra** từ cấu hình xác thực, `Content-Type` và field có mặt trong body đã lưu — app chưa lưu cờ "required" thật._',
    envVars: 'Biến môi trường dùng tới',
    envVarsSet: 'có',
    envVarsMissing: '**chưa đặt**',
    envVarsNone: '_Phạm vi này không dùng biến `{{...}}` nào._',
    provenance: 'Phần nào ReqX lấy từ đâu',
    provenanceColWhat: 'Mục',
    provenanceColSource: 'Nguồn',
    noEnvName: '(chưa chọn)',
    untitled: '(không tên)',
    prov: [
      { what: 'Tiêu đề, Mục lục', source: 'tên collection + tên thư mục, tên request đã lưu' },
      { what: 'Mô tả từng request', source: 'ô Mô tả của request — để trống thì tài liệu ghi rõ "chưa có mô tả"' },
      { what: 'URL', source: 'URL nguyên văn của request, chỉ che credential nằm trong query' },
      { what: 'Headers · Query · Body', source: 'request đã lưu; header đang tắt không đưa vào tài liệu' },
      { what: 'Kiểu', source: 'suy từ JSON mẫu trong body và trong response, không có schema nên chỉ là kiểu của giá trị mẫu' },
      { what: 'Bắt buộc', source: 'suy từ cấu hình xác thực + Content-Type + field có mặt trong body đã lưu' },
      { what: 'Mô tả field', source: 'giá trị ví dụ trong mẫu đã che secret; field có tên dạng bí mật chỉ ghi 🔒, không ghi giá trị' },
      { what: 'Response 200 / 401', source: 'lịch sử gửi request (100 lần gần nhất) — response đã được che khi lưu nên không rỉ token' },
      { what: 'Biến được trích ra', source: 'rule trích xuất (extract) của step Flow trỏ tới request này' },
      { what: 'Kết quả Key test', source: 'phiên chạy Key test gần nhất trong app — kết quả không lưu ra đĩa, tắt app là mất' },
      { what: 'cURL', source: 'bộ sinh cURL của ReqX, đã che token/cookie' },
      { what: 'Biến môi trường dùng tới', source: 'quét `{{...}}` trong URL, body, header, query, auth và script của collection/thư mục' },
    ],
  },
  en: {
    generatedBy: 'Auto-generated by ReqX',
    environment: 'Environment',
    updated: 'Updated',
    scope: 'Scope',
    secretNote: 'Tokens / passwords / API keys **are hidden** in this document.',
    toc: 'Contents',
    noRequests: '_No requests in this scope._',
    url: 'URL',
    noUrl: '(no URL set)',
    headers: 'Headers',
    query: 'Query parameters',
    body: 'Body',
    noBody: '_No body._',
    responseOk: 'Response',
    response401: 'Response 401',
    noSample: '_No sample yet — run the request in the app to capture a real response._',
    extractedVars: 'Extracted variables',
    curl: 'cURL',
    keyTest: 'Latest Key test results',
    keyTestNone: '_Key test has not been run in this session (results are never stored on disk)._',
    keyTestSummary: '{total} cases · {pass} ✅ · {fail} ❌',
    colKey: 'Key',
    colValue: 'Value',
    colRequired: 'Required',
    colField: 'Field',
    colType: 'Type',
    colDesc: 'Notes',
    colGroup: 'Group',
    colCase: 'Case',
    colExpect: 'Expected',
    colActual: 'Actual',
    colResult: 'Result',
    notRun: 'not run',
    emptyValue: 'no value set',
    secretHidden: '🔒 secret — hidden',
    example: 'e.g.',
    usesVar: 'from variable',
    noData: '_None._',
    auth: 'Auth',
    authNone: 'No auth (or inherited from the collection).',
    authBearer: 'Bearer token — `Authorization: Bearer <token>` (value comes from an environment variable).',
    authBasic: 'Basic auth — username `{user}`, password **is not written into this document**.',
    authApikey: 'API key `{name}` sent in {where} — value **is not written into this document**.',
    authOauth2: 'OAuth 2.0 — access token from variable `{name}`, value not written.',
    authOther: 'Auth type `{type}` — credentials **are not written into this document**.',
    authInHeader: 'header',
    authInQuery: 'query',
    hiddenNote: '(hidden)',
    noDescription: '_No description yet — add one in the request Description field for complete docs._',
    hasPreScript: '> Has a **Pre-request** script — this request depends on variables it sets.',
    hasTestScript: '> Has **Tests** (`pm.test`) — see the assertions in the app.',
    requiredDeriveNote:
      '_`Required` is **inferred** by ReqX from the auth config, `Content-Type` and fields present in the saved body — the app does not store a real "required" flag._',
    envVars: 'Environment variables used',
    envVarsSet: 'set',
    envVarsMissing: '**not set**',
    envVarsNone: '_This scope uses no `{{...}}` variables._',
    provenance: 'Where each section comes from',
    provenanceColWhat: 'Section',
    provenanceColSource: 'Source',
    noEnvName: '(none selected)',
    untitled: '(untitled)',
    prov: [
      { what: 'Title, Contents', source: 'saved collection, folder and request names' },
      { what: 'Per-request description', source: 'the request Description field — left blank, the doc says so explicitly' },
      { what: 'URL', source: 'the request URL verbatim; only credentials inside the query are masked' },
      { what: 'Headers · Query · Body', source: 'the saved request; disabled headers are not documented' },
      { what: 'Type', source: 'inferred from the sample JSON in the body and response — there is no schema, so it is the sample value type' },
      { what: 'Required', source: 'inferred from the auth config + Content-Type + fields present in the saved body' },
      { what: 'Field notes', source: 'masked sample value; a secret-looking name only gets 🔒, never its value' },
      { what: 'Response 200 / 401', source: 'request history (last 100 calls) — responses are masked when stored, so no token leaks' },
      { what: 'Extracted variables', source: 'extract rules of the Flow step pointing at this request' },
      { what: 'Key test results', source: 'the latest Key test run in this app session — never written to disk, lost when the app closes' },
      { what: 'cURL', source: "ReqX curl generator, tokens/cookies already masked" },
      { what: 'Environment variables used', source: 'scan of `{{...}}` across URL, body, headers, query, auth and collection/folder scripts' },
    ],
  },
};

/** Ô bảng: xuống dòng và dấu `|` sẽ làm vỡ bảng Markdown. */
function cell(value: string | undefined): string {
  const s = (value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
  return s === '' ? '—' : s;
}

/** Code fence an toàn: nội dung có ``` thì dùng fence dài hơn. */
function fence(text: string, lang = ''): string {
  const longest = (text.match(/`+/g) ?? []).reduce((a, m) => Math.max(a, m.length), 0);
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return `${ticks}${lang}\n${text.replace(/\s+$/, '')}\n${ticks}`;
}

function enabledKv(list: KeyValue[] | undefined): KeyValue[] {
  return (list ?? []).filter((kv) => kv.enabled !== false && kv.key.trim() !== '');
}

/** Bảng nhiều cột — bản cũ chỉ có 2 cột nên mẫu mới cần bản tổng quát. */
function rows(head: string[], rows: string[][]): string {
  if (rows.length === 0) return '';
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map((c) => cell(c)).join(' | ')} |`),
  ].join('\n');
}

/** Giá trị hiển thị được: giữ `{{biến}}`, che credential theo tên, che Bearer/JWT trong chuỗi. */
function showValue(key: string, value: string, l: LabelSet): string {
  const v = (value ?? '').trim();
  if (v === '') return l.emptyValue;
  if (v.includes('{{')) return v.length > 80 ? v.slice(0, 77) + '…' : v;
  if (looksLikeSecretName(key)) return '***';
  const masked = maskSensitiveBody(v);
  return masked.length > 80 ? masked.slice(0, 77) + '…' : masked;
}

/** Ghi chú cho 1 field (body hoặc response): secret thì ẩn, còn lại là ví dụ đã che. */
function fieldNote(key: string, value: string, l: LabelSet): string {
  const leaf = key.split('.').pop() ?? key;
  if (looksLikeSecretName(leaf)) return l.secretHidden;
  const v = (value ?? '').trim();
  if (v === '') return l.emptyValue;
  if (v.includes('{{')) return `${l.usesVar} \`${v}\``;
  const masked = maskSensitiveBody(v.replace(/\s+/g, ' '));
  const short = masked.length > 60 ? masked.slice(0, 57) + '…' : masked;
  return `${l.example} \`${short}\``;
}

/** Dòng mô tả auth — chỉ nêu field, không in token/mật khẩu. */
function authLine(req: ApiRequest, l: LabelSet, collections?: Collection[]): string {
  const a = resolveRequestAuth(collections ?? [], req);
  const type = (a?.type ?? 'none').toLowerCase();
  if (!a || type === 'none' || type === 'inherit') return l.authNone;
  if (type === 'bearer') return l.authBearer;
  if (type === 'basic') {
    const user = a.username?.includes('{{') ? a.username : a.username?.trim() ? a.username : l.hiddenNote;
    return l.authBasic.replace('{user}', cell(user));
  }
  if (type === 'apikey') {
    const where = a.apiKeyIn === 'query' ? l.authInQuery : l.authInHeader;
    return l.authApikey.replace('{name}', cell(a.apiKeyName || 'X-API-Key')).replace('{where}', where);
  }
  if (type === 'oauth2') {
    return l.authOauth2.replace('{name}', cell(a.oauth2?.autoSaveVar || l.noEnvName));
  }
  return l.authOther.replace('{type}', type);
}

/** `http://host/api?x=1` và `{{baseUrl}}/api?x=1` → `/api?x=1`. */
export function pathOf(url: string): string {
  const clean = (url ?? '').trim();
  if (!clean) return '/';
  let s = clean.replace(/^[a-zA-Z][\w+.-]*:\/\/[^/?#\s]*/, '');
  if (s === clean && /^\{\{[^{}]+\}\}(:\d+)?[/:]/.test(clean)) s = clean.replace(/^\{\{[^{}]+\}\}(:\d+)?/, '');
  if (!s.includes('/')) return s === '' ? '/' : s;
  return s.startsWith('/') ? s : `/${s}`;
}

const REQUIRED_HEADERS = new Set(['authorization', 'content-type', 'x-api-key', 'api-key', 'apikey']);

/** ReqX chưa có cờ `required` trên KeyValue — suy ra từ những gì chắc chắn phải gửi. */
function headerRequired(key: string, req: ApiRequest): boolean {
  const k = key.trim().toLowerCase();
  if (REQUIRED_HEADERS.has(k)) return true;
  const a = req.auth;
  if (a?.apiKeyName && k === a.apiKeyName.trim().toLowerCase()) return true;
  return false;
}

/** JSON (request body hoặc response mẫu) → danh sách field dạng `a.b[].c`. */
interface FlatField {
  key: string;
  type: string;
  value: string;
}

function flattenJson(value: unknown, prefix = '', out: FlatField[] = [], depth = 0): FlatField[] {
  if (out.length >= 60 || depth > 6) return out;
  if (Array.isArray(value)) {
    const first = value[0];
    if (first !== undefined && typeof first === 'object' && first !== null) {
      flattenJson(first, `${prefix}[]`, out, depth + 1);
    } else if (first !== undefined) {
      out.push({ key: `${prefix}[]`, type: jsonType(first), value: String(first) });
    }
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object') flattenJson(v, path, out, depth + 1);
      else out.push({ key: path, type: jsonType(v), value: v === null ? 'null' : String(v) });
    }
    return out;
  }
  out.push({ key: prefix, type: jsonType(value), value: value === null ? 'null' : String(value) });
  return out;
}

function jsonType(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

/** In đẹp JSON để nhét vào fence; body không phải JSON thì cắt và trả nguyên văn. */
function sampleBlock(body: string, l: LabelSet): string {
  const text = (body ?? '').trim();
  if (text === '') return l.noSample;
  let pretty = text;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    pretty = text.length > 2000 ? text.slice(0, 2000) + '\n…' : text;
  }
  const masked = maskSensitiveBody(pretty);
  return fence(masked.length > 4000 ? masked.slice(0, 4000) + '\n…' : masked, looksJson(text) ? 'json' : '');
}

function looksJson(text: string): boolean {
  const t = (text ?? '').trim();
  return t.startsWith('{') || t.startsWith('[');
}

function parseFields(body: string): FlatField[] {
  if (!looksJson(body)) return [];
  try {
    return flattenJson(JSON.parse(body));
  } catch {
    return [];
  }
}

function pickSample(samples: DocsSample[] | undefined, req: ApiRequest, status: 'ok' | 'unauthorized'): DocsSample | undefined {
  // Ưu tiên lấy từ ví dụ response đã lưu trực tiếp trong request (req.examples)
  if (req.examples && req.examples.length > 0) {
    const wanted = status === 'ok' ? (s: number) => s >= 200 && s < 400 : (s: number) => s === 401 || s === 403;
    const match = [...req.examples].sort((a, b) => b.savedAt - a.savedAt).find((e) => wanted(e.status));
    if (match) {
      return {
        requestId: req.id,
        method: req.method,
        url: req.url,
        status: match.status,
        body: match.body,
        timeMs: match.timeMs,
      };
    }
  }

  const mine = (samples ?? []).filter((s) => {
    if (s.requestId && req.id) return s.requestId === req.id;
    if (!s.url) return false;
    return (s.method ?? req.method).toUpperCase() === req.method.toUpperCase() && pathOf(maskUrl(s.url)) === pathOf(maskUrl(req.url));
  });
  const wanted = status === 'ok' ? (s: number) => s >= 200 && s < 400 : (s: number) => s === 401 || s === 403;
  return [...mine].sort((a, b) => (b.timeMs ?? 0) - (a.timeMs ?? 0)).find((s) => wanted(s.status));
}

const GROUP_LABEL_EN: Record<string, string> = {
  valid: 'Valid',
  missing: 'Missing field',
  null: 'null',
  type: 'Wrong type',
  boundary: 'Boundary',
  text: 'Special chars',
  security: 'Security',
  enum: 'Value sweep',
};

function groupLabel(group: TestCase['group'], lang: DocsLang): string {
  return lang === 'en' ? GROUP_LABEL_EN[group] ?? group : GROUP_LABEL[group] ?? group;
}

function keyTestSection(req: ApiRequest, run: DocsTestRun | undefined, l: LabelSet, lang: DocsLang): string {
  const cases = (run?.cases ?? []).filter((c) => run?.requestId === req.id);
  if (cases.length === 0) return '';
  const lines: string[] = [`**${l.keyTest}**`, ''];
  const table_ = rows(
    [l.colGroup, l.colCase, l.colExpect, l.colActual, l.colResult],
    cases.map((c) => {
      const r = run?.results[c.id];
      return [
        groupLabel(c.group, lang),
        c.name,
        c.expect.status || 'any',
        r ? `${r.status ?? '—'} · ${r.why}` : l.notRun,
        r ? (r.pass ? '✅' : '❌') : '⏳',
      ];
    }),
  );
  const pass = cases.filter((c) => run?.results[c.id]?.pass).length;
  const fail = cases.filter((c) => run?.results[c.id] && !run.results[c.id].pass).length;
  lines.push(table_, '');
  lines.push(
    `_${l.keyTestSummary.replace('{total}', String(cases.length)).replace('{pass}', String(pass)).replace('{fail}', String(fail))}_`,
    '',
  );
  return lines.join('\n');
}

/** Một request → mục Markdown. Dùng độc lập được cho tab chưa lưu vào collection. */
export function renderRequestDocs(
  req: ApiRequest,
  opts: { folder?: string; env?: DocsEnv; lang?: DocsLang; samples?: DocsSample[]; flows?: DocsFlow[]; testRun?: DocsTestRun; collections?: Collection[] } = {},
): string {
  const l = LABELS[opts.lang ?? 'vi'];
  const envVars = opts.env?.variables ?? {};
  const globals = opts.env?.globals ?? {};
  const url = maskUrl(req.url.trim() || l.noUrl);
  const lines: string[] = [];

  const nameless = !req.name?.trim();
  const headingName = nameless ? (req.url.trim() ? pathOf(maskUrl(req.url)) : l.untitled) : req.name.trim();
  lines.push(`### ${req.method} ${headingName}`);
  if (opts.folder) lines.push(`_${l.scope}: ${opts.folder}_`);
  lines.push('');
  lines.push(req.description?.trim() ? req.description.trim() : l.noDescription);
  lines.push('', `**${l.auth}**: ${authLine(req, l, opts.collections)}`, '');

  lines.push(`**${l.url}**`, '', fence(`${req.method} ${url}`), '');

  const headers = enabledKv(req.headers);
  const headerRows = rows(
    [l.colKey, l.colValue, l.colRequired],
    headers.map((h) => [h.key, showValue(h.key, h.value, l), headerRequired(h.key, req) ? '✓' : '—']),
  );
  lines.push(`**${l.headers}**`, '', headerRows || l.noData, '');

  const params = enabledKv(req.params);
  if (params.length > 0) {
    lines.push(
      `**${l.query}**`,
      '',
      rows([l.colKey, l.colValue], params.map((p) => [p.key, showValue(p.key, p.value, l)])),
      '',
    );
  }

  lines.push(`**${l.body}**`, '');
  const body = (req.body ?? '').trim();
  const bodyFields = collectTargets(req).filter((t) => t.inBody);
  let bodyTable = '';
  if (req.bodyType === 'none' || body === '') {
    lines.push(l.noBody, '');
  } else {
    const fields = bodyFields.length > 0 ? bodyFields : parseFields(body);
    bodyTable = rows(
      [l.colField, l.colType, l.colRequired, l.colDesc],
      fields.map((f) => [
        f.key,
        f.type,
        (f.value ?? '').trim() === '' ? '—' : '✓',
        fieldNote(f.key.split('.').pop() ?? f.key, f.value, l),
      ]),
    );
    if (fields.length > 0) {
      lines.push(sampleBlock(body, l), '', bodyTable, '');
    } else {
      lines.push(`_\`${req.bodyType}\`_`, '', sampleBlock(body, l), '');
    }
  }
  // Một lần duy nhất cho cả bảng header lẫn bảng body, tránh lặp cùng một ghi chú.
  if (headerRows || bodyTable) lines.push(l.requiredDeriveNote, '');

  if (req.preRequest?.trim()) lines.push(l.hasPreScript, '');
  if (req.tests?.trim()) lines.push(l.hasTestScript, '');

  const ok = pickSample(opts.samples, req, 'ok');
  lines.push(`**${l.responseOk} ${ok?.status ?? 200}**`, '', ok ? sampleBlock(ok.body, l) : l.noSample, '');
  const okFields = ok ? parseFields(ok.body) : [];
  if (okFields.length > 0) {
    lines.push(
      rows(
        [l.colField, l.colType, l.colDesc],
        okFields.map((f) => [f.key, f.type, fieldNote(f.key, f.value, l)]),
      ),
      '',
    );
  }

  const flowVars = (opts.flows ?? [])
    .map((f) => ({ flow: f.name, vars: [...new Set(f.steps.filter((s) => s.requestId === req.id).flatMap((s) => s.extract.map((e) => e.name)))] }))
    .filter((x) => x.vars.length > 0);
  for (const fv of flowVars) {
    lines.push(
      `**${l.extractedVars}** — Flow \`${cell(fv.flow)}\`: ` + fv.vars.map((v) => `\`{{${v}}}\``).join(', '),
      '',
    );
  }

  lines.push(`**${l.curl}**`, '', fence(maskCurl(toCurl(req, envVars, globals, opts.collections)), 'bash'), '');

  const un = pickSample(opts.samples, req, 'unauthorized');
  if (un) lines.push(`**${l.response401}**`, '', sampleBlock(un.body, l), '');

  // Hiển thị các ví dụ lỗi khác (ví dụ 400 Bad Request, 500 Internal Error...) đã được tự động lưu
  const otherErrors = (req.examples ?? []).filter((e) => e.status >= 400 && e.status !== 401 && e.status !== 403);
  for (const err of otherErrors) {
    lines.push(`**${opts.lang === 'en' ? 'Response Error' : 'Phản hồi lỗi'} ${err.status}${err.statusText ? ` (${err.statusText})` : ''}**`, '', sampleBlock(err.body, l), '');
  }

  const kt = keyTestSection(req, opts.testRun, l, opts.lang ?? 'vi');
  if (kt) lines.push(kt);
  else if (opts.testRun && opts.testRun.requestId === req.id) lines.push(`**${l.keyTest}**`, '', l.keyTestNone, '');

  return lines.join('\n');
}

function referencedVarNames(items: ApiRequest[], col?: Collection): string[] {
  const names = new Set<string>();
  const scan = (txt?: string) => {
    for (const m of (txt ?? '').matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) names.add(m[1]);
  };
  for (const r of items) {
    scan(r.url);
    scan(r.body);
    for (const kv of [...(r.params ?? []), ...(r.headers ?? [])]) { scan(kv.key); scan(kv.value); }
    const a = r.auth;
    if (a) for (const v of [a.token, a.username, a.password, a.apiKey, a.apiKeyName]) scan(v);
  }
  if (col) {
    scan(col.preRequest);
    scan(col.tests);
    // Auth collection: request "kế thừa" dùng đúng các biến này
    if (col.auth) for (const v of [col.auth.token, col.auth.username, col.auth.password, col.auth.apiKey, col.auth.apiKeyName]) scan(v);
    for (const f of col.folders) { scan(f.preRequest); scan(f.tests); }
  }
  return [...names].sort();
}

function walkFolders(
  col: Collection,
  requests: Record<string, ApiRequest>,
  folderIds: string[],
  prefix: string,
  out: { req: ApiRequest; folder: string }[],
  seen: Set<string>,
): void {
  for (const fid of folderIds) {
    if (seen.has(fid)) continue; // folder cha đã đi qua rồi — không lặp khi dữ liệu bị hỏng
    seen.add(fid);
    const f = col.folders.find((x) => x.id === fid);
    if (!f) continue;
    const path = prefix ? `${prefix} / ${f.name}` : f.name;
    for (const rid of f.requestIds) {
      const r = requests[rid];
      if (r) out.push({ req: r, folder: path });
    }
    walkFolders(col, requests, f.folderIds ?? [], path, out, seen);
  }
}

/** Folder gốc = folder không nằm trong folderIds của folder nào khác. */
function rootFolderIds(col: Collection): string[] {
  const child = new Set<string>();
  for (const f of col.folders) for (const cid of f.folderIds ?? []) child.add(cid);
  return col.folders.filter((f) => !child.has(f.id)).map((f) => f.id);
}

function dayString(d: Date, lang: DocsLang): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return lang === 'en' ? `${y}-${m}-${day}` : `${day}/${m}/${y}`;
}

/** Tiêu đề + dòng nguồn — bản 1 request, cả collection và 1 thư mục phải giống nhau. */
function banner(title: string, env: DocsEnv | undefined, l: LabelSet, lang: DocsLang, now: Date, scope?: string): string[] {
  const parts = [
    l.generatedBy,
    `${l.environment}: ${env?.name?.trim() ? `**${env.name.trim()}**` : l.noEnvName}`,
    `${l.updated}: ${dayString(now, lang)}`,
  ];
  if (scope) parts.splice(1, 0, `${l.scope}: **${scope}**`);
  return [`# ${title}`, '', parts.join(' · '), '', `> ${l.secretNote}`, ''];
}

function provenance(l: LabelSet): string {
  return rows(
    [l.provenanceColWhat, l.provenanceColSource],
    l.prov.map((p) => [p.what, p.source]),
  );
}

/** Tài liệu Markdown cho cả collection (hoặc 1 thư mục trong collection). */
export function renderCollectionDocs(
  col: Collection,
  requests: Record<string, ApiRequest>,
  opts: DocsInput = {},
): string {
  const lang = opts.lang ?? 'vi';
  const l = LABELS[lang];
  const items: { req: ApiRequest; folder: string }[] = [];
  // folderId = chỉ xuất 1 thư mục: đi từ đúng folder đó (kèm folder con),
  // KHÔNG lấy request gốc của collection — đó là phạm vi người dùng vừa chọn.
  const scope = opts.folderId ? col.folders.find((f) => f.id === opts.folderId) : undefined;
  if (opts.folderId && !scope) {
    return `# ${col.name}\n\n_${lang === 'en' ? 'The selected folder no longer exists (renamed or deleted).' : 'Không tìm thấy thư mục được chọn (có thể vừa bị đổi tên hoặc xóa).'}_`;
  }
  if (scope) {
    walkFolders(col, requests, [scope.id], '', items, new Set());
  } else {
    for (const rid of col.rootRequestIds) {
      const r = requests[rid];
      if (r) items.push({ req: r, folder: '' });
    }
    walkFolders(col, requests, rootFolderIds(col), '', items, new Set());
  }
  const env = opts.env;

  const out: string[] = banner(col.name, env, l, lang, opts.now ?? new Date(), scope?.name);

  out.push(`## ${l.toc}`, '');
  if (items.length === 0) out.push(l.noRequests, '');
  else {
    for (const it of items) {
      const line = it.folder ? `- **${it.folder}**: \`${it.req.method}\` ${cell(it.req.name)}` : `- \`${it.req.method}\` ${cell(it.req.name)}`;
      out.push(line);
    }
    out.push('');
  }

  // Mẫu: mỗi folder một mục `## <folder>`, request lồng dưới `### METHOD tên`.
  let lastFolder: string | null = null;
  items.forEach((it) => {
    const folderKey = it.folder || '';
    if (folderKey !== lastFolder) {
      out.push(`## ${folderKey || col.name}`, '');
      lastFolder = folderKey;
    }
    out.push(renderRequestDocs(it.req, { folder: undefined, env, lang, samples: opts.samples, flows: opts.flows, testRun: opts.testRun, collections: [col] }));
    out.push('');
  });

  const varNames = referencedVarNames(items.map((i) => i.req), col);
  out.push(`## ${l.envVars}`, '');
  if (varNames.length === 0) out.push(l.envVarsNone, '');
  else {
    out.push(
      rows(
        [l.colKey, l.environment],
        varNames.map((n) => {
          const has = env ? n in env.variables || n in (env.globals ?? {}) : false;
          return [`\`{{${n}}}\``, has ? l.envVarsSet : l.envVarsMissing];
        }),
      ),
      '',
    );
  }

  if (opts.includeProvenance !== false) {
    out.push(`## ${l.provenance}`, '', provenance(l), '');
  }
  return out.join('\n');
}

/** Tài liệu Markdown cho RIÊNG 1 request đang mở (nút ▼ Send) — không kèm request nào khác. */
export function renderSingleRequestDocs(
  req: ApiRequest,
  opts: Omit<DocsInput, 'folderId'> & { folder?: string } = {},
): string {
  const lang = opts.lang ?? 'vi';
  const l = LABELS[lang];
  const title = req.name?.trim() || pathOf(maskUrl(req.url)) || l.noUrl;
  return [
    ...banner(title, opts.env, l, lang, opts.now ?? new Date(), opts.folder),
    renderRequestDocs(req, { folder: undefined, env: opts.env, lang, samples: opts.samples, flows: opts.flows, testRun: opts.testRun, collections: opts.collections }),
    ...(opts.includeProvenance !== false ? [`## ${l.provenance}`, '', provenance(l), ''] : []),
  ].join('\n');
}

/** Tên file tài liệu an toàn theo tên collection/request (`md` cho Git/Wiki, `html` để mở trình duyệt). */
export function docsFileName(label: string, ext: 'md' | 'html' = 'md'): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const slug = (label || 'api')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .toLowerCase() || 'api';
  return `reqx-tai-lieu-${slug}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.${ext}`;
}
