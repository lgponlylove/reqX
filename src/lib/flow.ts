import type { ApiRequest, AuthConfig, BodyType, Collection, ExtractFrom, ExtractRule, Flow, KeyValue, StepCondition, StepRetry } from '../types/api';
import { runOneRequest, type RunnerHooks } from './runner';
import { contentTypeOf } from './response-file';
import { stripRequestSecrets } from './secrets';
import { toCurl } from './codegen';
import { parseCurlCommands } from './curl-import';
import { uid } from './variables';

export interface ExtractedVar {
  name: string;
  value: string;
}

export interface ExtractError {
  rule: string;
  message: string;
}

/** Lấy giá trị theo dot-path, hỗ trợ index mảng (`items.0.id`). */
export function getDotPath(obj: unknown, path: string): { found: boolean; value: unknown } {
  const parts = path.split('.').map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length === 0) return { found: false, value: undefined };
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return { found: false, value: undefined };
    if (Array.isArray(cur)) {
      const i = Number(part);
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) return { found: false, value: undefined };
      cur = cur[i];
    } else if (typeof cur === 'object') {
      if (!(part in cur)) return { found: false, value: undefined };
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: cur };
}

function stringifyVal(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export interface MiniResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyKind?: 'text' | 'binary';
}

/** Áp dụng các rule trích lên 1 response → biến flow. */
export function applyExtract(
  resp: MiniResponse,
  rules: ExtractRule[],
): { values: Record<string, string>; errors: ExtractError[] } {
  const values: Record<string, string> = {};
  const errors: ExtractError[] = [];
  let parsed: unknown;
  let parsedOk = false;
  const needJson = rules.some((r) => r.from === 'body-json');
  if (needJson) {
    if (resp.bodyKind === 'binary') {
      for (const r of rules.filter((x) => x.from === 'body-json')) {
        errors.push({ rule: r.name, message: 'response là file nhị phân, không trích JSON được' });
      }
    } else {
      try {
        parsed = JSON.parse(resp.body);
        parsedOk = true;
      } catch {
        for (const r of rules.filter((x) => x.from === 'body-json')) {
          errors.push({ rule: r.name, message: 'body không phải JSON hợp lệ' });
        }
      }
    }
  }
  for (const r of rules) {
    const name = r.name.trim();
    if (!name) {
      errors.push({ rule: '(chưa đặt tên)', message: 'rule thiếu tên biến' });
      continue;
    }
    if (r.from === 'status') {
      values[name] = String(resp.status);
    } else if (r.from === 'header') {
      const key = r.path.trim().toLowerCase();
      const hit = Object.entries(resp.headers).find(([k]) => k.toLowerCase() === key);
      if (!hit) errors.push({ rule: name, message: `không thấy header "${r.path.trim()}"` });
      else values[name] = hit[1];
    } else if (r.from === 'body-text') {
      let re: RegExp;
      try {
        re = new RegExp(r.path);
      } catch {
        errors.push({ rule: name, message: `regex sai: ${r.path}` });
        continue;
      }
      const m = re.exec(resp.bodyKind === 'binary' ? '' : resp.body);
      if (!m) errors.push({ rule: name, message: 'regex không khớp' });
      else values[name] = m[1] ?? m[0];
    } else {
      if (!parsedOk) continue; // lỗi đã ghi ở trên
      const { found, value } = getDotPath(parsed, r.path);
      if (!found) errors.push({ rule: name, message: `không thấy đường dẫn "${r.path}"` });
      else values[name] = stringifyVal(value);
    }
  }
  return { values, errors };
}

export interface StepRetryAttempt {
  attempt: number;
  ok: boolean;
  status?: number;
  error?: string;
  timeMs?: number;
}

