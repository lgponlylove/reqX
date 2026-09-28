import type { ApiRequest } from '../types/api';
import { resolveVariables } from './variables';

/** Bọc chuỗi trong single-quote kiểu shell, escape ' thành '\'' */
function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

interface BuiltRequest {
  url: string;
  headers: [string, string][];
  /** body gửi đi (undefined = không có) */
  body?: string;
  isFormData: boolean;
  formFields: [string, string][];
}

function parseFormFields(resolved: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of resolved.split('\n')) {
    const t = line.trim();
    if (!t || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out.push([t.slice(0, i).trim(), t.slice(i + 1).trim()]);
  }
  return out;
}

/** Resolve request thành URL/headers/body cuối cùng (khớp http-client). */
function build(
  req: ApiRequest,
  envVars: Record<string, string>,
  globalVars: Record<string, string> = {},
): BuiltRequest {
  const rv = (s: string) => resolveVariables(s, envVars, globalVars).resolved;

  let url = rv(req.url);
  const q: string[] = [];
  for (const p of req.params) {
    if (!p.enabled || p.key.trim() === '') continue;
    q.push(`${encodeURIComponent(rv(p.key))}=${encodeURIComponent(rv(p.value))}`);
  }
  if (q.length > 0) url += (url.includes('?') ? '&' : '?') + q.join('&');

  const headers: [string, string][] = [];
  for (const h of req.headers) {
    if (!h.enabled || h.key.trim() === '') continue;
    headers.push([rv(h.key), rv(h.value)]);
  }

  if (req.auth.type === 'bearer' && req.auth.token) {
    headers.push(['Authorization', `Bearer ${rv(req.auth.token)}`]);
  } else if (req.auth.type === 'basic') {
    const u = rv(req.auth.username ?? '');
    const p = rv(req.auth.password ?? '');
    headers.push(['Authorization', `Basic ${btoa(`${u}:${p}`)}`]);
  } else if (req.auth.type === 'apikey' && req.auth.apiKey) {
    const val = rv(req.auth.apiKey);
    const name = req.auth.apiKeyName || 'X-API-Key';
    if (req.auth.apiKeyIn === 'query') {
      url += `${url.includes('?') ? '&' : '?'}${encodeURIComponent(name)}=${encodeURIComponent(val)}`;
    } else {
      headers.push([name, val]);
    }
  }

  const hasHeader = (n: string) => headers.some(([k]) => k.toLowerCase() === n.toLowerCase());
  const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.bodyType !== 'none';

  let body: string | undefined;
  let isFormData = false;
  let formFields: [string, string][] = [];
  if (hasBody) {
    const resolved = rv(req.body);
    if (req.bodyType === 'json') {
      if (!hasHeader('content-type')) headers.push(['Content-Type', 'application/json']);
      body = resolved || undefined;
    } else if (req.bodyType === 'urlencoded') {
      if (!hasHeader('content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
      body = resolved || undefined;
    } else if (req.bodyType === 'form-data') {
      isFormData = true;
      formFields = parseFormFields(resolved);
    } else {
      body = resolved || undefined;
    }
  }

  return { url, headers, body, isFormData, formFields };
}

/**
 * Sinh lệnh cURL từ request — resolve {{var}} bằng env + globals
 * (khớp với những gì http-client thực sự gửi).
 */
export function toCurl(
  req: ApiRequest,
  envVars: Record<string, string>,
  globalVars: Record<string, string> = {},
): string {
  const { url, headers, body, isFormData, formFields } = build(req, envVars, globalVars);

  const lines: string[] = [`curl -X ${req.method} ${sq(url)}`];
  for (const [k, v] of headers) lines.push(`-H ${sq(`${k}: ${v}`)}`);

  if (isFormData) {
    for (const [k, v] of formFields) lines.push(`--form ${sq(`${k}=${v}`)}`);
  } else if (body !== undefined) {
    lines.push(`--data-raw ${sq(body)}`);
  }

  return lines.length > 2
    ? lines[0] + ' \\\n  ' + lines.slice(1).join(' \\\n  ')
    : lines.join(' ');
}

/** Sinh code JavaScript fetch() — async/await. */
export function toFetch(
  req: ApiRequest,
  envVars: Record<string, string>,
  globalVars: Record<string, string> = {},
): string {
  const { url, headers, body, isFormData, formFields } = build(req, envVars, globalVars);
  const js = (s: string) => JSON.stringify(s);

  const out: string[] = [`const res = await fetch(${js(url)}, {`];
  out.push(`  method: ${js(req.method)},`);
  if (headers.length > 0) {
    out.push(`  headers: {`);
    for (const [k, v] of headers) out.push(`    ${js(k)}: ${js(v)},`);
    out.push(`  },`);
  }
  if (isFormData) {
    out.push(`  body: (() => {`);
    out.push(`    const fd = new FormData();`);
    for (const [k, v] of formFields) out.push(`    fd.append(${js(k)}, ${js(v)});`);
    out.push(`    return fd;`);
    out.push(`  })(),`);
  } else if (body !== undefined) {
    out.push(`  body: ${js(body)},`);
  }
  out.push(`});`);
  out.push(``);
  out.push(`console.log(res.status);`);
  out.push(`console.log(await res.text());`);
  return out.join('\n');
}

/** Sinh code Python dùng thư viện requests. */
export function toPython(
  req: ApiRequest,
  envVars: Record<string, string>,
  globalVars: Record<string, string> = {},
): string {
  const { url, headers, body, isFormData, formFields } = build(req, envVars, globalVars);
  const py = (s: string) => JSON.stringify(s);

  const out: string[] = [`import requests`, ``];
  if (headers.length > 0) {
    out.push(`headers = {`);
    for (const [k, v] of headers) out.push(`    ${py(k)}: ${py(v)},`);
    out.push(`}`);
  }
  if (isFormData) {
    out.push(`data = {`);
    for (const [k, v] of formFields) out.push(`    ${py(k)}: ${py(v)},`);
    out.push(`}`);
  } else if (body !== undefined) {
    out.push(`data = ${py(body)}`);
  }
  const args = [`${py(req.method)}, ${py(url)}`];
  if (headers.length > 0) args.push(`headers=headers`);
  if (isFormData || body !== undefined) args.push(`data=data`);
  out.push(``);
  out.push(`res = requests.request(${args.join(', ')})`);
  out.push(`print(res.status_code)`);
  out.push(`print(res.text)`);
  return out.join('\n');
}
