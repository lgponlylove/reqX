import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const calls: { url: string; resolved: string; envVars: Record<string, string> }[] = [];

vi.mock('../http-client', async () => {
  const actual = await vi.importActual<typeof import('../http-client')>('../http-client');
  const vars = await vi.importActual<typeof import('../variables')>('../variables');
  return {
    ...actual,
    sendRequest: vi.fn(async (req: { url: string }, envVars: Record<string, string>, globals?: Record<string, string>) => {
      calls.push({
        url: req.url,
        resolved: vars.resolveVariables(req.url, envVars, globals ?? {}).resolved,
        envVars: { ...envVars },
      });
      const fail = String(req.url).includes('/fail');
      return {
        status: fail ? 500 : 200,
        statusText: fail ? 'Internal Server Error' : 'OK',
        timeMs: 12,
        sizeBytes: 20,
        headers: { 'content-type': 'application/json', 'set-cookie': 'session=ABCDEF123456' },
        body: '{"token":"SUPERSECRET","ok":true}',
        bodyKind: 'text' as const,
      };
    }),
  };
});

import { iterationPlan, reportDirFor, runLoaded, writeReports, type Io } from '../../cli/run';
import { loadJsonValue, parseArgs } from '../../cli/load';
import {
  CSV_BOM,
  parseReporterList,
  summarize,
  toCsv,
  toHtml,
  toJson,
  toJUnit,
  type ReportItem,
  type RunStats,
} from '../../cli/report';
import type { RunItemResult } from '../../lib/runner';

const TMP_OUT = join(tmpdir(), 'reqx-cli-report-test');