export interface FlowStepResult {
  stepId: string;
  name: string;
  method: string;
  url: string;
  skipped?: boolean;
  skipReason?: string;
  ok: boolean;
  status?: number;
  timeMs?: number;
  startTimeMs?: number; // thời điểm bắt đầu (ms tính từ đầu flow)
  endTimeMs?: number;   // thời điểm kết thúc (ms tính từ đầu flow)
  attempts?: number;    // số lần chạy (1 + retries)
  retryHistory?: StepRetryAttempt[];
  testsPassed: number;
  testsTotal: number;
  error?: string;
  extracted: ExtractedVar[];
  extractErrors: ExtractError[];
  logs: string[];
  /** Body response (để lưu xem lại) — chỉ có khi nhận được response */
  body?: string;
  bodyKind?: 'text' | 'binary';
  contentType?: string;
}

export interface FlowRunOpts {
  timeoutMs: number;
  delayMs: number;
  stopOnError: boolean;
  signal?: AbortSignal;
  onStep?: (r: FlowStepResult, index: number) => void;
  /** Để step chạy luôn cả script kế thừa ở mức collection/folder. */
  collections?: Collection[];
}

/**
 * Đánh giá điều kiện rẽ nhánh dựa trên biến môi trường & biến flow
 */
export function evaluateCondition(cond: StepCondition, vars: Record<string, string>): boolean {
  if (!cond.enabled) return true;
  const rawActual = vars[cond.varName.trim()] ?? '';
  const actual = String(rawActual).trim();
  const target = String(cond.value ?? '').trim();

  switch (cond.operator) {
    case '==':
      return actual === target;
    case '!=':
      return actual !== target;
    case 'contains':
      return actual.includes(target);
    case '>': {
      const numA = parseFloat(actual);
      const numB = parseFloat(target);
      return !isNaN(numA) && !isNaN(numB) && numA > numB;
    }
    case '<': {
      const numA = parseFloat(actual);
      const numB = parseFloat(target);
      return !isNaN(numA) && !isNaN(numB) && numA < numB;
    }
    case 'exists':
      return actual !== '';
    case 'empty':
      return actual === '';
    default:
      return true;
  }
}

/**
 * Chạy flow thông minh:
 * - Hỗ trợ rẽ nhánh theo điều kiện (Pre-condition skip / jump)
 * - Tự động thử lại khi lỗi (Retry policy)
 * - Rẽ nhánh hậu kỳ (On success / On fail jump)
 * - Đo đạc thời gian bắt đầu, kết thúc cho biểu đồ Timeline
 */
