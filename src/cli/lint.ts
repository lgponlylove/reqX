import type { ApiRequest } from '../types/api';
import {
  loadRunFile,
  readVarFile,
  referencedVarNames,
  scriptDefinedVarNames,
  type CliFlags,
  type LoadedRun,
} from './load';
import type { Io } from './run';

/**
 * `reqx env lint` — soát biến trước khi chạy.
 * Module này chỉ so tên với giá trị đã nạp, không gọi mạng; việc đọc file gom hết
 * vào `lintFromFiles` để test được trực tiếp trên object.
 */

export type LintLevel = 'error' | 'warn' | 'info';

export interface LintFinding {
  level: LintLevel;
  code: 'missing' | 'empty' | 'unused' | 'shadow' | 'secret';
  message: string;
}

/** Một file biến đã nạp kèm nhãn để in ra (đường dẫn hoặc "--var"). */
export interface DeclaredFile {
  label: string;
  vars: Record<string, string>;
}

export interface LintInput {
  /** Tên mọi `{{...}}` collection nhắc tới. */
  referenced: string[];
  /** Biến do script tự đặt — không tính là thiếu khi có --allow-scripts. */
  scriptSet: Set<string>;
  envFiles: DeclaredFile[];
  globalFile?: DeclaredFile;
  /** Biến đặt bằng --var trên dòng lệnh. */
  cliVars: Record<string, string>;
  /** Tên biến môi trường hệ thống (process.env) — nguồn hợp lệ duy nhất của secret. */
  hostEnvNames: Set<string>;
  /** Credential ghi thẳng trong file collection (tên field, không kèm giá trị). */
  literals: { where: string }[];
}

export const LINT_USAGE = `reqx env lint <file.json> [--env f] [--global f] [--var K=V]

Soát biến của collection mà không cần gửi request nào:
  error  biến {{...}} collection dùng nhưng không file biến nào có
  warn   biến khai báo thừa không ai dùng · biến rỗng · credential ghi thẳng trong file
  info   trùng tên giữa global/env (env đè) · script tự đặt khi chạy

Mã thoát: 0 = sạch, 1 = có biến thiếu, 2 = lỗi file/CĐTL.`;

/** Giá trị field nào của auth nên bị coi là credential. */
const SECRET_FIELD = /(token|secret|password|passwd|pwd|api[-_]?key|access[-_]?key|authorization|cookie|refresh|code[-_]?verifier)/i;

function authLiteralSecrets(req: ApiRequest): string[] {
  const out: string[] = [];
  const a = req.auth;
  if (!a) return out;
  const push = (field: string, value?: string) => {
    if (value && !value.includes('{{')) out.push(`${req.name} · auth.${field}`);
  };
  push('token', a.token);
  push('password', a.password);
  push('apiKey', a.apiKey);
  push('digest.password', a.digest?.password);
  push('ntlm.password', a.ntlm?.password);
  push('awsv4.secretKey', a.awsv4?.secretKey ?? a.awsv4?.secretAccessKey);
  push('awsv4.sessionToken', a.awsv4?.sessionToken);
  push('oauth2.clientSecret', a.oauth2?.clientSecret);
  push('oauth2.password', a.oauth2?.password);
  push('oauth2.accessToken', a.oauth2?.accessToken);
  push('oauth2.refreshToken', a.oauth2?.refreshToken);
  return out;
}

/** Giá trị bản thân đã là credential: "Bearer abc…", JWT, key dài không dấu cách. */
const SECRET_VALUE = /^(Bearer\s+\S{8,}|Basic\s+\S{8,}|eyJ[\w-]+\.[\w-]+\.|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,})/;

function headerLiteralSecrets(req: ApiRequest): string[] {
  const out: string[] = [];
  for (const kv of [...(req.headers ?? []), ...(req.params ?? [])]) {
    if (kv.enabled === false) continue;
    const v = (kv.value ?? '').trim();
    if (v === '' || v.includes('{{')) continue;
    if (SECRET_FIELD.test(kv.key ?? '') || SECRET_VALUE.test(v)) out.push(`${req.name} · ${kv.key}`);
  }
  return out;
}

/** Credential nằm chết trong file collection — xuất/Xuất (Public) là lọt. Trả về tên vị trí, không lấy giá trị. */
export function findLiteralSecrets(run: LoadedRun): { where: string }[] {
  const list: string[] = [];
  for (const r of Object.values(run.requests)) list.push(...authLiteralSecrets(r), ...headerLiteralSecrets(r));
  return [...new Set(list)].map((where) => ({ where }));
}

