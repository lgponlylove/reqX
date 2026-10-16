import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findLiteralSecrets, lintVars, runLint, type LintInput } from '../../cli/lint';
import { ciFileName, ciTemplate, parseCiArgs, runCiInit, CI_PROVIDERS } from '../../cli/ci';
import { loadJsonValue, parseArgs } from '../../cli/load';
import { main, type Io } from '../../cli/run';

const DIR = mkdtempSync(join(tmpdir(), 'reqx-lint-'));
afterEach(() => {
  rmSync(join(DIR, 'Jenkinsfile'), { force: true });
  rmSync(join(DIR, '.gitlab-ci.yml'), { force: true });
  rmSync(join(DIR, '.github'), { force: true, recursive: true });
});

function collectingIo() {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { log: (l) => out.push(l), warn: (l) => err.push(l) };
  return { io, out: () => out.join('\n'), err: () => err.join('\n') };
}

/** baseUrl + token đang dùng; `spare` khai báo thừa; token chưa file nào đặt. */
function input(over: Partial<LintInput> = {}): LintInput {
  return {
    referenced: ['baseUrl', 'token'],
    scriptSet: new Set<string>(),
    envFiles: [{ label: 'staging', vars: { baseUrl: 'http://api.test', spare: 'x' } }],
    cliVars: {},
    hostEnvNames: new Set<string>(),
    literals: [],
    ...over,
  };
}

const lint = (over: Partial<LintInput> = {}) => lintVars(input(over));
const codes = (over: Partial<LintInput> = {}) => lint(over).map((f) => f.code);

describe('reqx env lint — lintVars', () => {
  it('biến collection dùng nhưng không file nào đặt → error, biến thừa → warn', () => {
    expect(lint()).toEqual([
      { level: 'error', code: 'missing', message: '{{token}} không file biến nào đặt — URL/body sẽ giữ nguyên {{token}}' },
      { level: 'warn', code: 'unused', message: 'spare khai báo ở staging nhưng collection không dùng — có phải đặt nhầm tên không?' },
    ]);
  });

  it('process.env hoặc script đặt thì không còn là biến thiếu', () => {
    expect(codes({ hostEnvNames: new Set(['token']) })).toEqual(['unused']);
    expect(codes({ scriptSet: new Set(['token']) })).toEqual(['unused']);
  });

  it('--var được tính là khai báo — đủ biến thì chỉ còn nhắc biến thừa', () => {
    expect(codes({ cliVars: { token: 'T' } })).toEqual(['unused']);
    expect(codes({ envFiles: [], cliVars: { token: 'T', baseUrl: 'B' } })).toEqual([]);
  });

  it('khai báo rỗng cho biến đang dùng → warn, process.env cùng tên thì im', () => {
    const empty = { envFiles: [{ label: 'prod', vars: { baseUrl: '', token: '' } }] };
    expect(lint(empty).find((f) => f.code === 'empty')?.message).toContain('prod');
    expect(codes({ ...empty, hostEnvNames: new Set(['baseUrl', 'token']) })).toEqual([]);
  });

  it('trùng tên giữa global và env → info, ghi rõ file nào thắng', () => {
    const f = lint({
      globalFile: { label: 'global.json', vars: { baseUrl: 'http://old', token: 'g' } },
      envFiles: [{ label: 'env.json', vars: { baseUrl: 'http://new', token: 'e' } }],
    }).find((x) => x.code === 'shadow');
    expect(f?.level).toBe('info');
    expect(f?.message).toContain('global.json < env.json');
    expect(f?.message).toContain('"env.json" thắng');
  });

  it('credential ghi thẳng trong file → warn secret', () => {
    const f = lint({ literals: [{ where: 'Login · auth.token' }] }).find((x) => x.code === 'secret');
    expect(f?.level).toBe('warn');
    expect(f?.message).toContain('Login · auth.token');
  });

  it('error xếp trước warn, warn xếp trước info', () => {
    expect(lint({ globalFile: { label: 'g', vars: { baseUrl: 'http://g' } } }).map((x) => x.level)).toEqual([
      'error',
      'warn',
      'info',
    ]);
  });
});