export async function runFlow(
  flow: Flow,
  requests: Record<string, ApiRequest>,
  baseHooks: Pick<RunnerHooks, 'getVars' | 'setGlobal'>,
  opts: FlowRunOpts,
): Promise<{ results: FlowStepResult[]; flowVars: Record<string, string> }> {
  const flowVars: Record<string, string> = {};
  const results: FlowStepResult[] = [];
  const steps = flow.steps.filter((s) => !s.disabled);
  const flowStart = performance.now();

  let currentIdx = 0;
  let executionCount = 0;
  const maxExecutionSteps = Math.max(100, steps.length * 10); // Ngăn lặp vô tận khi jump

  while (currentIdx < steps.length && executionCount < maxExecutionSteps) {
    if (opts.signal?.aborted) break;
    executionCount++;

    const step = steps[currentIdx];
    const req = requests[step.requestId];

    if (!req) {
      const nowRel = Math.round(performance.now() - flowStart);
      const r: FlowStepResult = {
        stepId: step.id, name: '(request đã bị xóa)', method: '', url: '',
        ok: false, testsPassed: 0, testsTotal: 0, error: 'request trong step này đã bị xóa khỏi collection', extracted: [], extractErrors: [], logs: [],
        startTimeMs: nowRel, endTimeMs: nowRel, timeMs: 0, attempts: 1,
      };
      results.push(r);
      opts.onStep?.(r, results.length - 1);
      if (opts.stopOnError) break;
      currentIdx++;
      continue;
    }

    const { envVars, globals } = baseHooks.getVars();
    const mergedVars = { ...globals, ...envVars, ...flowVars };

    // 1. Kiểm tra điều kiện thực thi bước (Pre-condition)
    if (step.condition?.enabled) {
      const isMet = evaluateCondition(step.condition, mergedVars);
      if (!isMet) {
        const nowRel = Math.round(performance.now() - flowStart);
        const skipReason = `Điều kiện không thỏa: {{${step.condition.varName}}} ${step.condition.operator} "${step.condition.value}" (thực tế: "${mergedVars[step.condition.varName] ?? ''}")`;
        const r: FlowStepResult = {
          stepId: step.id,
          name: req.name,
          method: req.method,
          url: req.url,
          skipped: true,
          skipReason,
          ok: true,
          testsPassed: 0,
          testsTotal: 0,
          extracted: [],
          extractErrors: [],
          logs: [`[Branching] ⏭ Bỏ qua bước: ${skipReason}`],
          startTimeMs: nowRel,
          endTimeMs: nowRel,
          timeMs: 0,
          attempts: 0,
        };
        results.push(r);
        opts.onStep?.(r, results.length - 1);

        // Nhảy bước nếu cấu hình onFalse === 'jump'
        if (step.condition.onFalse === 'jump' && step.condition.jumpStepId) {
          const targetIdx = steps.findIndex((s) => s.id === step.condition!.jumpStepId);
          if (targetIdx >= 0) {
            currentIdx = targetIdx;
            continue;
          }
        }
        currentIdx++;
        continue;
      }
    }

    const hooks: RunnerHooks = {
      getVars: () => {
        const { envVars: freshEnv, globals: freshGlobals } = baseHooks.getVars();
        return { envVars: { ...freshEnv, ...flowVars }, globals: freshGlobals };
      },
      setEnv: (k, v) => {
        flowVars[k] = v;
      },
      setGlobal: baseHooks.setGlobal,
    };

    // 2. Chạy request với cơ chế Retry khi lỗi
    const stepStart = Math.round(performance.now() - flowStart);
    let item = await runOneRequest(req, hooks, opts.timeoutMs, opts.signal, undefined, opts.collections);
    let attempts = 1;
    const retryHistory: StepRetryAttempt[] = [
      { attempt: 1, ok: item.ok, status: item.status, error: item.error, timeMs: item.timeMs }
    ];

    const maxAttempts = (step.retry?.enabled && step.retry.maxAttempts > 1) ? Math.min(10, step.retry.maxAttempts) : 1;
    const retryDelay = step.retry?.delayMs ?? 1000;

    while (!item.ok && attempts < maxAttempts) {
      if (opts.signal?.aborted) break;
      if (retryDelay > 0) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, retryDelay);
          opts.signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
        });
      }
      attempts++;
      const retryItem = await runOneRequest(req, hooks, opts.timeoutMs, opts.signal, undefined, opts.collections);
      retryItem.logs.unshift(`[Retry #${attempts}/${maxAttempts}] Chạy lại sau ${retryDelay}ms do lần trước gặp lỗi: ${item.error ?? item.status ?? 'failed'}`);
      item = retryItem;
      retryHistory.push({ attempt: attempts, ok: item.ok, status: item.status, error: item.error, timeMs: item.timeMs });
    }

    const stepEnd = Math.round(performance.now() - flowStart);

    // 3. Trích xuất biến từ Response
    const extracted: ExtractedVar[] = [];
    const extractErrors: ExtractError[] = [];
    if (item.response) {
      const { values, errors } = applyExtract(item.response, step.extract);
      for (const [name, value] of Object.entries(values)) {
        flowVars[name] = value;
        extracted.push({ name, value });
      }
      extractErrors.push(...errors);
    } else if (step.extract.length > 0) {
      extractErrors.push({ rule: '(chung)', message: 'không có response để trích' });
    }

    const r: FlowStepResult = {
      stepId: step.id,
      name: req.name,
      method: req.method,
      url: req.url,
      ok: item.ok,
      status: item.status,
      timeMs: item.timeMs ?? (stepEnd - stepStart),
      startTimeMs: stepStart,
      endTimeMs: stepEnd,
      attempts,
      retryHistory: retryHistory.length > 1 ? retryHistory : undefined,
      testsPassed: item.testsPassed,
      testsTotal: item.testsTotal,
      error: item.error,
      extracted,
      extractErrors,
      logs: item.logs,
      body: item.response?.body,
      bodyKind: item.response?.bodyKind,
      contentType: item.response ? contentTypeOf(item.response.headers) : undefined,
    };
    results.push(r);
    opts.onStep?.(r, results.length - 1);

    // 4. Kiểm tra rẽ nhánh hậu kỳ (Post-execution Jumps)
    let jumped = false;
    if (item.ok && step.onSuccessJump) {
      const targetIdx = steps.findIndex((s) => s.id === step.onSuccessJump);
      if (targetIdx >= 0) {
        currentIdx = targetIdx;
        jumped = true;
      }
    } else if (!item.ok && step.onFailJump) {
      const targetIdx = steps.findIndex((s) => s.id === step.onFailJump);
      if (targetIdx >= 0) {
        currentIdx = targetIdx;
        jumped = true;
      }
    }

    if (!jumped) {
      if (!item.ok && opts.stopOnError) break;
      currentIdx++;
    }

    // Delay giữa các bước (nếu có và chưa hết flow)
    if (opts.delayMs > 0 && currentIdx < steps.length) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, opts.delayMs);
        opts.signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
      });
    }
  }

  return { results, flowVars };
}