export function lintVars(input: LintInput): LintFinding[] {
  const findings: LintFinding[] = [];
  const files = [...(input.globalFile ? [input.globalFile] : []), ...input.envFiles];

  /** name → các nơi khai báo, theo thứ tự ưu tiên thấp → cao */
  const sources = new Map<string, string[]>();
  const values = new Map<string, string>();
  for (const file of files) {
    for (const [k, v] of Object.entries(file.vars)) {
      sources.set(k, [...(sources.get(k) ?? []), file.label]);
      values.set(k, v);
    }
  }
  for (const [k, v] of Object.entries(input.cliVars)) {
    sources.set(k, [...(sources.get(k) ?? []), '--var']);
    values.set(k, v);
  }

  const referenced = new Set(input.referenced);
  const isProvided = (name: string): boolean =>
    sources.has(name) || input.hostEnvNames.has(name) || input.scriptSet.has(name);

  for (const name of input.referenced) {
    if (isProvided(name)) continue;
    findings.push({ level: 'error', code: 'missing', message: `{{${name}}} không file biến nào đặt — URL/body sẽ giữ nguyên {{${name}}}` });
  }

  for (const name of input.referenced) {
    const src = sources.get(name);
    if (!src) continue;
    const v = values.get(name) ?? '';
    if (v.trim() === '' && !input.hostEnvNames.has(name)) {
      findings.push({
        level: 'warn',
        code: 'empty',
        message: `{{${name}}} khai báo ở ${src[src.length - 1]} nhưng để trống — truyền bằng --var hoặc biến hệ thống khi chạy`,
      });
    }
  }

  for (const [name, src] of sources) {
    if (referenced.has(name) || input.scriptSet.has(name)) continue;
    findings.push({ level: 'warn', code: 'unused', message: `${name} khai báo ở ${src.join(', ')} nhưng collection không dùng — có phải đặt nhầm tên không?` });
  }

  for (const [name, src] of sources) {
    if (src.length < 2) continue;
    findings.push({
      level: 'info',
      code: 'shadow',
      message: `${name} khai báo ${src.length} lần (${src.join(' < ')}) — "${src[src.length - 1]}" thắng`,
    });
  }

  for (const lit of input.literals) {
    findings.push({
      level: 'warn',
      code: 'secret',
      message: `Credential ghi thẳng trong file: ${lit.where} — đổi thành {{ten_bien}}, giá trị lấy từ biến hệ thống khi run`,
    });
  }

  const rank: Record<LintLevel, number> = { error: 0, warn: 1, info: 2 };
  return findings.sort((a, b) => rank[a.level] - rank[b.level] || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}

/** Dựng LintInput từ flags đã parse (đọc file biến, bỏ qua cờ không liên quan tới lint). */
export function lintInputFrom(flags: CliFlags, run: LoadedRun, procEnv: NodeJS.ProcessEnv = process.env): LintInput {
  const envFiles: DeclaredFile[] = flags.envFiles.map((f) => ({ label: f, vars: readVarFile(f) }));
  const globalFile: DeclaredFile | undefined = flags.globalFile ? { label: flags.globalFile, vars: readVarFile(flags.globalFile) } : undefined;
  return {
    referenced: referencedVarNames(run),
    scriptSet: scriptDefinedVarNames(run),
    envFiles,
    globalFile,
    cliVars: flags.vars,
    hostEnvNames: new Set(Object.keys(procEnv)),
    literals: findLiteralSecrets(run),
  };
}

const MARK: Record<LintLevel, string> = { error: '✗', warn: '⚠', info: '•' };

/** Điểm vào `reqx env lint`: 1 khi có biến thiếu, 2 khi không đọc được file. */
export function runLint(flags: CliFlags, io: Io): number {
  if (!flags.file) {
    io.warn('✗ env lint cần file collection');
    io.warn('\n' + LINT_USAGE);
    return 2;
  }
  let run: LoadedRun;
  try {
    run = loadRunFile(flags.file);
  } catch (e) {
    io.warn(`✗ ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  let input: LintInput;
  try {
    input = lintInputFrom(flags, run);
  } catch (e) {
    io.warn(`✗ ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  const findings = lintVars(input);
  const errors = findings.filter((f) => f.level === 'error').length;
  io.log(`reqx env lint • ${input.referenced.length} biến dùng • ${errors} thiếu • ${findings.length - errors} góp ý`);
  if (findings.length === 0) io.log('✓ Không phát hiện vấn đề biến nào.');
  for (const f of findings) io.log(`${MARK[f.level]} ${f.message}`);
  return errors > 0 ? 1 : 0;
}
