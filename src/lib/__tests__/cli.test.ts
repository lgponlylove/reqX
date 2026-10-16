import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

interface Call {
  name: string;
  url: string;
  envVars: Record<string, string>;
}
const calls: Call[] = [];
let nextStatus = 200;

vi.mock('../http-client', async () => {
  const actual = await vi.importActual<typeof import('../http-client')>('../http-client');
  return {
    ...actual,
    sendRequest: vi.fn(async (req: { name: string; url: string }, envVars: Record<string, string>) => {
      calls.push({ name: req.name, url: req.url, envVars: { ...envVars } });
      const fail = String(req.url).includes('/fail');
      return {
        status: fail ? 500 : nextStatus,
        statusText: fail ? 'Internal Server Error' : 'OK',
        timeMs: 12,
        sizeBytes: 11,
        headers: { 'content-type': 'application/json' },
        body: '{"ok":true}',
        bodyKind: 'text' as const,
      };
    }),
  };
});

import { main, runLoaded, stripUntrustedScripts, type Io } from '../../cli/run';
import {
  loadJsonValue,
  parseArgs,
  referencedVarNames,
  scriptDefinedVarNames,
  seedFromProcessEnv,
  varFileToJson,
} from '../../cli/load';

const TMP = join(tmpdir(), 'reqx-cli-test-collection.json');

/** Postman v2.1: A đặt biến, B có test, C đọc biến của A. */
function fixture(failPath: string | null = null) {
  return {
    info: { name: 'QA Smoke', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [
      {
        name: 'A',
        event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: ["pm.environment.set('userId', '42');"] } }],
        request: { method: 'GET', url: '{{baseUrl}}/a' },
      },
      {
        name: 'B',
        event: [
          {
            listen: 'test',
            script: { type: 'text/javascript', exec: ["pm.test('mau 200', () => pm.response.to.have.status(200));"] },
          },
        ],
        request: { method: 'POST', url: '{{baseUrl}}/b', body: { mode: 'raw', raw: '{"x":1}' } },
      },
      { name: 'C', request: { method: 'GET', url: `{{baseUrl}}/${failPath ?? 'c'}?uid={{userId}}` } },
    ],
  };
}

const baseVars = { envVars: { baseUrl: 'http://api.test' }, globals: {} };
const runFlags = { allowScripts: true, timeoutMs: 1000, delayMs: 0, bail: false, onlyCollections: [] as string[] };

function collectingIo() {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { log: (l) => out.push(l), warn: (l) => err.push(l) };
  return { io, out: () => out.join('\n'), err: () => err.join('\n') };
}

beforeEach(() => {
  calls.length = 0;
  nextStatus = 200;
});

describe('cli/load — parseArgs', () => {
  it('nhận đủ cờ, gom --env nhiều lần, --var cả hai dạng', () => {
    const { flags, errors } = parseArgs([
      'run', 'col.json', '--env', 'a.json', '--env=b.json',
      '--var', 'K=V', '--var=TOKEN=abc', '--collection', 'QA', '--allow-scripts',
      '--base-url', 'http://127.0.0.1:3000', '--timeout', '5000', '--delay', '200', '--bail',
    ]);
    expect(errors).toEqual([]);
    expect(flags.file).toBe('col.json');
    expect(flags.envFiles).toEqual(['a.json', 'b.json']);
    expect(flags.vars).toEqual({ K: 'V', TOKEN: 'abc' });
    expect(flags.onlyCollections).toEqual(['QA']);
    expect(flags).toMatchObject({
      allowScripts: true, bail: true, timeoutMs: 5000, delayMs: 200, baseUrl: 'http://127.0.0.1:3000',
    });
  });

  it('báo lỗi cờ lạ, cờ thiếu giá trị, --var sai dạng, timeout không phải số', () => {
    expect(parseArgs(['run', 'a.json', '--nope']).errors).toContain('Lựa chọn không biết: "--nope"');
    expect(parseArgs(['run', 'a.json', '--env']).errors[0]).toMatch(/Thiếu giá trị cho --env/);
    expect(parseArgs(['run', 'a.json', '--var', 'KV']).errors[0]).toMatch(/--var cần dạng K=V/);
    expect(parseArgs(['run', 'a.json', '--timeout', 'abc']).errors[0]).toMatch(/số ms/);
    expect(parseArgs(['run']).errors[0]).toMatch(/Thiếu file collection/);
  });

  it('--help / --version không bắt buộc có file', () => {
    expect(parseArgs(['run', '--help'])).toMatchObject({ errors: [], flags: { help: true } });
    expect(parseArgs(['run', '--version']).flags.version).toBe(true);
  });
});

