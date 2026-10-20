import type { RunItemResult } from '../lib/runner';
import { maskSensitiveBody, maskUrl } from '../lib/mask';
import { generateRunnerHtmlReport } from '../lib/reporter';

/**
 * Báo cáo của `reqx run`. Module này chỉ đổi kết quả chạy thành chuỗi —
 * không đọc/ghi đĩa, không gọi fetch — nên test được mà không cần CI thật.
 * Mọi text rời module đều đi qua maskSensitiveBody/maskUrl: report nằm trong
 * artifact CI, để lọt token là coi như secret đã public.
 */

export const REPORTER_NAMES = ['junit', 'json', 'html', 'csv'] as const;
export type ReporterName = (typeof REPORTER_NAMES)[number];

/** Một request đã chạy, gắn thêm collection + số thứ tự iteration để nhóm report. */
export interface ReportItem extends RunItemResult {
  collection: string;
  iteration: number;
  /** Dòng `--data` đã chạy request này — report phải chỉ ra được dòng nào gây fail. */
  data?: Record<string, string>;
}

export interface RunStats {
  startedAt: number;
  durationMs: number;
  /** Số iteration đã chạy (1 nếu không dùng --data/--iteration-count). */
  iterations: number;
  collections: string[];
  /** File nạp vào, để người đọc report biết chạy từ đâu. */
  source?: string;
  environment?: string;
  reporters: ReporterName[];
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  /** Request fail vì lỗi mạng/script (khác với fail test). */
  errored: number;
  testsPassed: number;
  testsTotal: number;
}

/**
 * Fail "kỹ thuật" = request không có HTTP status nào cả (mạng chết, timeout, script crash)
 * → lên JUnit thành <error>. Có status nhưng ngoài 2xx hoặc test không đạt → <failure>,
 * vì đó là kết quả assertions chứ không phải sự cố hạ tầng.
 */
function isTechnical(r: RunItemResult): boolean {
  return !r.ok && r.status == null;
}

export function summarize(items: RunItemResult[]): RunSummary {
  return {
    total: items.length,
    passed: items.filter((r) => r.ok).length,
    failed: items.filter((r) => !r.ok).length,
    errored: items.filter(isTechnical).length,
    testsPassed: items.reduce((a, r) => a + (r.testsPassed || 0), 0),
    testsTotal: items.reduce((a, r) => a + (r.testsTotal || 0), 0),
  };
}

function seconds(ms?: number): string {
  return ((ms && Number.isFinite(ms) ? ms : 0) / 1000).toFixed(3);
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Tên header/param nghi chứa credential — giá trị bị xóa hẳn trong report JSON. */
const SECRETISH = /(cookie|authorization|proxy-authorization|authentication|token|secret|password|passwd|api[-_]?key|access[-_]?key|signature)/i;

function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SECRETISH.test(k) ? '***' : maskSensitiveBody(v);
  }
  return out;
}

/** Body trả về có thể là ảnh/chuỗi dài — cắt ngắn, report CI không cần cả MB. */
const MAX_BODY = 4000;

function maskedBody(item: RunItemResult): { text: string; truncated: boolean } {
  const raw = item.response?.body ?? '';
  const text = maskSensitiveBody(raw);
  return { text: text.slice(0, MAX_BODY), truncated: text.length > MAX_BODY };
}

/** `--reporter csv` mở bằng Excel vẫn đúng dấu tiếng Việt: CSV luôn có BOM. */
export const CSV_BOM = '﻿';

