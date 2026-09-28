import type { ApiRequest, AuthConfig, BodyType, HttpMethod, KeyValue } from '../types/api';
import { uid } from './variables';

export interface ParsedCurl {
  request: ApiRequest;
  warnings: string[];
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** Tách chuỗi lệnh, tôn trọng '...' "..." và backslash-escape. */
function tokenize(cmd: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let q: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) {
      if (ch === q) q = null;
      else if (q === '"' && ch === '\\' && i + 1 < cmd.length) cur += cmd[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      q = ch;
    } else if (ch === '\\' && i + 1 < cmd.length) {
      cur += cmd[++i];
    } else if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

/** Gộp dòng nối bằng backslash; lệnh không có backslash mà xuống dòng vẫn gộp chung. */
function splitCommands(text: string): string[] {
  const joined = text.replace(/\\\r?\n/g, ' ');
  const cmds: string[] = [];
  let cur = '';
  for (const raw of joined.split('\n')) {
    let line = raw.trim().replace(/^[$>#]\s*/, '');
    if (!line) continue;
    // Tách && hoặc ; ngoài quotes (đơn giản: split rồi gộp lại nếu lẻ quotes)
    if (/^(curl(\s|$|"))/.test(line)) {
      if (cur.trim()) cmds.push(cur.trim());
      cur = line;
    } else if (/^(curl(\s|$|"))/.test(cur)) {
      cur += ' ' + line;
    }
    // Dòng không thuộc lệnh curl nào → bỏ (ví dụ output mẫu)
  }
  if (cur.trim()) cmds.push(cur.trim());
  return cmds.filter((c) => /^(curl(\s|$|"))/.test(c));
}

const WITH_ARG = new Set([
  '-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary',
  '--data-ascii', '--data-urlencode', '-u', '--user', '--url', '-b', '--cookie',
  '-A', '--user-agent', '-F', '--form', '--json', '-o', '--output', '-m', '--max-time',
  '--connect-timeout', '-w', '--write-out', '--cert', '-E', '--key', '--proxy', '-x',
  '--resolve', '--connect-to',
]);

function parseOne(cmd: string): ParsedCurl {
  const warnings: string[] = [];
  const tokens = tokenize(cmd);
  // tokens[0] === 'curl'
  let method: string | null = null;
  let url = '';
  const headers: [string, string][] = [];
  const dataParts: string[] = [];
  const urlencodeParts: string[] = [];
  const formParts: string[] = [];
  const cookies: string[] = [];
  let basicUser = '';
  let basicPass = '';
  let forceGet = false;
  let jsonFlag: string | null = null;

  const takeArg = (i: number, flag: string): string => {
    if (i + 1 >= tokens.length) {
      warnings.push(`Thiếu giá trị sau ${flag} — bỏ qua.`);
      return '';
    }
    return tokens[i + 1];
  };

  let i = 1;
  while (i < tokens.length) {
    let t = tokens[i];
    let inlineVal: string | null = null;
    if (t.startsWith('--') && t.includes('=')) {
      const eq = t.indexOf('=');
      inlineVal = t.slice(eq + 1);
      t = t.slice(0, eq);
    }
    const arg = (flag: string) => (inlineVal !== null ? inlineVal : takeArg(i, flag));
    const consumed = inlineVal !== null ? 1 : 2;

    switch (t) {
      case '-X':
      case '--request':
        method = arg(t).toUpperCase();
        i += consumed;
        break;
      case '-H':
      case '--header': {
        const h = arg(t);
        const ci = h.indexOf(':');
        if (ci < 0) warnings.push(`Header lạ "${h}" — bỏ qua.`);
        else headers.push([h.slice(0, ci).trim(), h.slice(ci + 1).trim()]);
        i += consumed;
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
        dataParts.push(arg(t).replace(/^@/, ''));
        if (arg(t).startsWith('@')) warnings.push('Đọc body từ file (@...) chưa hỗ trợ — đã lấy tên file làm text.');
        i += consumed;
        break;
      case '--data-urlencode':
        urlencodeParts.push(arg(t));
        i += consumed;
        break;
      case '-u':
      case '--user': {
        const u = arg(t);
        const ci = u.indexOf(':');
        basicUser = ci < 0 ? u : u.slice(0, ci);
        basicPass = ci < 0 ? '' : u.slice(ci + 1);
        i += consumed;
        break;
      }
      case '-G':
      case '--get':
        forceGet = true;
        i += 1;
        break;
      case '-F':
      case '--form':
        formParts.push(arg(t));
        i += consumed;
        break;
      case '--json':
        jsonFlag = arg(t);
        i += consumed;
        break;
      case '--url':
        if (!url) url = arg(t);
        i += consumed;
        break;
      case '-b':
      case '--cookie':
        cookies.push(arg(t));
        i += consumed;
        break;
      case '-A':
      case '--user-agent':
        headers.push(['User-Agent', arg(t)]);
        i += consumed;
        break;
      case '-L':
      case '--location':
      case '--compressed':
      case '--compress':
      case '-k':
      case '--insecure':
      case '-s':
      case '--silent':
      case '-S':
      case '--show-error':
      case '-f':
      case '--fail':
      case '-i':
      case '--include':
      case '-v':
      case '--verbose':
      case '-g':
      case '--globoff':
      case '-0':
      case '--http1.0':
      case '--http1.1':
      case '--http2':
      case '--ipv4':
      case '--ipv6':
        i += 1;
        break;
      default:
        if (WITH_ARG.has(t)) {
          if (t === '-o' || t === '--output' || t === '-m' || t === '--max-time' ||
              t === '--connect-timeout' || t === '-w' || t === '--write-out') {
            i += consumed; // bỏ qua có chủ đích
          } else {
            warnings.push(`Flag ${t} chưa hỗ trợ — bỏ qua.`);
            i += consumed;
          }
        } else if (t.startsWith('-')) {
          warnings.push(`Flag ${t} chưa hỗ trợ — bỏ qua.`);
          i += 1;
        } else {
          if (!url) url = t;
          else warnings.push(`Thừa tham số "${t}" — bỏ qua.`);
          i += 1;
        }
    }
  }

  if (!url) throw new Error('Không tìm thấy URL trong lệnh curl.');
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) url = 'https://' + url;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`URL không hợp lệ: ${url}`);
  }

  // Method
  let m: HttpMethod = 'GET';
  if (method && METHODS.has(method)) m = method as HttpMethod;
  else if (method) warnings.push(`Method ${method} lạ — dùng GET.`);
  else if (formParts.length > 0 || dataParts.length > 0 || urlencodeParts.length > 0 || jsonFlag !== null) m = 'POST';
  if (forceGet) m = 'GET';

  // Auth basic
  let auth: AuthConfig = { type: 'none' };
  if (basicUser) {
    auth = { type: 'basic', username: basicUser, password: basicPass };
  }

  // Cookies → header
  if (cookies.length > 0) headers.push(['Cookie', cookies.join('; ')]);

  // Body
  let bodyType: BodyType = 'none';
  let body = '';
  const setCt = (ct: string) => {
    if (!headers.some(([k]) => k.toLowerCase() === 'content-type')) headers.push(['Content-Type', ct]);
  };

  if (formParts.length > 0) {
    bodyType = 'form-data';
    body = formParts
      .map((p) => {
        const eq = p.indexOf('=');
        if (eq < 0) return `${p}=`;
        let v = p.slice(eq + 1);
        if (v.startsWith('@')) {
          warnings.push(`Upload file (${v}) chưa hỗ trợ — giữ tên file dạng text.`);
        }
        return `${p.slice(0, eq)}=${v}`;
      })
      .join('\n');
  } else if (jsonFlag !== null) {
    bodyType = 'json';
    body = jsonFlag;
    setCt('application/json');
    if (!headers.some(([k]) => k.toLowerCase() === 'accept')) headers.push(['Accept', 'application/json']);
  } else if (dataParts.length > 0 || urlencodeParts.length > 0) {
    const encoded = urlencodeParts.map((p) => {
      const eq = p.indexOf('=');
      if (eq < 0) return p.startsWith('@') ? p.slice(1) : p;
      const name = p.slice(0, eq);
      let content = p.slice(eq + 1);
      if (content.startsWith('@')) {
        content = content.slice(1);
        warnings.push('Đọc nội dung từ file (@...) chưa hỗ trợ — dùng tên file.');
      }
      return `${name}=${encodeURIComponent(content)}`;
    });
    const all = [...dataParts, ...encoded];
    if (forceGet || m === 'GET') {
      for (const part of all) {
        const eq = part.indexOf('=');
        if (eq < 0) parsedUrl.searchParams.append(part, '');
        else parsedUrl.searchParams.append(part.slice(0, eq), decodeURIComponent(part.slice(eq + 1)));
      }
    } else {
      const ct = headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
      if (/json/i.test(ct)) bodyType = 'json';
      else if (/urlencoded/i.test(ct)) bodyType = 'urlencoded';
      else if (all.length > 1 || encoded.length > 0) {
        bodyType = 'urlencoded';
        setCt('application/x-www-form-urlencoded');
      } else {
        bodyType = 'raw';
      }
      body = all.join('&');
    }
  }

  const kvHeaders: KeyValue[] = headers.map(([key, value]) => ({ id: uid('kv'), key, value, enabled: true }));
  const label = `${parsedUrl.hostname}${parsedUrl.pathname !== '/' ? parsedUrl.pathname : ''}`;
  const request: ApiRequest = {
    id: uid('req'),
    name: `${m} ${label}`.slice(0, 80),
    method: m,
    url: parsedUrl.toString(),
    params: [],
    headers: kvHeaders,
    bodyType,
    body,
    auth,
    preRequest: '',
    tests: '',
    collectionId: '',
    updatedAt: Date.now(),
  };
  return { request, warnings };
}

/** Parse toàn bộ text dán vào → danh sách request (kèm warnings từng cái). */
export function parseCurlText(text: string): ParsedCurl[] {
  return splitCommands(text).map(parseOne);
}

export interface CurlCommandResult {
  raw: string;
  parsed?: ParsedCurl;
  error?: string;
}

/** Parse từng lệnh riêng — lệnh lỗi không chặn các lệnh khác. */
export function parseCurlCommands(text: string): CurlCommandResult[] {
  return splitCommands(text).map((raw) => {
    try {
      return { raw, parsed: parseOne(raw) };
    } catch (e) {
      return { raw, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