describe('cli/load — đọc file và dựng biến', () => {
  it('collection Postman v2.1 → 1 collection + 3 request', () => {
    const run = loadJsonValue(fixture(), 'col.json');
    expect(run.collections.map((c) => c.name)).toEqual(['QA Smoke']);
    expect(Object.keys(run.requests)).toHaveLength(3);
  });

  it('quy chiếu biến từ url/header/script, bỏ qua collection không có {{}}', () => {
    const run = loadJsonValue(fixture(), 'col.json');
    expect(referencedVarNames(run).sort()).toEqual(['baseUrl', 'userId']);
    expect(scriptDefinedVarNames(run)).toEqual(new Set(['userId']));
    const plain = loadJsonValue({ info: { name: 'X' }, item: [{ name: 'A', request: { method: 'GET', url: 'http://x/a' } }] }, 'x.json');
    expect(referencedVarNames(plain)).toEqual([]);
  });

  it('seedFromProcessEnv chỉ nạp biến đang thiếu, không ghi đè file biến', () => {
    const envVars: Record<string, string> = { baseUrl: 'http://file' };
    const seeded = seedFromProcessEnv(['baseUrl', 'TOKEN', 'ABSENT'], envVars, {}, { TOKEN: 'xyz', PATH: '/bin' });
    expect(seeded).toEqual(['TOKEN']);
    expect(envVars).toEqual({ baseUrl: 'http://file', TOKEN: 'xyz' });
  });

  it('varFileToJson hỗ trợ Postman env, ReqX env, map trần', () => {
    expect(varFileToJson({ values: [{ key: 'a', value: '1' }, { key: 'b', value: '2', enabled: false }] })).toEqual({ a: '1' });
    expect(varFileToJson({ name: 'E', variables: { a: '1', b: 2 } })).toEqual({ a: '1', b: '2' });
    expect(varFileToJson({ a: '1', b: null })).toEqual({ a: '1' });
    expect(() => varFileToJson([1, 2], 'ac.json')).toThrow(/phải là object/);
  });

  it('file lạ định dạng → báo lỗi rõ, không chạy im', () => {
    expect(() => loadJsonValue({ hello: 'world' }, 'odd.json')).toThrow(/không phải collection Postman/);
    expect(() => loadJsonValue({ kind: 'reqx-backup' }, 'bad.json')).toThrow(/backup ReqX "bad.json" không có collection nào/);
  });
});

describe('cli/run — thứ tự, truyền biến, mã thoát', () => {
  it('chạy A→B→C, biến A đặt đọc được ở C, exit 0', async () => {
    const { io, out } = collectingIo();
    const res = await runLoaded(loadJsonValue(fixture(), 'col.json'), baseVars, runFlags, io);

    expect(calls.map((c) => c.name)).toEqual(['A', 'B', 'C']);
    expect(calls[2].envVars.userId).toBe('42');
    expect(calls[2].envVars.baseUrl).toBe('http://api.test');
    expect(res.exitCode).toBe(0);
    expect(res.items.map((i) => i.name)).toEqual(['A', 'B', 'C']);
    expect(res.items[1].testsTotal).toBe(1);
    expect(out()).toContain('[3/3] PASS GET {{baseUrl}}/c?uid={{userId}} 200');
  });

  it('HTTP 500 → exit 1', async () => {
    const { io, out } = collectingIo();
    const res = await runLoaded(loadJsonValue(fixture('fail'), 'col.json'), baseVars, runFlags, io);
    expect(res.exitCode).toBe(1);
    expect(res.failed).toBe(1);
    expect(out()).toContain('2 pass, 1 fail');
  });

  it('test fail (status khác mong đợi) → exit 1', async () => {
    nextStatus = 500;
    const { io } = collectingIo();
    const res = await runLoaded(loadJsonValue(fixture(), 'col.json'), baseVars, runFlags, io);
    const b = res.items.find((i) => i.name === 'B');
    expect(b?.ok).toBe(false);
    expect(b?.error).toMatch(/mau 200/);
    expect(res.exitCode).toBe(1);
  });

  it('--bail dừng ngay sau request lỗi', async () => {
    const run = loadJsonValue(fixture(), 'col.json');
    for (const r of Object.values(run.requests)) if (r.name === 'A') r.url = '{{baseUrl}}/fail';
    const { io, err } = collectingIo();
    const res = await runLoaded(run, baseVars, { ...runFlags, bail: true }, io);
    expect(res.items).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(err()).toMatch(/--bail/);
  });

  it('--collection lọc theo tên (bỏ hoa thường), tên không khớp → lỗi', async () => {
    const run = loadJsonValue(fixture(), 'col.json');
    const ok = await runLoaded(run, baseVars, { ...runFlags, onlyCollections: ['qa smoke'] }, collectingIo().io);
    expect(ok.exitCode).toBe(0);
    await expect(
      runLoaded(run, baseVars, { ...runFlags, onlyCollections: ['khong-co'] }, collectingIo().io),
    ).rejects.toThrow(/Không collection nào khớp/);
  });

  it('file không có request → lỗi "không có request nào"', async () => {
    const run = loadJsonValue({ info: { name: 'Empty' }, item: [] }, 'empty.json');
    await expect(runLoaded(run, baseVars, runFlags, collectingIo().io)).rejects.toThrow(/không có request nào/);
  });
});