/** A có test + body chứa token, B luôn fail, C đọc biến data file. */
function fixture() {
  return {
    info: { name: 'Reporter QA', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [
      {
        name: 'A',
        event: [
          {
            listen: 'test',
            script: { type: 'text/javascript', exec: ["pm.test('mau 200', () => pm.response.to.have.status(200));"] },
          },
        ],
        request: { method: 'GET', url: '{{baseUrl}}/user?name={{username}}' },
      },
      { name: 'B', request: { method: 'GET', url: '{{baseUrl}}/fail' } },
      { name: 'C', request: { method: 'GET', url: '{{baseUrl}}/c?u={{username}}' } },
    ],
  };
}

function collectingIo() {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { log: (l) => out.push(l), warn: (l) => err.push(l) };
  return { io, out: () => out.join('\n'), err: () => err.join('\n') };
}

function item(over: Partial<ReportItem> = {}): ReportItem {
  return {
    requestId: 'r1',
    name: 'A',
    method: 'GET',
    url: 'http://api.test/a',
    ok: true,
    status: 200,
    timeMs: 1500,
    testsPassed: 2,
    testsTotal: 2,
    logs: [],
    collection: 'Reporter QA',
    iteration: 0,
    ...over,
  };
}

const stats: RunStats = {
  startedAt: 1_700_000_000_000,
  durationMs: 3000,
  iterations: 1,
  collections: ['Reporter QA'],
  source: 'qa.json',
  environment: 'dev.json',
  reporters: ['junit'],
};

const baseFlags = {
  allowScripts: true,
  timeoutMs: 1000,
  delayMs: 0,
  bail: false,
  onlyCollections: [] as string[],
};
const baseVars = { envVars: { baseUrl: 'http://api.test' }, globals: {} };

beforeEach(() => {
  calls.length = 0;
  rmSync(TMP_OUT, { recursive: true, force: true });
});

describe('cli/report — dựng chuỗi báo cáo', () => {
  it('junit: fail vì test dùng <failure>, fail vì lỗi dùng <error>, pass thì testcase tự đóng', () => {
    const xml = toJUnit(
      [
        item(),
        item({ name: 'B', ok: false, status: 500, testsPassed: 0, testsTotal: 1, logs: ['expect 200 got 500'] }),
        item({ name: 'C', ok: false, status: undefined, timeMs: undefined, error: 'fetch failed: ECONNREFUSED' }),
      ],
      stats,
    );
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<testsuites name="ReqX" tests="3" failures="1" errors="1"');
    expect(xml).toContain('<testsuite name="Reporter QA" tests="3" failures="1" errors="1" skipped="0"');
    expect(xml).toContain('<testcase classname="Reporter QA" name="GET A" time="1.500" />');
    expect(xml).toContain('<failure message="');
    expect(xml).toContain('<error message="fetch failed: ECONNREFUSED"');
    expect(xml).toContain('<system-out>expect 200 got 500</system-out>');
    expect((xml.match(/<testsuites[^>]*>/) ?? [])[0]).not.toMatch(/tests=.*tests=/);
  });

  it('junit: escape ký tự XML trong tên request và log', () => {
    const xml = toJUnit([item({ name: 'A & <B>', ok: false, logs: ['a < b & c'] })], stats);
    expect(xml).toContain('name="GET A &amp; &lt;B&gt;"');
    expect(xml).toContain('a &lt; b &amp; c');
  });

  it('junit: tách testsuite theo iteration khi chạy data file', () => {
    const xml = toJUnit([item(), item({ iteration: 1 })], { ...stats, iterations: 2 });
    expect(xml).toContain('<testsuite name="Reporter QA · lần 1"');
    expect(xml).toContain('<testsuite name="Reporter QA · lần 2"');
  });

  it('json: che token trong body, header nhạy cảm và URL; giữ thống kê', () => {
    const raw = toJson(
      [
        item({
          url: 'http://api.test/a?token=AAA',
          response: {
            status: 200,
            headers: { authorization: 'Bearer XYZ', 'x-trace': 't1' },
            body: '{"token":"AAA","user":"minh"}',
            bodyKind: 'text',
          },
        }),
      ],
      stats,
    );
    expect(raw).not.toContain('AAA');
    expect(raw).not.toContain('XYZ');
    const json = JSON.parse(raw);
    expect(json.stats.total).toBe(1);
    expect(json.exitCodeHint).toBe(0);
    expect(json.items[0].responseHeaders.authorization).toBe('***');
    expect(json.items[0].responseHeaders['x-trace']).toBe('t1');
  });

  it('csv: có BOM, xuống dòng CRLF, escape dấu phẩy/ngoặc kép, lỗi nhiều dòng gom 1 ô', () => {
    const csv = toCsv([item({ name: 'a,b "c"', ok: false, error: 'lỗi 1 dòng\nlỗi 2 dòng' })], stats);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain('"a,b ""c"""');
    expect(csv).toContain('lỗi 1 dòng | lỗi 2 dòng');
    const lines = csv.slice(CSV_BOM.length).trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('iteration,collection,name,method,data,url,status,time_ms,tests_passed,tests_total,result,error,logs');
  });

  it('dòng --data hiện trong junit/csv/json và cột data ẩn giá trị nghi là credential', () => {
    const withData = item({ data: { username: 'minh', password: 'TopSecret123' } });
    const csv = toCsv([withData], stats);
    expect(csv).toContain('username=minh password=***');
    const xml = toJUnit([withData], { ...stats, iterations: 2 });
    expect(xml).toContain('name="GET A [username=minh password=***]"');
    const json = JSON.parse(toJson([withData], stats));
    expect(json.items[0].data).toEqual({ username: 'minh', password: '***' });
    expect(JSON.stringify(json)).not.toContain('TopSecret123');
  });

  it('html: tái dùng báo cáo Runner UI, nội dung đã che', () => {
    const html = toHtml(
      [item({ url: 'http://api.test/a?token=AAA', response: { status: 200, headers: {}, body: '{"token":"AAA"}', bodyKind: 'text' } })],
      stats,
    );
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('ReqX Test Report');
    expect(html).not.toContain('AAA');
    expect(html).toContain('CLI: qa.json');
  });

  it('summarize: tách request fail vì lỗi (không có HTTP status) khỏi fail vì test', () => {
    const s = summarize([
      item(),
      item({ name: 'X', ok: false, status: undefined, testsPassed: 0, testsTotal: 0, error: 'fetch failed' }),
      item({ name: 'Y', ok: false, status: 500, testsPassed: 0, testsTotal: 1, error: 'HTTP 500' }),
    ]);
    expect(s).toMatchObject({ total: 3, passed: 1, failed: 2, errored: 1, testsTotal: 3, testsPassed: 2 });
  });

  it('reportDirFor: --out thắng, mặc định reqx-report cạnh file collection', () => {
    expect(reportDirFor({ outDir: 'reports' })).toBe(join(process.cwd(), 'reports'));
    expect(reportDirFor({ source: 'qa.json' })).toBe(join(process.cwd(), 'reqx-report'));
    expect(reportDirFor({})).toBe(join(process.cwd(), 'reqx-report'));
  });

  it('writeReports: đặt tên file theo tên collection, trả về [] khi không chọn reporter', () => {
    const files = writeReports([item()], { ...stats, reporters: ['junit', 'csv'] }, TMP_OUT);
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.replace(/\\/g, '/'))).toEqual([`${TMP_OUT.replace(/\\/g, '/')}/qa.xml`, `${TMP_OUT.replace(/\\/g, '/')}/qa.csv`]);
    expect(existsSync(join(TMP_OUT, 'qa.csv'))).toBe(true);
    expect(writeReports([item()], { ...stats, reporters: [] }, TMP_OUT)).toEqual([]);
  });
});

