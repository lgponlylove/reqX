import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ApiRequest, Collection } from '../types/api';
import { importPostmanCollection } from '../lib/postman-io';
import { parseBackup } from '../lib/backup';

export const USAGE = `ReqX CLI — chạy Collection API từ dòng lệnh

  reqx run <file.json> [lựa chọn]

  file.json  : Postman Collection v2.0/v2.1 (1 object hoặc mảng) hoặc file backup ReqX

Lựa chọn:
  --env <file>          Nạp file biến môi trường, lặp lại được, file sau đè file trước
  --global <file>       Nạp biến toàn cục (từ file backup ReqX hoặc map JSON)
  --var K=V             Đặt/ghi đè 1 biến (lặp lại được)
  --base-url <url>      Base cho URL tương đối (vd http://127.0.0.1:3000)
  --collection <tên>    Chỉ chạy collection có tên này (lặp lại được)
  --allow-scripts       Cho chạy script của collection import (mặc định: bỏ script)
  --timeout <ms>        Timeout mỗi request (mặc định 30000)
  --delay <ms>          Nghỉ giữa hai request (mặc định 0)
  --bail                Dừng ngay khi có request/test thất bại
  -h, --help            Xem hướng dẫn

Mã thoát: 0 = tất cả pass, 1 = có request/test fail, 2 = lỗi hệ thống (file/CĐTL).

BIẾN BÍ MẬT: giá trị lấy từ process.env khi file biến để trống — xuất pipeline bằng
  TOKEN=... reqx run col.json, không lưu token vào file nào cả.`;

const VAR_REF = /\{\{\s*([\w.-]+)\s*\}\}/g;

export interface CliFlags {
  file?: string;
  envFiles: string[];
  globalFile?: string;
  vars: Record<string, string>;
  baseUrl?: string;
  allowScripts: boolean;
  onlyCollections: string[];
  timeoutMs: number;
  delayMs: number;
  bail: boolean;
  help: boolean;
  version: boolean;
}

export function defaultFlags(): CliFlags {
  return {
    envFiles: [],
    vars: {},
    allowScripts: false,
    onlyCollections: [],
    timeoutMs: 30_000,
    delayMs: 0,
    bail: false,
    help: false,
    version: false,
  };
}

function readValue(argv: string[], i: number, flag: string, errors: string[]): { value?: string; next: number } {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('-')) {
    errors.push(`Thiếu giá trị cho ${flag}`);
    return { next: i + 1 };
  }
  return { value: v, next: i + 2 };
}

/** Parse argv (đã bỏ "node" và script path). Trả về errors thay vì exit để test được. */
export function parseArgs(argv: string[]): { flags: CliFlags; errors: string[] } {
  const flags = defaultFlags();
  const errors: string[] = [];
  const positionals: string[] = [];

  let i = 0;
  if (argv[0] === 'run') i = 1;
  for (; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const inline = a.startsWith('--') && eq > 2 ? a.slice(0, eq) : null;
    const name = inline ?? a;
    switch (name) {
      case '--env':
      case '--global':
      case '--base-url':
      case '--collection':
      case '--var':
      case '--timeout':
      case '--delay': {
        let value: string | undefined;
        if (inline !== null) {
          value = a.slice(eq + 1);
          if (value === '') errors.push(`Thiếu giá trị cho ${name}`);
        } else {
          const r = readValue(argv, i, a, errors);
          value = r.value;
          i = r.next - 1;
        }
        if (value === undefined) break;
        if (name === '--env') flags.envFiles.push(value);
        else if (name === '--global') flags.globalFile = value;
        else if (name === '--base-url') flags.baseUrl = value;
        else if (name === '--collection') flags.onlyCollections.push(value);
        else if (name === '--var') {
          const sep = value.indexOf('=');
          if (sep <= 0) errors.push(`--var cần dạng K=V (được: "${value}")`);
          else flags.vars[value.slice(0, sep)] = value.slice(sep + 1);
        } else {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 0) errors.push(`${name} phải là số ms (được: "${value}")`);
          else if (name === '--timeout') flags.timeoutMs = n;
          else flags.delayMs = n;
        }
        break;
      }
      case '--allow-scripts':
      case '--bail':
        flags[name === '--allow-scripts' ? 'allowScripts' : 'bail'] = true;
        break;
      case '-h':
      case '--help':
        flags.help = true;
        break;
      case '--version':
      case '-v':
        flags.version = true;
        break;
      default:
        if (a.startsWith('-')) errors.push(`Lựa chọn không biết: "${a}"`);
        else positionals.push(a);
    }
  }

  if (positionals.length > 1) errors.push(`Chỉ nhận 1 file (thừa: ${positionals.slice(1).join(', ')})`);
  if (positionals.length > 0) flags.file = positionals[0];
  if (!flags.file && !flags.help && !flags.version) errors.push('Thiếu file collection. Dùng: reqx run <file.json> --help');
  return { flags, errors };
}