describe('reqx env lint — quét file collection', () => {
  const postman = {
    info: { name: 'Lint QA', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [
      { name: 'OK', request: { method: 'GET', url: '{{baseUrl}}/ok' } },
      {
        name: 'Login',
        request: {
          method: 'POST',
          url: '{{baseUrl}}/login',
          auth: { type: 'bearer', bearer: [{ key: 'token', value: 'ABC123SECRET' }] },
          header: [
            { key: 'Authorization', value: 'Basic dXNlcjpwYXNz' },
            { key: 'X-Trace', value: 'debug-1' },
            { key: 'X-Api-Key', value: '{{apiKey}}' },
          ],
        },
      },
    ],
  };

  it('nhận credential trong auth + header, bỏ qua giá trị đã là {{var}}', () => {
    const list = findLiteralSecrets(loadJsonValue(postman, 'lint.json')).map((l) => l.where);
    expect(list).toContain('Login · auth.token');
    expect(list).toContain('Login · Authorization');
    expect(list.some((w) => w.includes('X-Trace'))).toBe(false);
    expect(list.some((w) => w.includes('X-Api-Key'))).toBe(false);
  });

  it('giá trị tự bản thân là Bearer/JWT cũng bị gọi là secret', () => {
    const run = loadJsonValue(
      {
        info: { name: 'JWT', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [
          {
            name: 'R',
            request: { method: 'GET', url: 'http://x/y', header: [{ key: 'X', value: 'Bearer abcdefghijkl' }] },
          },
        ],
      },
      'jwt.json',
    );
    expect(findLiteralSecrets(run).map((l) => l.where)).toEqual(['R · X']);
  });

  it('runLint: exit 1 khi thiếu biến, 0 khi đủ, 2 khi không đọc được file', () => {
    const col = join(DIR, 'col.json');
    writeFileSync(col, JSON.stringify(postman), 'utf8');
    const env = join(DIR, 'lint.env.json');
    writeFileSync(env, JSON.stringify({ baseUrl: 'http://api.test' }), 'utf8');

    const bad = collectingIo();
    expect(runLint(parseArgs([col, '--env', env]).flags, bad.io)).toBe(1);
    expect(bad.out()).toContain('Login · auth.token');
    expect(bad.out()).not.toContain('ABC123SECRET');
    expect(bad.out()).toMatch(/2 biến dùng • 1 thiếu/);

    const good = collectingIo();
    expect(runLint(parseArgs([col, '--env', env, '--var', 'apiKey=K', '--var', 'token=T']).flags, good.io)).toBe(0);

    const missingFile = collectingIo();
    expect(runLint(parseArgs([join(DIR, 'khong-ton-tai.json')]).flags, missingFile.io)).toBe(2);
    expect(missingFile.err()).toMatch(/Không đọc được file/);
  });

  it('main() route "env lint", từ chối lệnh phụ lạ, --help in hướng dẫn', async () => {
    const col = join(DIR, 'route.json');
    writeFileSync(
      col,
      JSON.stringify({
        info: { name: 'R', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [{ name: 'A', request: { method: 'GET', url: 'http://x' } }],
      }),
      'utf8',
    );
    const ok = collectingIo();
    expect(await main(['env', 'lint', col], ok.io)).toBe(0);
    expect(ok.out()).toContain('Không phát hiện vấn đề');

    const unknown = collectingIo();
    expect(await main(['env', 'show', col], unknown.io)).toBe(2);
    expect(unknown.err()).toMatch(/Lệnh phụ không biết/);

    const help = collectingIo();
    expect(await main(['env', 'lint', '--help'], help.io)).toBe(0);
    expect(help.out()).toMatch(/reqx env lint <file\.json>/);
  });
});

describe('reqx ci init', () => {
  it('mỗi provider một đường dẫn file riêng', () => {
    expect(ciFileName('github')).toBe('.github/workflows/reqx.yml');
    expect(ciFileName('gitlab')).toBe('.gitlab-ci.yml');
    expect(ciFileName('jenkins')).toBe('Jenkinsfile');
  });

  it('template github giữ nguyên cú pháp ${{ secrets.X }} và không nhét giá trị secret', () => {
    const yml = ciTemplate('github', { file: 'collections/api.json', envFile: 'envs/staging.json' });
    expect(yml).toContain('TOKEN: ${{ secrets.TOKEN }}');
    expect(yml).toContain('node dist-cli/reqx.mjs run collections/api.json --env envs/staging.json');
    expect(yml).toContain('--reporter junit,csv');
    expect(yml).toContain('npm run build:cli');
    expect(yml).not.toMatch(/secrets\.[A-Z_]+\s*[:=]\s*['"]?[A-Za-z0-9]{16,}/);
  });

  it('template gitlab/Jenkins đều để trống chỗ secret và trỏ nguồn bí mật', () => {
    const gl = ciTemplate('gitlab', {});
    expect(gl).toContain('junit: reports/*.xml');
    expect(gl).toContain('--env <duong-dan/env.json>');
    const jk = ciTemplate('jenkins', {});
    expect(jk).toContain("TOKEN = credentials('reqx-token')");
    expect(jk).toContain("junit 'reports/*.xml'");
  });

  it('parse --provider/--out/--force, từ chối provider và cờ lạ', () => {
    const f = parseCiArgs(['--provider=gitlab', '--out', 'pipeline', '--force']);
    expect({ provider: f.provider, outDir: f.outDir, force: f.force, errors: f.errors }).toEqual({
      provider: 'gitlab',
      outDir: 'pipeline',
      force: true,
      errors: [],
    });
    expect(parseCiArgs(['--provider', 'azure']).errors.join()).toMatch(/--provider không nhận "azure"/);
    expect(parseCiArgs(['--noel']).errors.join()).toMatch(/Lựa chọn không biết/);
    expect(parseCiArgs(['--out']).errors.join()).toMatch(/Thiếu giá trị cho --out/);
  });

  it('ghi file mẫu, từ chối ghi đè khi chưa --force', () => {
    for (const p of CI_PROVIDERS) {
      const file = join(DIR, ciFileName(p));
      const io = collectingIo();
      expect(runCiInit(['--provider', p, '--out', DIR, '--file', 'collections/api.json'], io.io)).toBe(0);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf8')).toContain('collections/api.json');

      const refuse = collectingIo();
      expect(runCiInit(['--provider', p, '--out', DIR], refuse.io)).toBe(2);
      expect(refuse.err()).toMatch(/dùng --force/);

      const force = collectingIo();
      expect(runCiInit(['--provider', p, '--out', DIR, '--force'], force.io)).toBe(0);
      rmSync(file, { force: true });
    }
  });

  it('main() route "ci init", --help in hướng dẫn, provider sai → exit 2', async () => {
    const io = collectingIo();
    expect(await main(['ci', 'init', '--out', DIR, '--provider', 'jenkins'], io.io)).toBe(0);
    rmSync(join(DIR, 'Jenkinsfile'), { force: true });

    const help = collectingIo();
    expect(await main(['ci', 'init', '--help'], help.io)).toBe(0);
    expect(help.out()).toMatch(/--provider github\|gitlab\|jenkins/);

    const bad = collectingIo();
    expect(await main(['ci', 'init', '--provider', 'circle'], bad.io)).toBe(2);
    expect(await main(['ci'], bad.io)).toBe(2);
  });
});