/** Rule mẫu khi bấm "Thêm rule". */
export function sampleRule(): ExtractRule {
  return { id: uid('rule'), name: '', from: 'body-json', path: 'data.token' };
}

const EXTRACT_FROM: ExtractFrom[] = ['body-json', 'header', 'status', 'body-text'];

/** JSON mẫu cho hộp import (dùng requestId thật thì thay 2 dòng REQ_ID_*). */
export const FLOW_JSON_SAMPLE = `{
  "name": "SSO -> Order print",
  "steps": [
    {
      "requestId": "REQ_ID_LOGIN",
      "extract": [
        { "name": "access_token", "from": "body-json", "path": "access_token" },
        { "name": "token_type", "from": "body-json", "path": "token_type" }
      ]
    },
    { "requestId": "REQ_ID_ORDER", "extract": [] }
  ]
}`;

export interface FlowImportData {
  name: string;
  steps: { requestId: string; disabled?: boolean; extract: Omit<ExtractRule, 'id'>[] }[];
}

/**
 * Parse JSON import thành dữ liệu flow. requestId không tồn tại → bỏ qua + warning
 * (requestId xem ở Sidebar khi mở request, hoặc Export flow ra là có).
 */
export function parseFlowJson(
  text: string,
  requests: Record<string, ApiRequest>,
): { data?: FlowImportData; warnings: string[]; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { warnings: [], error: 'JSON sai cú pháp' };
  }
  return parseFlowObject(raw, requests);
}

/** Parse flow từ object đã có (tránh JSON.stringify rồi parse lại). */
export function parseFlowObject(
  raw: unknown,
  requests: Record<string, ApiRequest>,
): { data?: FlowImportData; warnings: string[]; error?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { warnings: [], error: 'JSON phải là object {name, steps}' };
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'Flow import';
  if (!Array.isArray(o.steps) || o.steps.length === 0) return { warnings: [], error: 'thiếu mảng steps (ít nhất 1 step)' };
  const warnings: string[] = [];
  const steps: FlowImportData['steps'] = [];
  o.steps.forEach((s: unknown, i: number) => {
    const n = i + 1;
    if (!s || typeof s !== 'object') {
      warnings.push(`step #${n}: bỏ qua (không phải object)`);
      return;
    }
    const so = s as Record<string, unknown>;
    const requestId = typeof so.requestId === 'string' ? so.requestId : '';
    if (!requestId || !requests[requestId]) {
      warnings.push(`step #${n}: bỏ qua (requestId không tồn tại: "${requestId || '(trống)'}")`);
      return;
    }
    const extract = parseRules(so.extract, `step #${n}`, warnings);
    steps.push({ requestId, extract, disabled: so.disabled === true || undefined });
  });
  if (steps.length === 0) return { warnings, error: 'không còn step hợp lệ nào sau khi kiểm tra' };
  return { data: { name, steps }, warnings };
}