export interface LoadedRun {
  collections: Collection[];
  requests: Record<string, ApiRequest>;
  warnings: string[];
}

function addRun(target: LoadedRun, collection: Collection, reqs: ApiRequest[]): void {
  target.collections.push(collection);
  for (const r of reqs) target.requests[r.id] = r;
}

/** Đọc file collection (Postman 1 object / mảng / backup ReqX) — ném Error kèm nguyên nhân. */
export function loadRunFile(path: string): LoadedRun {
  const abs = resolve(path);
  let text: string;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    throw new Error(`Không đọc được file "${abs}"`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`File "${abs}" không phải JSON hợp lệ: ${e instanceof Error ? e.message : String(e)}`);
  }
  return loadJsonValue(json, abs);
}

/** Phân tách nội dung đã parse — tách ra để test không cần đụng đĩa. */
export function loadJsonValue(json: unknown, label = 'dữ liệu'): LoadedRun {
  const out: LoadedRun = { collections: [], requests: {}, warnings: [] };

  const pushPostman = (raw: unknown) => {
    const { collection, requests } = importPostmanCollection(raw);
    if (collection.rootRequestIds.length === 0 && collection.folders.length === 0) {
      out.warnings.push(`collection "${collection.name}" không có request nào`);
    }
    addRun(out, collection, requests);
  };

  const pushBackup = (raw: unknown) => {
    const parsed = parseBackup(raw);
    if ('error' in parsed) throw new Error(`File backup ReqX hỏng: ${parsed.error}`);
    if (parsed.items.length === 0) throw new Error(`File backup ReqX "${label}" không có collection nào`);
    for (const item of parsed.items) addRun(out, item.collection, item.reqs);
    out.warnings.push(...parsed.warnings);
    if (parsed.flows.length > 0) out.warnings.push(`${parsed.flows.length} flow trong file backup — CLI chưa chạy Flow, bỏ qua`);
  };

  if (Array.isArray(json)) {
    for (const entry of json) {
      if (isBackup(entry)) pushBackup(entry);
      else if (isCollectionLike(entry)) pushPostman(entry);
      else out.warnings.push('bỏ qua 1 phần tử trong mảng (không phải collection Postman)');
    }
  } else if (isBackup(json)) pushBackup(json);
  else if (isCollectionLike(json)) pushPostman(json);
  else throw new Error(`"${label}" không phải collection Postman v2.x cũng không phải file backup ReqX`);

  if (out.collections.length === 0) throw new Error(`"${label}" không chứa collection nào có thể đọc`);
  return out;
}

function isBackup(v: unknown): boolean {
  return !!v && typeof v === 'object' && (v as { kind?: string }).kind === 'reqx-backup';
}

function isCollectionLike(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const o = v as { item?: unknown; info?: unknown };
  return Array.isArray(o.item);
}

/** File biến: Postman env (`values[]`), ReqX env (`variables{}`), hoặc map JSON trần. */
export function readVarFile(path: string): Record<string, string> {
  const abs = resolve(path);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new Error(`Không đọc/parse được file biến "${abs}": ${e instanceof Error ? e.message : String(e)}`);
  }
  return varFileToJson(json, abs);
}

export function varFileToJson(json: unknown, label = 'file biến'): Record<string, string> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error(`"${label}" phải là object (Postman env, ReqX env, hoặc map key/value)`);
  }
  const o = json as { values?: unknown; variables?: unknown };
  const out: Record<string, string> = {};
  if (Array.isArray(o.values)) {
    for (const raw of o.values) {
      const e = raw as { key?: string; value?: string; enabled?: boolean; disabled?: boolean };
      if (!e || typeof e.key !== 'string' || e.key.trim() === '') continue;
      if (e.enabled === false || e.disabled === true) continue;
      out[e.key] = typeof e.value === 'string' ? e.value : '';
    }
    return out;
  }
  if (o.variables && typeof o.variables === 'object') {
    for (const [k, v] of Object.entries(o.variables as Record<string, unknown>)) out[k] = v == null ? '' : String(v);
    return out;
  }
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (v == null || typeof v === 'object') continue;
    out[k] = String(v);
  }
  return out;
}

