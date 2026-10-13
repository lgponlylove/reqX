import type { ApiRequest, Collection } from '../types/api';
import { collectRequests, runRequestList, type RunItemResult } from '../lib/runner';
import { setScriptGate, untrustedScriptRequests } from '../lib/scripts';
import { setDefaultBaseUrl } from '../lib/http-client';
import { maskUrl } from '../lib/mask';
import { nodeHooks, type VarSnapshot } from './hooks';
import {
  buildVars,
  filterCollections,
  loadRunFile,
  parseArgs,
  referencedVarNames,
  seedFromProcessEnv,
  scriptDefinedVarNames,
  USAGE,
  type CliFlags,
  type LoadedRun,
} from './load';

export interface Io {
  log: (line: string) => void;
  warn: (line: string) => void;
}

export interface RunOutcome {
  exitCode: 0 | 1 | 2;
  items: RunItemResult[];
  failed: number;
}

type RunFlags = Pick<CliFlags, 'allowScripts' | 'timeoutMs' | 'delayMs' | 'bail' | 'onlyCollections'>;

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

/**
 * Chạy bộ collection đã nạp — biến nằm trong RAM của run, không đọc/ghi đĩa.
 * exitCode 0 = tất cả pass, 1 = có request/test fail. Ném Error khi không chạy được (main đổi thành 2).
 */
export async function runLoaded(
  loaded: LoadedRun,
  vars: VarSnapshot,
  flags: RunFlags,
  io: Io = consoleIo,
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

  const total = plan.reduce((a, p) => a + p.list.length, 0);
  const hooks = nodeHooks(vars);
  const startedAt = Date.now();
  io.log(`ReqX CLI • ${plan.length} collection • ${total} request`);

  const items: RunItemResult[] = [];
  let done = 0;
  for (const { col, list } of plan) {
    io.log(`\n▸ ${col.name} (${list.length})`);
    const out = await runRequestList(list, hooks, {
      timeoutMs: flags.timeoutMs,
      delayMs: flags.delayMs,
      stopOnError: flags.bail,
      collections: gated.run.collections,
      onItem: (r) => {
        items.push(r);
        io.log(statusLine(r, items.length - 1, total));
        if (!r.ok && r.error) io.log(`      ! ${r.error}`);
        for (const line of r.logs) io.log(`      · ${line}`);
      },
    });
    done += out.length;
    if (flags.bail && out.length < list.length) {
      io.warn(`— --bail: dừng sau ${done}/${total} request`);
      break;
    }
  }

  const failed = items.filter((r) => !r.ok).length;
  const passedTests = items.reduce((a, r) => a + r.testsPassed, 0);
  const totalTests = items.reduce((a, r) => a + r.testsTotal, 0);
  io.log(
    `\nTổng kết: ${items.length} request — ${items.length - failed} pass, ${failed} fail` +
      (totalTests ? ` • test ${passedTests}/${totalTests} đạt` : '') +
      ` • ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );
  if (hooks.writes.length > 0) {
    io.log(`Biến script đặt: ${hooks.writes.slice(0, 12).join(', ')}${hooks.writes.length > 12 ? ', …' : ''}`);
  }
  return { exitCode: failed > 0 ? 1 : 0, items, failed };
}

/** Điểm vào CLI: đọc file → dựng biến → chạy. Node không có hộp thoại duyệt script nên
 * cổng script quyết định theo cờ --allow-scripts. Trả về mã thoát 0/1/2. */
export async function main(argv: string[], io: Io = consoleIo): Promise<number> {
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
    const missing = names.filter((n) => !(n in vars.envVars) && !(n in vars.globals) && !setByScript.has(n));
    if (missing.length > 0) io.warn(`⚠ Biến chưa đặt (URL/body giữ nguyên {{...}}): ${missing.join(', ')}`);

    return (await runLoaded(loaded, vars, flags, io)).exitCode;
  } catch (e) {
    io.warn(`✗ ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}