describe('cli/load — cờ P1', () => {
  it('--reporter nhận danh sách, none = không ghi, tên lạ báo lỗi', () => {
    expect(parseArgs(['run', 'a.json', '--reporter', 'junit,csv']).flags.reporters).toEqual(['junit', 'csv']);
    expect(parseArgs(['run', 'a.json', '--reporter=none']).flags.reporters).toEqual([]);
    expect(parseArgs(['run', 'a.json', '--reporter', 'docx']).errors[0]).toMatch(/--reporter không nhận "docx"/);
    expect(parseReporterList('junit,junit').names).toEqual(['junit']);
  });

  it('--data / --out / --iteration-count hợp lệ và chặn số không ra số', () => {
    const { flags, errors } = parseArgs([
      'run', 'a.json', '--data', 'rows.csv', '--out', 'reports', '--iteration-count', '3',
    ]);
    expect(errors).toEqual([]);
    expect(flags).toMatchObject({ dataFile: 'rows.csv', outDir: 'reports', iterationCount: 3 });
    expect(parseArgs(['run', 'a.json', '--iteration-count', '0']).errors[0]).toMatch(/số nguyên >= 1/);
    expect(parseArgs(['run', 'a.json', '--iteration-count', '1.5']).errors[0]).toMatch(/số nguyên >= 1/);
  });
});