/** Gom biến theo thứ tự ưu tiên: global file < env file (sau đè trước) < --var. */
export function buildVars(flags: { envFiles: string[]; globalFile?: string; vars: Record<string, string> }): {
  envVars: Record<string, string>;
  globals: Record<string, string>;
} {
  const globals: Record<string, string> = {};
  if (flags.globalFile) Object.assign(globals, readVarFile(flags.globalFile));
  const envVars: Record<string, string> = {};
  for (const f of flags.envFiles) Object.assign(envVars, readVarFile(f));
  Object.assign(envVars, flags.vars);
  return { envVars, globals };
}

/** Tên mọi biến `{{...}}` được nhắc tới trong collection (url/body/header/auth/script). */
export function referencedVarNames(run: LoadedRun): string[] {
  const names = new Set<string>();
  const scan = (txt?: string) => {
    if (!txt) return;
    for (const m of txt.matchAll(VAR_REF)) names.add(m[1]);
  };
  for (const r of Object.values(run.requests)) {
    scan(r.url);
    scan(r.body);
    scan(r.preRequest);
    scan(r.tests);
    for (const kv of r.params ?? []) { scan(kv.key); scan(kv.value); }
    for (const kv of r.headers ?? []) { scan(kv.key); scan(kv.value); }
    scan(r.auth?.token);
    scan(r.auth?.username);
    scan(r.auth?.password);
    scan(r.auth?.apiKey);
    scan(r.auth?.apiKeyName);
  }
  for (const c of run.collections) {
    scan(c.preRequest);
    scan(c.tests);
    for (const f of c.folders ?? []) { scan(f.preRequest); scan(f.tests); }
  }
  return [...names];
}

/** Tên biến do script tự đặt (`pm.environment.set('x', …)` / `pm.globals.set`).
 * Chạy script thì request sau đọc được, nên không tính là "biến chưa đặt". */
export function scriptDefinedVarNames(run: LoadedRun): Set<string> {
  const names = new Set<string>();
  const scan = (txt?: string) => {
    if (!txt) return;
    for (const m of txt.matchAll(/pm\.(?:environment|globals?)\.set\(\s*['"]([\w.-]+)['"]/g)) names.add(m[1]);
  };
  for (const r of Object.values(run.requests)) { scan(r.preRequest); scan(r.tests); }
  for (const c of run.collections) {
    scan(c.preRequest);
    scan(c.tests);
    for (const f of c.folders ?? []) { scan(f.preRequest); scan(f.tests); }
  }
  return names;
}

/**
 * Biến chưa có trong file mà trùng tên một biến môi trường của hệ thống thì nạp từ
 * process.env — cách duy nhất để đưa token vào CI mà không ghi xuống file.
 * Trả về danh sách tên đã nạp để in ra (giá trị không bao giờ in nếu trông như secret).
 */
export function seedFromProcessEnv(
  names: string[],
  envVars: Record<string, string>,
  globals: Record<string, string>,
  procEnv: NodeJS.ProcessEnv = process.env,
): string[] {
  const seeded: string[] = [];
  for (const name of names) {
    if (name in envVars || name in globals) continue;
    const value = procEnv[name];
    if (value === undefined) continue;
    envVars[name] = value;
    seeded.push(name);
  }
  return seeded;
}

/** Lọc collection theo tên (không phân biệt hoa thường, khớp toàn bộ hoặc chứa). */
export function filterCollections(run: LoadedRun, wanted: string[]): LoadedRun {
  if (wanted.length === 0) return run;
  const keys = wanted.map((w) => w.trim().toLowerCase()).filter(Boolean);
  const collections = run.collections.filter((c) => {
    const name = (c.name ?? '').trim().toLowerCase();
    return keys.some((k) => name === k || name.includes(k));
  });
  if (collections.length === 0) {
    throw new Error(`Không collection nào khớp ${wanted.join(', ')} — có: ${run.collections.map((c) => c.name).join(' | ')}`);
  }
  const ids = new Set(collections.map((c) => c.id));
  const requests: Record<string, ApiRequest> = {};
  for (const [id, r] of Object.entries(run.requests)) {
    if (!r.collectionId || ids.has(r.collectionId)) requests[id] = r;
  }
  return { collections, requests, warnings: run.warnings };
}
