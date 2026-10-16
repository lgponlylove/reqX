import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Io } from './run';

/**
 * `reqx ci init` — sinh file pipeline mẫu.
 * File mẫu KHÔNG chứa secret: mọi chỗ credential để trống + chú thích trỏ tới
 * nguồn bí mật của từng hệ thống (GitHub Secrets / GitLab CI Variables / Jenkins Credentials).
 */

export const CI_PROVIDERS = ['github', 'gitlab', 'jenkins'] as const;
export type CiProvider = (typeof CI_PROVIDERS)[number];

export interface CiFlags {
  provider: CiProvider;
  outDir: string;
  force: boolean;
  /** Đường dẫn collection/env ghi sẵn trong lệnh chạy ở pipeline. */
  file?: string;
  envFile?: string;
  help: boolean;
}

export interface CiErrors {
  errors: string[];
}

export const CI_USAGE = `reqx ci init [--provider github|gitlab|jenkins] [--out <dir>] [--file <collection.json>] [--env <env.json>] [--force]

  --provider  Mặc định github. github → .github/workflows/reqx.yml, gitlab → .gitlab-ci.yml, jenkins → Jenkinsfile
  --out       Thư mục ghi file pipeline. Mặc định thư mục hiện tại
  --file      Đường dẫn collection ghi vào lệnh chạy (để trống thì để placeholder)
  --env       File biến nạp kèm khi chạy
  --force     Ghi đè nếu file đã tồn tại (mặc định: không đụng file cũ)

Secret không bao giờ ghi vào file này — xem chú thích trong template.`;

/** `reqx run` gọi bằng bundle Node, không cần Tauri/WebView trong CI. */
function runCommand(flags: Pick<CiFlags, 'file' | 'envFile'>): string {
  const parts = ['node dist-cli/reqx.mjs run', flags.file ?? '<duong-dan/collection.json>'];
  if (flags.envFile) parts.push(`--env ${flags.envFile}`);
  else parts.push('--env <duong-dan/env.json>');
  parts.push('--reporter junit,csv', '--out reports', '--timeout 30000');
  return parts.join(' ');
}

export function ciFileName(provider: CiProvider): string {
  return provider === 'github' ? '.github/workflows/reqx.yml' : provider === 'gitlab' ? '.gitlab-ci.yml' : 'Jenkinsfile';
}

const SECRET_NOTE = `Biến bí mật: file biến để TRỐNG giá trị, CLI tự nạp tên trùng biến môi trường
# của hệ thống (seedFromProcessEnv). Đừng bao giờ commit token vào file nào.`;

function githubTemplate(flags: Pick<CiFlags, 'file' | 'envFile'>): string {
  return `# Sinh bởi "reqx ci init --provider github". Sửa tên job/branch cho đúng repo của bạn.
# ${SECRET_NOTE}
name: ReqX API tests

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

jobs:
  reqx:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build:cli

      # Điền TÊN secret (Settings → Secrets and variables → Actions), không điền giá trị.
      # Mỗi dòng dưới phải trùng tên biến {{...}} trong collection.
      - name: Chạy collection
        env:
          TOKEN: \${{ secrets.TOKEN }}
          # ANOTHER_SECRET: \${{ secrets.ANOTHER_SECRET }}
        run: |
          ${runCommand(flags)}

      - name: Đăng báo cáo JUnit
        if: always()
        uses: dorny/test-reporter@v1
        with:
          name: ReqX JUnit
          path: reports/*.xml
          reporter: java-junit

      - name: Lưu báo cáo
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: reqx-report
          path: reports/
`;
}

function gitlabTemplate(flags: Pick<CiFlags, 'file' | 'envFile'>): string {
  return `# Sinh bởi "reqx ci init --provider gitlab".
# ${SECRET_NOTE}
# Khai báo biến trong Settings → CI/CD → Variables (tick "Masked" với token).
stages:
  - test

reqx-api-tests:
  stage: test
  image: node:20
  before_script:
    - npm ci
    - npm run build:cli
  script:
    - ${runCommand(flags)}
  artifacts:
    when: always
    reports:
      junit: reports/*.xml
    paths:
      - reports/
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'
`;
}

