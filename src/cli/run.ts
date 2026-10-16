import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { ApiRequest, Collection } from '../types/api';
import { collectRequests, runRequestList, type RunItemResult } from '../lib/runner';
import { setScriptGate, untrustedScriptRequests } from '../lib/scripts';
import { setDefaultBaseUrl } from '../lib/http-client';
import { maskUrl } from '../lib/mask';
import { nodeHooks, type VarSnapshot } from './hooks';
import {
  renderReport,
  summarize,
  REPORT_EXT,
  type ReportItem,
  type ReporterName,
  type RunStats,
} from './report';
import {
  buildVars,
  filterCollections,
  loadDataFile,
  loadRunFile,
  parseArgs,
  referencedVarNames,
  seedFromProcessEnv,
  scriptDefinedVarNames,
  USAGE,
  type CliFlags,
  type LoadedRun,
} from './load';
import { LINT_USAGE, runLint } from './lint';
import { runCiInit } from './ci';

export interface Io {
  log: (line: string) => void;
  warn: (line: string) => void;
}

export interface RunOutcome {
  exitCode: 0 | 1 | 2;
  items: ReportItem[];
  failed: number;
}

type RunFlags = Pick<CliFlags, 'allowScripts' | 'timeoutMs' | 'delayMs' | 'bail' | 'onlyCollections'> &
  Partial<Pick<CliFlags, 'reporters' | 'outDir' | 'iterationCount'>> & {
    /** Tên file nạp vào — chỉ để ghi lên report, CLI không đọc lại từ nó. */
    source?: string;
    /** nhãn môi trường in trên report (tên file --env cuối). */
    environment?: string;
  };

export interface DataArg {
  rows: Record<string, string>[];
  columns: string[];
}

const consoleIo: Io = {
  log: (line) => process.stdout.write(line + '\n'),
  warn: (line) => process.stderr.write(line + '\n'),
};

/** Cắt script của request import (không có --allow-scripts) — chỉ ở collection có request bị chặn. */
export function stripUntrustedScripts(run: LoadedRun): { run: LoadedRun; blocked: ApiRequest[] } {
  const blocked = untrustedScriptRequests(Object.values(run.requests), run.collections);
  if (blocked.length === 0) return { run, blocked };

  const blockedIds = new Set(blocked.map((r) => r.id));
  const affected = new Set(blocked.map((r) => r.collectionId).filter(Boolean) as string[]);
  const collections: Collection[] = run.collections.map((c) =>
    affected.has(c.id)
      ? { ...c, preRequest: '', tests: '', folders: c.folders.map((f) => ({ ...f, preRequest: '', tests: '' })) }
      : c,
  );
  const requests: Record<string, ApiRequest> = {};
  for (const [id, r] of Object.entries(run.requests)) {
    requests[id] = blockedIds.has(id) ? { ...r, preRequest: '', tests: '' } : r;
  }
  return { run: { collections, requests, warnings: run.warnings }, blocked };
}

function statusLine(r: RunItemResult, index: number, total: number): string {
  const time = r.timeMs == null ? '-' : `${r.timeMs}ms`;
  const tests = r.testsTotal > 0 ? `${r.testsPassed}/${r.testsTotal}` : '-';
  return `[${index + 1}/${total}] ${r.ok ? 'PASS' : 'FAIL'} ${r.method} ${maskUrl(r.url)} ${r.status ?? '---'} ${time} ${tests}`;
}

/** Số thứ tự iteration: có data file thì chạy theo số dòng, --iteration-count chỉ thắng khi lớn hơn. */
export function iterationPlan(rows: Record<string, string>[], iterationCount?: number): number {
  const asked = iterationCount && iterationCount > 1 ? iterationCount : 0;
  return Math.max(rows.length, asked, 1);
}

/** Thư mục ghi report: --out nếu có, mặc định reqx-report/ ngay cạnh file collection. */
export function reportDirFor(flags: { outDir?: string; source?: string }): string {
  if (flags.outDir) return resolve(flags.outDir);
  const base = flags.source ? dirname(resolve(flags.source)) : process.cwd();
  return join(base, 'reqx-report');
}