const FLOW_VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** Quét tất cả {{biến}} dùng trong 1 request (url/params/headers/body/auth). */
export function collectRequestVars(req: ApiRequest): string[] {
  const found = new Set<string>();
  const scan = (s: string | undefined) => {
    if (!s) return;
    FLOW_VAR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FLOW_VAR_RE.exec(s)) !== null) found.add(m[1]);
  };
  scan(req.url);
  scan(req.body);
  for (const kv of [...req.params, ...req.headers]) {
    scan(kv.key);
    scan(kv.value);
  }
  const a = req.auth;
  scan(a.token);
  scan(a.username);
  scan(a.password);
  scan(a.apiKey);
  scan(a.apiKeyName);
  return [...found];
}

export interface FlowVarIssue {
  /** index trong flow.steps (kể cả step tắt) */
  stepIndex: number;
  stepName: string;
  vars: string[];
}

/**
 * Kiểm tra tĩnh trước khi chạy: biến {{x}} nào không có ở env/globals
 * mà cũng không được step nào TRƯỚC đó trích ra → chắc chắn gửi đi nguyên văn.
 * (Biến do script pm.environment.set tạo ra không phát hiện được — cứ chạy.)
 */
export function analyzeFlow(
  flow: Flow,
  requests: Record<string, ApiRequest>,
  base: { envVars: Record<string, string>; globals: Record<string, string> },
): FlowVarIssue[] {
  const known = new Set([...Object.keys(base.envVars), ...Object.keys(base.globals)]);
  const issues: FlowVarIssue[] = [];
  flow.steps.forEach((st, i) => {
    if (st.disabled) return;
    const req = requests[st.requestId];
    if (req) {
      const missing = collectRequestVars(req).filter((v) => !known.has(v));
      if (missing.length > 0) issues.push({ stepIndex: i, stepName: req.name, vars: missing });
    }
    for (const r of st.extract) {
      if (r.name.trim()) known.add(r.name.trim());
    }
  });
  return issues;
}

/** Validate mảng rule trích dùng chung cho mọi định dạng import. */
function parseRules(raw: unknown, ctx: string, warnings: string[]): Omit<ExtractRule, 'id'>[] {
  const extract: Omit<ExtractRule, 'id'>[] = [];
  if (!Array.isArray(raw)) return extract;
  raw.forEach((r: unknown, j: number) => {
    if (!r || typeof r !== 'object') return;
    const ro = r as Record<string, unknown>;
    const rname = typeof ro.name === 'string' ? ro.name.trim() : '';
    if (!rname) {
      warnings.push(`${ctx} rule #${j + 1}: bỏ qua (thiếu name)`);
      return;
    }
    const from = EXTRACT_FROM.includes(ro.from as ExtractFrom) ? (ro.from as ExtractFrom) : 'body-json';
    if (ro.from !== from) warnings.push(`${ctx} rule "${rname}": from lạ → dùng body-json`);
    extract.push({ name: rname, from, path: typeof ro.path === 'string' ? ro.path : '' });
  });
  return extract;
}

// ---------------------------------------------------------------------------
// File ReqX gộp (.reqx-flow.json): nhúng requests đầy đủ + flow.
// Import 1 phát ra cả collection lẫn flow, máy khác cũng chạy được.
// Auth secrets (token/password/apiKey) bị lược khi export — nhập lại ở máy mới.
// ---------------------------------------------------------------------------