function csvCell(value: string | number | undefined | null): string {
  const s = value == null ? '' : String(value).replace(/\r?\n/g, ' | ');
  return /[",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function cut(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

/** `user=minh ketqua=ok` — nhãn dòng data cho tên testcase và cột CSV. */
function dataLabel(item: ReportItem): string {
  const d = safeData(item);
  if (!d) return '';
  return Object.entries(d)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}

/** Cột data cũng có thể chứa credential (CSV đăng nhập hàng loạt) → che theo tên cột. */
function safeData(item: ReportItem): Record<string, string> | undefined {
  if (!item.data) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(item.data)) out[k] = SECRETISH.test(k) ? '***' : v;
  return out;
}

/** Một testcase JUnit: request fail vì mạng/script dùng <error>, fail test dùng <failure>. */
function junitCase(item: ReportItem): string {
  const label = dataLabel(item);
  const attrs =
    `classname="${esc(item.collection)}" ` +
    `name="${esc(label ? `${item.method} ${item.name} [${label}]` : `${item.method} ${item.name}`)}" ` +
    `time="${seconds(item.timeMs)}"`;
  const logs = (item.logs ?? []).map((l) => maskSensitiveBody(l)).filter((l) => l.trim() !== '');
  const parts: string[] = [];
  if (isTechnical(item)) {
    const why = item.error ?? 'request không gửi được';
    parts.push(`<error message="${esc(cut(maskSensitiveBody(why), 300))}">${esc(maskSensitiveBody(why))}</error>`);
  } else if (!item.ok) {
    const why = item.error || logs.join('\n') || `Test ${item.testsPassed}/${item.testsTotal} không đạt (HTTP ${item.status ?? '---'})`;
    parts.push(`<failure message="${esc(cut(maskSensitiveBody(why), 300))}">${esc(maskSensitiveBody(why))}</failure>`);
  }
  if (logs.length > 0) parts.push(`<system-out>${esc(logs.join('\n'))}</system-out>`);
  if (parts.length === 0) return `    <testcase ${attrs} />`;
  return `    <testcase ${attrs}>\n${parts.map((p) => `      ${p}`).join('\n')}\n    </testcase>`;
}

/** XML JUnit — định dạng Jenkins/GitLab/GitHub Actions parse được sẵn. */
export function toJUnit(items: ReportItem[], stats: RunStats): string {
  const s = summarize(items);
  const groups = new Map<string, ReportItem[]>();
  for (const it of items) {
    const key = stats.iterations > 1 ? `${it.collection} · lần ${it.iteration + 1}` : it.collection;
    const g = groups.get(key);
    if (g) g.push(it);
    else groups.set(key, [it]);
  }
  const suites = [...groups.entries()].map(([key, list]) => {
    const ls = summarize(list);
    const time = list.reduce((a, r) => a + (r.timeMs || 0), 0);
    return [
      `  <testsuite name="${esc(key)}" tests="${ls.total}" failures="${ls.failed - ls.errored}" errors="${ls.errored}" skipped="0" time="${seconds(time)}" timestamp="${new Date(stats.startedAt).toISOString()}">`,
      list.map((it) => junitCase(it)).join('\n'),
      '  </testsuite>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="ReqX" tests="${s.total}" failures="${s.failed - s.errored}" errors="${s.errored}" time="${seconds(stats.durationMs)}">`,
    suites.join('\n'),
    '</testsuites>',
    '',
  ].join('\n');
}

/** JSON machines-readable: stats + từng request, body/header đã che. */
export function toJson(items: ReportItem[], stats: RunStats): string {
  const s = summarize(items);
  const payload = {
    schema: 'reqx-run/1',
    generator: 'reqx-cli',
    startedAt: new Date(stats.startedAt).toISOString(),
    durationMs: stats.durationMs,
    iterations: stats.iterations,
    source: stats.source ?? null,
    environment: stats.environment ?? null,
    collections: stats.collections,
    stats: s,
    exitCodeHint: s.failed > 0 ? 1 : 0,
    items: items.map((it) => {
      const body = maskedBody(it);
      return {
        iteration: it.iteration,
        collection: it.collection,
        name: it.name,
        method: it.method,
        data: safeData(it) ?? null,
        url: maskUrl(it.url),
        ok: it.ok,
        status: it.status ?? null,
        timeMs: it.timeMs ?? null,
        testsPassed: it.testsPassed,
        testsTotal: it.testsTotal,
        error: it.error ? maskSensitiveBody(it.error) : null,
        logs: (it.logs ?? []).map((l) => maskSensitiveBody(l)),
        responseHeaders: it.response ? maskHeaders(it.response.headers) : null,
        responseBody: body.text || null,
        responseBodyTruncated: body.truncated,
        responseBodyKind: it.response?.bodyKind ?? null,
      };
    }),
  };
  return JSON.stringify(payload, null, 2) + '\n';
}

const CSV_HEADER = [
  'iteration',
  'collection',
  'name',
  'method',
  'data',
  'url',
  'status',
  'time_ms',
  'tests_passed',
  'tests_total',
  'result',
  'error',
  'logs',
];

/** CSV để mở Excel/Google Sheets (đã BOM + xuống dòng trong ô bằng " | "). */
export function toCsv(items: ReportItem[], stats: RunStats): string {
  void stats;
  const rows = items.map((it) =>
    [
      it.iteration + 1,
      it.collection,
      it.name,
      it.method,
      dataLabel(it),
      maskUrl(it.url),
      it.status ?? '',
      it.timeMs ?? '',
      it.testsPassed,
      it.testsTotal,
      it.ok ? 'PASS' : 'FAIL',
      maskSensitiveBody(it.error ?? ''),
      maskSensitiveBody((it.logs ?? []).join(' | ')),
    ].map(csvCell).join(','),
  );
  return CSV_BOM + [CSV_HEADER.join(','), ...rows].join('\r\n') + '\r\n';
}

/** HTML tái dùng đúng báo cáo của Runner UI — không viết bộ template thứ hai. */
export function toHtml(items: ReportItem[], stats: RunStats): string {
  const s = summarize(items);
  return generateRunnerHtmlReport({
    collectionName: stats.collections.join(' / ') || 'ReqX',
    scopeName:
      `${stats.source ? `CLI: ${stats.source}` : 'CLI run'}` +
      ` • ${s.total} request (${s.passed} pass / ${s.failed} fail)` +
      ` • ${stats.iterations} iteration`,
    results: items,
    totalTimeMs: stats.durationMs,
    environmentName: stats.environment,
  });
}

export const REPORT_EXT: Record<ReporterName, string> = {
  junit: 'xml',
  json: 'json',
  html: 'html',
  csv: 'csv',
};

export function renderReport(name: ReporterName, items: ReportItem[], stats: RunStats): string {
  if (name === 'junit') return toJUnit(items, stats);
  if (name === 'json') return toJson(items, stats);
  if (name === 'html') return toHtml(items, stats);
  return toCsv(items, stats);
}

export function parseReporterList(raw: string): { names: ReporterName[]; error?: string } {
  const parts = raw
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 1 && parts[0] === 'none') return { names: [] };
  const names: ReporterName[] = [];
  for (const p of parts) {
    if (!(REPORTER_NAMES as readonly string[]).includes(p)) {
      return { names: [], error: `--reporter không nhận "${p}" — chọn: ${REPORTER_NAMES.join(' | ')} | none` };
    }
    if (!names.includes(p as ReporterName)) names.push(p as ReporterName);
  }
  return { names };
}