/** Ghi từng báo cáo xuống đĩa, trả về danh sách đường dẫn đã ghi. */
export function writeReports(items: ReportItem[], stats: RunStats, dir: string): string[] {
  if (stats.reporters.length === 0) return [];
  mkdirSync(dir, { recursive: true });
  const stem = stats.source ? basename(stats.source).replace(/\.(json|bak)$/i, '') : 'reqx-run';
  return stats.reporters.map((name: ReporterName) => {
    const file = join(dir, `${stem}.${REPORT_EXT[name]}`);
    writeFileSync(file, renderReport(name, items, stats), 'utf8');
    return file;
  });
}

/**
 * Chạy bộ collection đã nạp — biến nằm trong RAM của run, không đọc/ghi đĩa
 * (trừ file report khi có --reporter).
 * exitCode 0 = tất cả pass, 1 = có request/test fail. Ném Error khi không chạy được (main đổi thành 2).
 */
export async function runLoaded(
  loaded: LoadedRun,
  vars: VarSnapshot,
  flags: RunFlags,
  io: Io = consoleIo,
  data?: DataArg,
): Promise<RunOutcome> {
  const filtered = filterCollections(loaded, flags.onlyCollections);
  const gated = flags.allowScripts ? { run: filtered, blocked: [] as ApiRequest[] } : stripUntrustedScripts(filtered);
  if (gated.blocked.length > 0) {
    io.warn(
      `⚠ ${gated.blocked.length} request mang script từ file import — đã bỏ script. Thêm --allow-scripts nếu bạn tin nguồn file.`,
    );
  }

  const plan = gated.run.collections
    .map((col) => ({ col, list: collectRequests(col, gated.run.requests, 'all') }))
    .filter((p) => p.list.length > 0);
  if (plan.length === 0) throw new Error('File không có request nào để chạy');

  const rows: Record<string, string>[] = data && data.rows.length > 0 ? data.rows : [{}];
  const iterations = iterationPlan(rows, flags.iterationCount);
  const perPass = plan.reduce((a, p) => a + p.list.length, 0);
  const total = perPass * iterations;
  const startedAt = Date.now();
  const hooks = nodeHooks(vars);
  io.log(
    `ReqX CLI • ${plan.length} collection • ${perPass} request` +
      (iterations > 1 ? ` • ${iterations} iteration` : ''),
  );
  if (data) io.log(`Data file: ${data.rows.length} dòng × ${data.columns.length} cột (${data.columns.join(', ')})`);

  const items: ReportItem[] = [];
  for (let it = 0; it < iterations; it++) {
    const row = rows[it % rows.length];
    const label = Object.entries(row).map(([k, v]) => `${k}=${v}`).join(' ');
    if (iterations > 1) io.log(`\n=== Iteration ${it + 1}/${iterations}${label ? ` · ${label}` : ''}`);
    let done = 0;
    let stopped = false;
    for (const { col, list } of plan) {
      io.log(`\n▸ ${col.name} (${list.length})`);
      const out = await runRequestList(list, hooks, {
        timeoutMs: flags.timeoutMs,
        delayMs: flags.delayMs,
        stopOnError: flags.bail,
        collections: gated.run.collections,
        dataRow: row,
        onItem: (r) => {
          items.push({ ...r, collection: col.name, iteration: it, ...(label ? { data: row } : {}) });
          io.log(statusLine(r, items.length - 1, total));
          if (!r.ok && r.error) io.log(`      ! ${r.error}`);
          for (const line of r.logs) io.log(`      · ${line}`);
        },
      });
      done += out.length;
      if (flags.bail && out.length < list.length) {
        stopped = true;
        break;
      }
    }
    if (stopped) {
      io.warn(`— --bail: dừng sau ${done}/${perPass} request của iteration ${it + 1}`);
      break;
    }
  }

  const s = summarize(items);
  const passedTests = s.testsPassed;
  const totalTests = s.testsTotal;
  io.log(
    `\nTổng kết: ${s.total} request — ${s.passed} pass, ${s.failed} fail` +
      (totalTests ? ` • test ${passedTests}/${totalTests} đạt` : '') +
      ` • ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );
  if (hooks.writes.length > 0) {
    io.log(`Biến script đặt: ${hooks.writes.slice(0, 12).join(', ')}${hooks.writes.length > 12 ? ', …' : ''}`);
  }

  const stats: RunStats = {
    startedAt,
    durationMs: Date.now() - startedAt,
    iterations,
    collections: plan.map((p) => p.col.name),
    source: flags.source,
    environment: flags.environment,
    reporters: flags.reporters ?? [],
  };
  if (stats.reporters.length > 0) {
    const dir = reportDirFor(flags);
    try {
      for (const file of writeReports(items, stats, dir)) io.log(`→ báo cáo ${file}`);
    } catch (e) {
      // Report không ghi được thì run vẫn có giá trị — báo rõ, không đổi mã thoát
      io.warn(`✗ Không ghi được báo cáo vào "${dir}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { exitCode: s.failed > 0 ? 1 : 0, items, failed: s.failed };
}

/** Lệnh phụ đi trước cờ: `reqx env lint`, `reqx ci init`. Trả về undefined nếu đây là lệnh run. */
function dispatch(argv: string[], io: Io): number | undefined {
  if (argv[0] === 'env' && argv[1] === 'lint') {
    const { flags, errors } = parseArgs(argv.slice(2));
    if (flags.help) {
      io.log(LINT_USAGE);
      return errors.length > 0 ? 2 : 0;
    }
    if (errors.length > 0) {
      for (const e of errors) io.warn(`✗ ${e}`);
      return 2;
    }
    return runLint(flags, io);
  }
  if (argv[0] === 'ci' && argv[1] === 'init') return runCiInit(argv.slice(2), io);
  if (argv[0] === 'env' || argv[0] === 'ci') {
    io.warn(`✗ Lệnh phụ không biết: "${argv.slice(0, 2).join(' ')}"`);
    io.warn('\n' + USAGE);
    return 2;
  }
  return undefined;
}

/** Điểm vào CLI: đọc file → dựng biến → chạy. Node không có hộp thoại duyệt script nên
 * cổng script quyết định theo cờ --allow-scripts. Trả về mã thoát 0/1/2. */
export async function main(argv: string[], io: Io = consoleIo): Promise<number> {
  const sub = dispatch(argv, io);
  if (sub !== undefined) return sub;
  const { flags, errors } = parseArgs(argv);
  setScriptGate(() => flags.allowScripts);
  if (flags.help) {
    io.log(USAGE);
    return errors.length > 0 ? 2 : 0;
  }
  if (flags.version) {
    io.log('reqx-cli 0.1.0');
    return 0;
  }
  if (errors.length > 0) {
    for (const e of errors) io.warn(`✗ ${e}`);
    io.warn('\n' + USAGE);
    return 2;
  }
  if (!flags.file) {
    io.warn('✗ Thiếu file collection');
    return 2;
  }

  try {
    setDefaultBaseUrl(flags.baseUrl);
    const loaded = loadRunFile(flags.file);
    for (const w of loaded.warnings) io.warn(`• ${w}`);

    const vars = buildVars(flags);
    const names = referencedVarNames(loaded);
    const seeded = seedFromProcessEnv(names, vars.envVars, vars.globals);
    if (seeded.length > 0) io.log(`Nạp ${seeded.length} biến từ môi trường hệ thống: ${seeded.join(', ')}`);
    // Script bị bỏ khi không có --allow-scripts thì biến nó đặt cũng coi như chưa có
    const setByScript = flags.allowScripts ? scriptDefinedVarNames(loaded) : new Set<string>();
    // Data file nạp trước khi chấm biến thiếu: cột `{{user}}` trong CSV không phải biến chưa đặt
    let data: DataArg | undefined;
    if (flags.dataFile) {
      data = loadDataFile(flags.dataFile);
      const unknown = data.columns.filter((c) => !names.includes(c));
      if (unknown.length > 0) {
        io.warn(`• Cột data không thấy {{...}} nào dùng: ${unknown.join(', ')}`);
      }
    }
    const fromData = new Set(data?.columns ?? []);
    const missing = names.filter(
      (n) => !(n in vars.envVars) && !(n in vars.globals) && !setByScript.has(n) && !fromData.has(n),
    );
    if (missing.length > 0) io.warn(`⚠ Biến chưa đặt (URL/body giữ nguyên {{...}}): ${missing.join(', ')}`);

    return (
      await runLoaded(loaded, vars, {
        ...flags,
        source: flags.file,
        environment: flags.envFiles.length > 0 ? basename(flags.envFiles[flags.envFiles.length - 1]) : undefined,
      }, io, data)
    ).exitCode;
  } catch (e) {
    io.warn(`✗ ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}