export interface ReqxEmbeddedRequest {
  name: string;
  method: string;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  bodyType: BodyType;
  body: string;
  auth: AuthConfig;
  preRequest?: string;
  tests?: string;
  /** Lệnh curl tương đương (để đọc/chạy tay). Import ưu tiên object đầy đủ, curl chỉ là dự phòng. */
  curl?: string;
}

export interface ReqxFileStep {
  /** index vào mảng requests của file */
  request: number;
  disabled?: boolean;
  /** Thông tin đọc thêm (import bỏ qua, chỉ để đối chiếu). */
  _request?: string;
  extract: Omit<ExtractRule, 'id'>[];
}

export interface ReqxFlowFile {
  kind: 'reqx-flow';
  version: 2;
  name: string;
  requests: ReqxEmbeddedRequest[];
  steps: ReqxFileStep[];
}

/**
 * Dựng file ReqX từ flow đang mở (chỉ nhúng requests mà steps dùng tới).
 * Mỗi request gồm object đầy đủ (giữ pre-request/tests) + lệnh curl tương đương.
 * Truyền env rỗng để curl giữ nguyên {{var}} cho máy khác dùng được.
 */
export function buildReqxFlowExport(
  flow: Flow,
  requests: Record<string, ApiRequest>,
  envVars: Record<string, string> = {},
  globalVars: Record<string, string> = {},
): ReqxFlowFile {
  const used: ApiRequest[] = [];
  const idxOf = new Map<string, number>();
  for (const st of flow.steps) {
    if (!idxOf.has(st.requestId)) {
      const r = requests[st.requestId];
      if (r) {
        idxOf.set(st.requestId, used.length);
        used.push(r);
      }
    }
  }
  return {
    kind: 'reqx-flow',
    version: 2,
    name: flow.name,
    requests: used.map((r) => {
      const s = stripRequestSecrets(r);
      return {
        name: s.name, method: s.method, url: s.url,
        params: s.params, headers: s.headers,
        bodyType: s.bodyType, body: s.body, auth: s.auth,
        preRequest: s.preRequest ?? '', tests: s.tests ?? '',
        curl: toCurl(s, envVars, globalVars),
      };
    }),
    steps: flow.steps.map((s) => {
      const i = idxOf.get(s.requestId);
      const r = s.requestId ? requests[s.requestId] : undefined;
      return {
        request: i ?? -1,
        ...(s.disabled ? { disabled: true as const } : {}),
        _request: r ? `${r.method} ${r.name || r.url}` : `(request đã xóa: ${s.requestId || '(trống)'})`,
        extract: s.extract.map(({ name, from, path }) => ({ name, from, path })),
      };
    }),
  };
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const BODY_TYPES: BodyType[] = ['none', 'json', 'raw', 'form-data', 'urlencoded'];

function parseKvList(v: unknown): KeyValue[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((e) => e && typeof e === 'object' && typeof (e as { key?: unknown }).key === 'string')
    .map((e) => {
      const o = e as { key: string; value?: unknown; enabled?: unknown };
      return {
        id: uid('kv'),
        key: o.key,
        value: typeof o.value === 'string' ? o.value : '',
        enabled: o.enabled !== false,
      };
    });
}

function validAuth(a: unknown): AuthConfig {
  if (!a || typeof a !== 'object') return { type: 'none' };
  const o = a as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (o.type) {
    case 'bearer':
      return { type: 'bearer', token: str(o.token) };
    case 'basic':
      return { type: 'basic', username: str(o.username), password: '' };
    case 'apikey':
      return {
        type: 'apikey', apiKey: '',
        apiKeyIn: o.apiKeyIn === 'query' ? 'query' : 'header',
        apiKeyName: str(o.apiKeyName),
      };
    default:
      return { type: 'none' };
  }
}

export interface ReqxFlowImport {
  name: string;
  requests: ReqxEmbeddedRequest[];
  steps: { request: number; disabled?: boolean; extract: Omit<ExtractRule, 'id'>[] }[];
}

/** Parse file ReqX gộp. */
export function parseReqxFlowFile(json: unknown): { data?: ReqxFlowImport; warnings: string[]; error?: string } {
  const warnings: string[] = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { warnings, error: 'không phải JSON object' };
  }
  const o = json as Record<string, unknown>;
  if (o.kind !== 'reqx-flow') return { warnings, error: 'không phải file reqx-flow (thiếu kind)' };
  const rawReqs = Array.isArray(o.requests) ? o.requests : [];
  const requests: ReqxEmbeddedRequest[] = [];
  rawReqs.forEach((r: unknown, i: number) => {
    const n = i + 1;
    if (!r || typeof r !== 'object') {
      warnings.push(`request #${n}: bỏ qua (không phải object)`);
      return;
    }
    const ro = r as Record<string, unknown>;
    const url = typeof ro.url === 'string' ? ro.url : '';
    const curl = typeof ro.curl === 'string' ? ro.curl.trim() : '';
    const entryName = typeof ro.name === 'string' && ro.name ? ro.name : `Request ${n}`;
    // Entry chỉ có curl (không có object đầy đủ) → dựng request từ curl
    if (!url && curl) {
      const [cmd] = parseCurlCommands(curl);
      if (!cmd || !cmd.parsed) {
        warnings.push(`request #${n}: bỏ qua (curl lỗi: ${cmd?.error ?? 'không parse được'})`);
        return;
      }
      const pr = cmd.parsed.request;
      requests.push({
        name: entryName !== `Request ${n}` ? entryName : pr.name,
        method: pr.method, url: pr.url,
        params: pr.params, headers: pr.headers,
        bodyType: pr.bodyType, body: pr.body, auth: pr.auth,
        preRequest: '', tests: '',
      });
      if (cmd.parsed.warnings.length > 0) warnings.push(`request #${n}: ${cmd.parsed.warnings.join(' | ')}`);
      else warnings.push(`request #${n}: dựng từ curl (không gồm pre-request/tests)`);
      return;
    }
    if (!url) {
      warnings.push(`request #${n}: bỏ qua (thiếu url và curl)`);
      return;
    }
    const method = typeof ro.method === 'string' ? ro.method.toUpperCase() : 'GET';
    requests.push({
      name: typeof ro.name === 'string' && ro.name ? ro.name : `Request ${n}`,
      method: HTTP_METHODS.includes(method) ? method : 'GET',
      url,
      params: parseKvList(ro.params),
      headers: parseKvList(ro.headers),
      bodyType: BODY_TYPES.includes(ro.bodyType as BodyType) ? (ro.bodyType as BodyType) : 'none',
      body: typeof ro.body === 'string' ? ro.body : '',
      auth: validAuth(ro.auth),
      preRequest: typeof ro.preRequest === 'string' ? ro.preRequest : '',
      tests: typeof ro.tests === 'string' ? ro.tests : '',
    });
  });
  if (requests.length === 0) return { warnings, error: 'file không có request hợp lệ nào' };
  if (!Array.isArray(o.steps) || o.steps.length === 0) return { warnings, error: 'thiếu mảng steps (ít nhất 1 step)' };
  const steps: ReqxFlowImport['steps'] = [];
  o.steps.forEach((s: unknown, i: number) => {
    const n = i + 1;
    if (!s || typeof s !== 'object') {
      warnings.push(`step #${n}: bỏ qua (không phải object)`);
      return;
    }
    const so = s as Record<string, unknown>;
    const idx = typeof so.request === 'number' ? so.request : -1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= requests.length) {
      warnings.push(`step #${n}: bỏ qua (request index sai: ${typeof so.request === 'number' ? so.request : 'thiếu'})`);
      return;
    }
    steps.push({
      request: idx,
      disabled: so.disabled === true || undefined,
      extract: parseRules(so.extract, `step #${n}`, warnings),
    });
  });
  if (steps.length === 0) return { warnings, error: 'không còn step hợp lệ nào sau khi kiểm tra' };
  return {
    data: {
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'Flow import',
      requests,
      steps,
    },
    warnings,
  };
}