describe('cli — data file + báo cáo khi chạy thật', () => {
  it('iterationPlan: chạy theo số dòng data, --iteration-count chỉ thắng khi lớn hơn', () => {
    expect(iterationPlan([{}, {}, {}])).toBe(3);
    expect(iterationPlan([{}, {}], 1)).toBe(2);
    expect(iterationPlan([{}, {}], 5)).toBe(5);
    expect(iterationPlan([{}], 4)).toBe(4);
    expect(iterationPlan([{}])).toBe(1);
  });

  it('--data 2 dòng: chạy 2 iteration, item mang đúng iteration + collection', async () => {
    const { io, out } = collectingIo();
    const res = await runLoaded(
      loadJsonValue(fixture(), 'qa.json'),
      baseVars,
      baseFlags,
      io,
      { rows: [{ username: 'minh' }, { username: 'hoa' }], columns: ['username'] },
    );
    expect(res.exitCode).toBe(1); // request B luôn fail
    expect(res.items).toHaveLength(6);
    expect([...new Set(res.items.map((r) => r.iteration))]).toEqual([0, 1]);
    expect(res.items.every((r) => r.collection === 'Reporter QA')).toBe(true);
    expect(out()).toContain('=== Iteration 1/2 · username=minh');
    expect(out()).toContain('=== Iteration 2/2 · username=hoa');
    expect(out()).toContain('Tổng kết: 6 request — 4 pass, 2 fail');
  });

  it('{{username}} trong URL được thay theo từng dòng data', async () => {
    const { io } = collectingIo();
    await runLoaded(
      loadJsonValue(fixture(), 'qa.json'),
      baseVars,
      baseFlags,
      io,
      { rows: [{ username: 'minh' }, { username: 'hoa' }], columns: ['username'] },
    );
    expect(calls.filter((c) => c.resolved.includes('/user')).map((c) => c.resolved)).toEqual([
      'http://api.test/user?name=minh',
      'http://api.test/user?name=hoa',
    ]);
    expect(calls.filter((c) => c.resolved.includes('/c?')).map((c) => c.resolved)).toEqual([
      'http://api.test/c?u=minh',
      'http://api.test/c?u=hoa',
    ]);
    // dòng data nằm trong envVars mà runner đưa xuống http-client (3 request/iteration)
    expect(calls.map((c) => c.envVars.username)).toEqual(['minh', 'minh', 'minh', 'hoa', 'hoa', 'hoa']);
  });

  it('--iteration-count 3 không có data file: chạy lại đúng 3 lần', async () => {
    const { io } = collectingIo();
    const res = await runLoaded(
      loadJsonValue(fixture(), 'qa.json'),
      baseVars,
      { ...baseFlags, iterationCount: 3 },
      io,
    );
    expect(res.items).toHaveLength(9);
    expect(calls.filter((c) => c.url.includes('/user'))).toHaveLength(3);
  });

  it('--bail trong run nhiều iteration: dừng hẳn, không sang iteration kế', async () => {
    const { io, err } = collectingIo();
    const res = await runLoaded(
      loadJsonValue(fixture(), 'qa.json'),
      baseVars,
      { ...baseFlags, bail: true },
      io,
      { rows: [{ username: 'minh' }, { username: 'hoa' }], columns: ['username'] },
    );
    // A pass, B fail → dừng ngay ở request 2 của iteration 1
    expect(res.items.map((r) => r.name)).toEqual(['A', 'B']);
    expect(err()).toMatch(/--bail: dừng sau 2\/3 request của iteration 1/);
  });

  it('--reporter junit,csv,json --out: run ghi file, in đường dẫn và report không còn secret', async () => {
    const { io, out } = collectingIo();
    await runLoaded(
      loadJsonValue(fixture(), 'qa.json'),
      baseVars,
      { ...baseFlags, reporters: ['junit', 'csv', 'json'], outDir: TMP_OUT, source: 'qa.json' },
      io,
    );
    expect(out()).toMatch(/→ báo cáo .*qa\.xml/);
    expect(existsSync(join(TMP_OUT, 'qa.xml'))).toBe(true);
    expect(existsSync(join(TMP_OUT, 'qa.csv'))).toBe(true);
    const json = readFileSync(join(TMP_OUT, 'qa.json'), 'utf8');
    expect(json).not.toContain('SUPERSECRET');
    expect(json).toContain('***');
    const xml = readFileSync(join(TMP_OUT, 'qa.xml'), 'utf8');
    expect(xml).toContain('<testsuites name="ReqX" tests="3"');
    expect(xml).toContain('failures="1"');
  });

  it('report fail vì không ghi được đĩa thì run vẫn trả mã thoát của test, có cảnh báo', async () => {
    const { io, err } = collectingIo();
    const res = await runLoaded(
      loadJsonValue(fixture(), 'qa.json'),
      baseVars,
      { ...baseFlags, reporters: ['junit'], outDir: TMP_OUT, source: 'qa.json' },
      io,
    );
    expect(res.exitCode).toBe(1);
    expect(err()).toBe('');
    // Đè một file lên vị trí thư mục report để mkdirSync/writeFileSync hỏng
    const blocker = join(TMP_OUT, 'qa.xml');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(TMP_OUT, { recursive: true });
    writeFileSync(blocker, 'x');
    const { io: io2, err: err2 } = collectingIo();
    const res2 = await runLoaded(
      loadJsonValue(fixture(), 'qa.json'),
      baseVars,
      { ...baseFlags, reporters: ['csv'], outDir: blocker, source: 'qa.json' },
      io2,
    );
    expect(res2.exitCode).toBe(1);
    expect(err2()).toMatch(/Không ghi được báo cáo/);
  });
});

describe('kiểu trả về khớp runner', () => {
  it('ReportItem là RunItemResult + collection/iteration', () => {
    const it: RunItemResult = item();
    expect(it.ok).toBe(true);
    expect(item().collection).toBe('Reporter QA');
  });
});