describe('cli/run — cổng script cho file import', () => {
  it('mặc định bỏ script của request import nhưng vẫn gửi request', async () => {
    const run = loadJsonValue(fixture(), 'col.json');
    const { run: stripped, blocked } = stripUntrustedScripts(run);
    expect(blocked.map((r) => r.name).sort()).toEqual(['A', 'B']);
    const a = Object.values(stripped.requests).find((r) => r.name === 'A')!;
    expect(a.preRequest).toBe('');

    const { io, err } = collectingIo();
    const res = await runLoaded(run, baseVars, { ...runFlags, allowScripts: false }, io);
    expect(res.items).toHaveLength(3);
    expect(calls[2].envVars.userId).toBeUndefined();
    expect(res.items[1].testsTotal).toBe(0);
    expect(err()).toMatch(/--allow-scripts/);
  });

  it('script kế thừa từ collection cũng bị cắt khi chưa được duyệt', () => {
    const run = loadJsonValue(
      { info: { name: 'Inherited' }, event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: ["pm.environment.set('t', '1');"] } }], item: [{ name: 'A', request: { method: 'GET', url: 'http://x/a' } }] },
      'inh.json',
    );
    const { run: stripped, blocked } = stripUntrustedScripts(run);
    expect(blocked.map((r) => r.name)).toEqual(['A']);
    expect(stripped.collections[0].preRequest).toBe('');
  });

  it('request origin local thì script chạy không cần cờ', async () => {
    const run = loadJsonValue(fixture(), 'col.json');
    for (const r of Object.values(run.requests)) r.origin = 'local';
    const { io } = collectingIo();
    const res = await runLoaded(run, baseVars, { ...runFlags, allowScripts: false }, io);
    expect(calls[2].envVars.userId).toBe('42');
    expect(res.items[1].testsTotal).toBe(1);
  });
});

describe('cli/run — main() với file thật', () => {
  it('--allow-scripts: in tiến trình, biến script đặt, exit 0', async () => {
    writeFileSync(TMP, JSON.stringify(fixture()), 'utf8');
    const { io, out, err } = collectingIo();
    const code = await main(['run', TMP, '--var', 'baseUrl=http://api.test', '--allow-scripts'], io);
    expect(code).toBe(0);
    expect(out()).toContain('ReqX CLI • 1 collection • 3 request');
    expect(out()).toMatch(/\[1\/3] PASS GET \{\{baseUrl\}\}\/a 200 12ms -/);
    expect(out()).toMatch(/\[2\/3] PASS POST \{\{baseUrl\}\}\/b 200 12ms 1\/1/);
    expect(out()).toContain('Biến script đặt: pm.environment.set("userId", "42")');
    expect(err()).not.toMatch(/Biến chưa đặt/);
    rmSync(TMP, { force: true });
  });

  it('không --allow-scripts: cảnh báo bỏ script + biến thiếu thành ra chưa đặt', async () => {
    writeFileSync(TMP, JSON.stringify(fixture()), 'utf8');
    const { io, err } = collectingIo();
    const code = await main(['run', TMP, '--var', 'baseUrl=http://api.test'], io);
    expect(code).toBe(0);
    expect(err()).toMatch(/request mang script từ file import/);
    expect(err()).toMatch(/Biến chưa đặt .* userId/);
    rmSync(TMP, { force: true });
  });

  it('biến chưa đặt lấy từ process.env (đường đưa token vào CI)', async () => {
    writeFileSync(TMP, JSON.stringify({
      info: { name: 'Env' },
      item: [{ name: 'A', request: { method: 'GET', url: 'http://x/a', header: [{ key: 'Authorization', value: 'Bearer {{reqxCliTestToken}}' }] } }],
    }), 'utf8');
    process.env.reqxCliTestToken = 'abc123';
    const { io, out } = collectingIo();
    const code = await main(['run', TMP], io);
    expect(code).toBe(0);
    expect(out()).toContain('Nạp 1 biến từ môi trường hệ thống: reqxCliTestToken');
    expect(calls[0].envVars.reqxCliTestToken).toBe('abc123');
    delete process.env.reqxCliTestToken;
    rmSync(TMP, { force: true });
  });

  it('file không tồn tại / JSON hỏng → exit 2 kèm thông báo', async () => {
    const missing = collectingIo();
    expect(await main(['run', join(tmpdir(), 'reqx-khong-ton-tai.json')], missing.io)).toBe(2);
    expect(missing.err()).toMatch(/Không đọc được file/);

    writeFileSync(TMP, '{not json', 'utf8');
    const broken = collectingIo();
    expect(await main(['run', TMP], broken.io)).toBe(2);
    expect(broken.err()).toMatch(/không phải JSON hợp lệ/);
    rmSync(TMP, { force: true });
  });

  it('cờ không tồn tại → exit 2; --help → 0', async () => {
    const bad = collectingIo();
    expect(await main(['run', 'a.json', '--parallel', '4'], bad.io)).toBe(2);
    expect(bad.err()).toMatch(/Lựa chọn không biết/);

    const help = collectingIo();
    expect(await main(['run', '--help'], help.io)).toBe(0);
    expect(help.out()).toMatch(/reqx run <file\.json>/);
  });
});