function jenkinsTemplate(flags: Pick<CiFlags, 'file' | 'envFile'>): string {
  return `// Sinh bởi "reqx ci init --provider jenkins".
// ${SECRET_NOTE}
// Token khai báo ở Manage Jenkins → Credentials (kind: Secret text) rồi trỏ tên vào dòng credentials().
pipeline {
  agent { docker { image 'node:20' } }

  environment {
    TOKEN = credentials('reqx-token')
  }

  stages {
    stage('Build CLI') {
      steps {
        sh 'npm ci'
        sh 'npm run build:cli'
      }
    }
    stage('Chạy collection') {
      steps {
        sh '${runCommand(flags)}'
      }
    }
  }

  post {
    always {
      junit 'reports/*.xml'
      archiveArtifacts artifacts: 'reports/**', allowEmptyArchive: true
    }
  }
}
`;
}

/** Nội dung template cho từng provider (hàm thuần — test không cần đụng đĩa). */
export function ciTemplate(provider: CiProvider, flags: Pick<CiFlags, 'file' | 'envFile'>): string {
  if (provider === 'gitlab') return gitlabTemplate(flags);
  if (provider === 'jenkins') return jenkinsTemplate(flags);
  return githubTemplate(flags);
}

export function parseCiArgs(argv: string[]): CiFlags & CiErrors {
  const flags: CiFlags = { provider: 'github', outDir: '.', force: false, help: false };
  const errors: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const inline = a.startsWith('--') && eq > 2 ? a.slice(0, eq) : null;
    const name = inline ?? a;
    const take = (): string | undefined => {
      if (inline !== null) {
        const v = a.slice(eq + 1);
        if (v === '') errors.push(`Thiếu giá trị cho ${name}`);
        return v;
      }
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('-')) {
        errors.push(`Thiếu giá trị cho ${a}`);
        return undefined;
      }
      i++;
      return v;
    };
    switch (name) {
      case '--provider': {
        const v = take();
        if (v && !(CI_PROVIDERS as readonly string[]).includes(v)) {
          errors.push(`--provider không nhận "${v}" — chọn: ${CI_PROVIDERS.join(' | ')}`);
        } else if (v) flags.provider = v as CiProvider;
        break;
      }
      case '--out': {
        const v = take();
        if (v) flags.outDir = v;
        break;
      }
      case '--file': {
        const v = take();
        if (v) flags.file = v;
        break;
      }
      case '--env': {
        const v = take();
        if (v) flags.envFile = v;
        break;
      }
      case '--force':
        flags.force = true;
        break;
      case '-h':
      case '--help':
        flags.help = true;
        break;
      default:
        errors.push(`Lựa chọn không biết: "${a}"`);
    }
  }
  return { ...flags, errors };
}

/** Điểm vào `reqx ci init`: 0 khi ghi xong, 2 khi CĐTL sai hoặc chưa --force mà file đã có. */
export function runCiInit(argv: string[], io: Io): number {
  const { errors, ...flags } = parseCiArgs(argv);
  if (flags.help) {
    io.log(CI_USAGE);
    return errors.length > 0 ? 2 : 0;
  }
  if (errors.length > 0) {
    for (const e of errors) io.warn(`✗ ${e}`);
    io.warn('\n' + CI_USAGE);
    return 2;
  }
  const rel = ciFileName(flags.provider);
  const dir = resolve(flags.outDir);
  const file = join(dir, rel);
  if (existsSync(file) && !flags.force) {
    io.warn(`✗ Đã có "${file}" — dùng --force nếu bạn chắc muốn ghi đè.`);
    return 2;
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, ciTemplate(flags.provider, flags), 'utf8');
  } catch (e) {
    io.warn(`✗ Không ghi được "${file}": ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  io.log(`✓ Đã tạo ${flags.provider}: ${file}`);
  io.log('  Việc còn lại: điền đường dẫn collection/env + đặt TÊN secret trong hệ thống CI.');
  io.log('  Secret để trống trong file biến, CLI nạp từ biến môi trường khi chạy.');
  return 0;
}