export interface ReqxMergeResult {
  /** Collection mới chỉ gom các request CHƯA có — null khi mọi request đều đã tồn tại. */
  collection: Collection | null;
  /** Chỉ các request mới tạo (đã có thì dùng lại, không nhân bản). */
  requests: ApiRequest[];
  flowData: FlowImportData;
  reused: string[];
  added: string[];
}

/** Khóa so khớp request: METHOD + url + body + params/headers (cùng URL nhưng khác nội dung thì không tính là trùng). */
function requestMatchKey(r: {
  method: string; url: string; params?: KeyValue[]; headers?: KeyValue[];
  bodyType?: BodyType; body?: string; auth?: AuthConfig;
}): string {
  const kv = (list?: KeyValue[]) =>
    (list ?? [])
      .filter((k) => k.enabled !== false && (k.key || k.value))
      .map((k) => `${k.key.trim().toLowerCase()}=${k.value.trim()}`)
      .sort()
      .join('&');
  return [
    `${r.method.trim().toUpperCase()} ${r.url.trim()}`,
    r.bodyType ?? '',
    (r.body ?? '').trim(),
    kv(r.params),
    kv(r.headers),
    r.auth?.type ?? '',
  ].join('\n');
}

/**
 * Bung file ReqX thành requests + flow data, SO KHỚP với request đã có:
 * trùng method + URL thì dùng lại (bỏ qua, không tạo mới), chưa có thì tạo thêm.
 * Collection mới chỉ tạo khi có ít nhất 1 request mới.
 */
export function mergeReqxImport(data: ReqxFlowImport, existing: Record<string, ApiRequest>): ReqxMergeResult {
  const byKey = new Map<string, string>();
  for (const r of Object.values(existing)) {
    const k = requestMatchKey(r);
    if (!byKey.has(k)) byKey.set(k, r.id);
  }
  const freshKv = (list: KeyValue[]) => list.map((k) => ({ ...k, id: uid('kv') }));
  const newReqs: ApiRequest[] = [];
  const idOfIndex: string[] = [];
  const reused: string[] = [];
  const added: string[] = [];
  data.requests.forEach((r) => {
    const hit = byKey.get(requestMatchKey(r));
    if (hit) {
      idOfIndex.push(hit);
      reused.push(r.name);
      return;
    }
    const nr: ApiRequest = {
      id: uid('req'),
      collectionId: '',
      updatedAt: Date.now(),
      name: r.name,
      method: (HTTP_METHODS.includes(r.method) ? r.method : 'GET') as ApiRequest['method'],
      url: r.url,
      params: freshKv(r.params),
      headers: freshKv(r.headers),
      bodyType: r.bodyType,
      body: r.body,
      auth: r.auth,
      preRequest: r.preRequest ?? '',
      tests: r.tests ?? '',
      origin: 'imported',
    };
    newReqs.push(nr);
    byKey.set(requestMatchKey(nr), nr.id);
    idOfIndex.push(nr.id);
    added.push(r.name);
  });
  let collection: Collection | null = null;
  if (newReqs.length > 0) {
    collection = { id: uid('col'), name: data.name, folders: [], rootRequestIds: newReqs.map((r) => r.id) };
    for (const r of newReqs) r.collectionId = collection.id;
  }
  return {
    collection,
    requests: newReqs,
    flowData: {
      name: data.name,
      steps: data.steps.map((s) => ({
        requestId: idOfIndex[s.request],
        disabled: s.disabled,
        extract: s.extract,
      })),
    },
    reused,
    added,
  };
}
