import type { AuthConfig, HttpMethod } from '../types/api';
import { resolveVariables } from './variables';

/** Pure JS MD5 implementation for Digest Auth (RFC 2617) */
export function md5(string: string): string {
  function rotateLeft(lValue: number, iShiftBits: number) {
    return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
  }
  function addUnsigned(lX: number, lY: number) {
    const lX4 = lX & 0x40000000;
    const lY4 = lY & 0x40000000;
    const lX8 = lX & 0x80000000;
    const lY8 = lY & 0x80000000;
    const lResult = (lX & 0x3fffffff) + (lY & 0x3fffffff);
    if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
    if (lX4 | lY4) {
      if (lResult & 0x40000000) return lResult ^ 0xc0000000 ^ lX8 ^ lY8;
      else return lResult ^ 0x40000000 ^ lX8 ^ lY8;
    } else return lResult ^ lX8 ^ lY8;
  }
  function F(x: number, y: number, z: number) { return (x & y) | (~x & z); }
  function G(x: number, y: number, z: number) { return (x & z) | (y & ~z); }
  function H(x: number, y: number, z: number) { return x ^ y ^ z; }
  function I(x: number, y: number, z: number) { return y ^ (x | ~z); }

  function FF(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function GG(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function HH(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function II(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function convertToWordArray(string: string) {
    let lWordCount;
    const lMessageLength = string.length;
    const lNumberOfWordsTempOne = lMessageLength + 8;
    const lNumberOfWordsTempTwo = (lNumberOfWordsTempOne - (lNumberOfWordsTempOne % 64)) / 64;
    const lNumberOfWords = (lNumberOfWordsTempTwo + 1) * 16;
    const lWordArray = Array(lNumberOfWords - 1);
    let lBytePosition = 0;
    let lByteCount = 0;
    while (lByteCount < lMessageLength) {
      lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition));
      lByteCount++;
    }
    lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
    lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
    lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
    return lWordArray;
  }

  function wordToHex(lValue: number) {
    let WordToHexValue = '', WordToHexValueTemp = '', lByte, lCount;
    for (lCount = 0; lCount <= 3; lCount++) {
      lByte = (lValue >>> (lCount * 8)) & 255;
      WordToHexValueTemp = '0' + lByte.toString(16);
      WordToHexValue = WordToHexValue + WordToHexValueTemp.substr(WordToHexValueTemp.length - 2, 2);
    }
    return WordToHexValue;
  }

  const x = convertToWordArray(string);
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  for (let k = 0; k < x.length; k += 16) {
    const AA = a, BB = b, CC = c, DD = d;
    a = FF(a, b, c, d, x[k + 0] || 0, 7, 0xd76aa478);
    d = FF(d, a, b, c, x[k + 1] || 0, 12, 0xe8c7b756);
    c = FF(c, d, a, b, x[k + 2] || 0, 17, 0x242070db);
    b = FF(b, c, d, a, x[k + 3] || 0, 22, 0xc1bdceee);
    a = FF(a, b, c, d, x[k + 4] || 0, 7, 0xf57c0faf);
    d = FF(d, a, b, c, x[k + 5] || 0, 12, 0x4787c62a);
    c = FF(c, d, a, b, x[k + 6] || 0, 17, 0xa8304613);
    b = FF(b, c, d, a, x[k + 7] || 0, 22, 0xfd469501);
    a = FF(a, b, c, d, x[k + 8] || 0, 7, 0x698098d8);
    d = FF(d, a, b, c, x[k + 9] || 0, 12, 0x8b44f7af);
    c = FF(c, d, a, b, x[k + 10] || 0, 17, 0xffff5bb1);
    b = FF(b, c, d, a, x[k + 11] || 0, 22, 0x895cd7be);
    a = FF(a, b, c, d, x[k + 12] || 0, 7, 0x6b901122);
    d = FF(d, a, b, c, x[k + 13] || 0, 12, 0xfd987193);
    c = FF(c, d, a, b, x[k + 14] || 0, 17, 0xa679438e);
    b = FF(b, c, d, a, x[k + 15] || 0, 22, 0x49b40821);

    a = GG(a, b, c, d, x[k + 1] || 0, 5, 0xf61e2562);
    d = GG(d, a, b, c, x[k + 6] || 0, 9, 0xc040b340);
    c = GG(c, d, a, b, x[k + 11] || 0, 14, 0x265e5a51);
    b = GG(b, c, d, a, x[k + 0] || 0, 20, 0xe9b6c7aa);
    a = GG(a, b, c, d, x[k + 5] || 0, 5, 0xd62f105d);
    d = GG(d, a, b, c, x[k + 10] || 0, 9, 0x02441453);
    c = GG(c, d, a, b, x[k + 15] || 0, 14, 0xd8a1e681);
    b = GG(b, c, d, a, x[k + 4] || 0, 20, 0xe7d3fbc8);
    a = GG(a, b, c, d, x[k + 9] || 0, 5, 0x21e1cde6);
    d = GG(d, a, b, c, x[k + 14] || 0, 9, 0xc33707d6);
    c = GG(c, d, a, b, x[k + 3] || 0, 14, 0xf4d50d87);
    b = GG(b, c, d, a, x[k + 8] || 0, 20, 0x455a14ed);
    a = GG(a, b, c, d, x[k + 13] || 0, 5, 0xa9e3e905);
    d = GG(d, a, b, c, x[k + 2] || 0, 9, 0xfcefa3f8);
    c = GG(c, d, a, b, x[k + 7] || 0, 14, 0x676f02d9);
    b = GG(b, c, d, a, x[k + 12] || 0, 20, 0x8d2a4c8a);

    a = HH(a, b, c, d, x[k + 5] || 0, 4, 0xfffa3942);
    d = HH(d, a, b, c, x[k + 8] || 0, 11, 0x8771f681);
    c = HH(c, d, a, b, x[k + 11] || 0, 16, 0x6d9d6122);
    b = HH(b, c, d, a, x[k + 14] || 0, 23, 0xfde5380c);
    a = HH(a, b, c, d, x[k + 1] || 0, 4, 0xa4beea44);
    d = HH(d, a, b, c, x[k + 4] || 0, 11, 0x4bdecfa9);
    c = HH(c, d, a, b, x[k + 7] || 0, 16, 0xf6bb4b60);
    b = HH(b, c, d, a, x[k + 10] || 0, 23, 0xbebfbc70);
    a = HH(a, b, c, d, x[k + 13] || 0, 4, 0x289b7ec6);
    d = HH(d, a, b, c, x[k + 0] || 0, 11, 0xeaa127fa);
    c = HH(c, d, a, b, x[k + 3] || 0, 16, 0xd4ef3085);
    b = HH(b, c, d, a, x[k + 6] || 0, 23, 0x04881d05);
    a = HH(a, b, c, d, x[k + 9] || 0, 4, 0xd9d4d039);
    d = HH(d, a, b, c, x[k + 12] || 0, 11, 0xe6db99e5);
    c = HH(c, d, a, b, x[k + 15] || 0, 16, 0x1fa27cf8);
    b = HH(b, c, d, a, x[k + 2] || 0, 23, 0xc4ac5665);

    a = II(a, b, c, d, x[k + 0] || 0, 6, 0xf4292244);
    d = II(d, a, b, c, x[k + 7] || 0, 10, 0x432aff97);
    c = II(c, d, a, b, x[k + 14] || 0, 15, 0xab9423a7);
    b = II(b, c, d, a, x[k + 5] || 0, 21, 0xfc93a039);
    a = II(a, b, c, d, x[k + 12] || 0, 6, 0x655b59c3);
    d = II(d, a, b, c, x[k + 3] || 0, 10, 0x8f0ccc92);
    c = II(c, d, a, b, x[k + 10] || 0, 15, 0xffeff47d);
    b = II(b, c, d, a, x[k + 1] || 0, 21, 0x85845dd1);
    a = II(a, b, c, d, x[k + 8] || 0, 6, 0x6fa87e4f);
    d = II(d, a, b, c, x[k + 15] || 0, 10, 0xfe2ce6e0);
    c = II(c, d, a, b, x[k + 6] || 0, 15, 0xa3014314);
    b = II(b, c, d, a, x[k + 13] || 0, 21, 0x4e0811a1);
    a = II(a, b, c, d, x[k + 4] || 0, 6, 0xf7537e82);
    d = II(d, a, b, c, x[k + 11] || 0, 10, 0xbd3af235);
    c = II(c, d, a, b, x[k + 2] || 0, 15, 0x2ad7d2bb);
    b = II(b, c, d, a, x[k + 9] || 0, 21, 0xeb86d391);
    a = addUnsigned(a, AA);
    b = addUnsigned(b, BB);
    c = addUnsigned(c, CC);
    d = addUnsigned(d, DD);
  }
  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

/** SHA-256 via Web Crypto API,接受 chuỗi hoặc byte (payload nhị phân của SigV4). */
export async function sha256Hex(message: string | Uint8Array): Promise<string> {
  const msgUint8 = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** HMAC-SHA256 via Web Crypto API */
export async function hmacSha256(key: Uint8Array | string, data: string): Promise<Uint8Array> {
  const keyBuffer = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(signature);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Tách các tham số từ header `WWW-Authenticate: Digest ...` của server.
 * Dùng cho lượt thử lại sau khi nhận 401 (nonce/realm thật từ server, không phải user gõ tay).
 */
export function parseDigestChallenge(header: string): {
  realm?: string;
  nonce?: string;
  opaque?: string;
  qop?: 'auth' | 'auth-int' | 'none';
  algorithm?: 'MD5' | 'SHA-256';
} {
  const out: ReturnType<typeof parseDigestChallenge> = {};
  const re = /(\w+)=(?:"([^"]*)"|([^,\s]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header))) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? '';
    if (name === 'realm') out.realm = value;
    else if (name === 'nonce') out.nonce = value;
    else if (name === 'opaque') out.opaque = value;
    else if (name === 'qop') {
      // Server có thể liệt kê "auth, auth-int" — ưu tiên auth
      const list = value.split(',').map((s) => s.trim().toLowerCase());
      out.qop = list.includes('auth') ? 'auth' : (list[0] as 'auth-int' | 'none' | 'auth');
    } else if (name === 'algorithm') {
      const a = value.toUpperCase();
      out.algorithm = a === 'SHA-256' || a === 'SHA-256-SESSION' ? 'SHA-256' : 'MD5';
    }
  }
  return out;
}

/** Tính hash theo algorithm Digest được chọn (RFC 7616 hỗ trợ MD5 và SHA-256). */
async function digestHash(algorithm: 'MD5' | 'SHA-256', text: string): Promise<string> {
  return algorithm === 'SHA-256' ? sha256Hex(text) : md5(text);
}

/**
 * Applies extended authentication schemes: OAuth2, Digest, AWS SigV4, NTLM.
 * `payloadHash` (tuỳ chọn) là hash sẵn của body nhị phân — dùng khi body không phải text.
 */
export async function applyExtendedAuth(
  headers: Record<string, string>,
  url: URL,
  method: HttpMethod,
  auth: AuthConfig,
  bodyText: string,
  envVars: Record<string, string>,
  globalVars: Record<string, string>,
  payloadHash?: string,
): Promise<void> {
  if (auth.type === 'oauth2' && auth.oauth2) {
    const o = auth.oauth2;
    const rawToken = o.token || o.accessToken || '';
    const token = resolveVariables(rawToken, envVars, globalVars).resolved;
    const prefix = resolveVariables(o.headerPrefix || 'Bearer', envVars, globalVars).resolved.trim();
    if (token) {
      if (o.addTokenTo === 'query') {
        url.searchParams.set('access_token', token);
      } else {
        headers['Authorization'] = `${prefix} ${token}`.trim();
      }
    }
  }

  else if (auth.type === 'digest' && auth.digest) {
    const d = auth.digest;
    const username = resolveVariables(d.username || '', envVars, globalVars).resolved;
    const password = resolveVariables(d.password || '', envVars, globalVars).resolved;
    const realm = resolveVariables(d.realm || 'realm', envVars, globalVars).resolved;
    const nonce = resolveVariables(d.nonce || `${Date.now()}`, envVars, globalVars).resolved;
    const qop = d.qop || 'auth';
    const algorithm = d.algorithm || 'MD5';
    const uri = url.pathname + (url.search || '');
    const cnonce = Math.random().toString(36).slice(2, 10);
    const nc = '00000001';

    // RFC 2617 / RFC 7616: HA1 & HA2 theo algorithm server yêu cầu, không hardcode MD5
    const ha1 = await digestHash(algorithm, `${username}:${realm}:${password}`);
    const ha2 =
      qop === 'auth-int'
        ? await digestHash(algorithm, `${method}:${uri}:${await sha256Hex(bodyText || '')}`)
        : await digestHash(algorithm, `${method}:${uri}`);
    const response =
      qop === 'none'
        ? await digestHash(algorithm, `${ha1}:${nonce}:${ha2}`)
        : await digestHash(algorithm, `${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);

    headers['Authorization'] =
      `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", algorithm=${algorithm}` +
      (qop === 'none'
        ? `, response="${response}"`
        : `, qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`) +
      (d.opaque ? `, opaque="${d.opaque}"` : '');
  }

  else if (auth.type === 'awsv4' && auth.awsv4) {
    const a = auth.awsv4;
    const rawAccess = a.accessKeyId || a.accessKey || '';
    const rawSecret = a.secretAccessKey || a.secretKey || '';
    const accessKeyId = resolveVariables(rawAccess, envVars, globalVars).resolved;
    const secretAccessKey = resolveVariables(rawSecret, envVars, globalVars).resolved;
    const region = resolveVariables(a.region || 'us-east-1', envVars, globalVars).resolved;
    const service = resolveVariables(a.service || 'execute-api', envVars, globalVars).resolved;
    const sessionToken = resolveVariables(a.sessionToken || '', envVars, globalVars).resolved;

    if (accessKeyId && secretAccessKey) {
      const now = new Date();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const dateStamp = amzDate.slice(0, 8);

      headers['x-amz-date'] = amzDate;
      headers['host'] = url.host;
      if (sessionToken) {
        headers['x-amz-security-token'] = sessionToken;
      }

      // 1. Canonical request (payloadHash đến từ http-client khi body là nhị phân)
      const canonicalPayloadHash = payloadHash ?? (await sha256Hex(bodyText || ''));
      // Tra header theo tên thường, vì headers có thể đang là 'Content-Type' nhưng SigV4 cần 'content-type'
      const headerByLower = new Map<string, string>();
      for (const [k, v] of Object.entries(headers)) headerByLower.set(k.toLowerCase(), v);
      const sortedHeaderKeys = [...headerByLower.keys()].sort();
      const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${(headerByLower.get(k) ?? '').trim()}\n`).join('');
      const signedHeaders = sortedHeaderKeys.join(';');

      const canonicalRequest = [
        method,
        url.pathname || '/',
        url.search.slice(1) || '',
        canonicalHeaders,
        signedHeaders,
        canonicalPayloadHash,
      ].join('\n');

      // 2. String to sign
      const algorithm = 'AWS4-HMAC-SHA256';
      const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
      const stringToSign = [
        algorithm,
        amzDate,
        credentialScope,
        await sha256Hex(canonicalRequest),
      ].join('\n');

      // 3. Signature
      const kDate = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
      const kRegion = await hmacSha256(kDate, region);
      const kService = await hmacSha256(kRegion, service);
      const kSigning = await hmacSha256(kService, 'aws4_request');
      const signatureBytes = await hmacSha256(kSigning, stringToSign);
      const signature = bytesToHex(signatureBytes);

      headers['Authorization'] = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    }
  }

  else if (auth.type === 'ntlm' && auth.ntlm) {
    const n = auth.ntlm;
    const username = resolveVariables(n.username || '', envVars, globalVars).resolved;
    const domain = resolveVariables(n.domain || '', envVars, globalVars).resolved;
    const workstation = resolveVariables(n.workstation || 'WORKSTATION', envVars, globalVars).resolved;

    // CHỈ gửi được Phase 1 (Type-1 negotiate). NTLM là handshake 3 bước có khoá phiên
    // do OS sinh, webview/reqwest không tự hoàn tất -> server Windows vẫn trả 401.
    // Type 1 NTLM message indicator (negotiate flags)
    const raw = `NTLMSSP\0\x01\0\0\0\x07\x82\x08\xa2\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0`;
    const b64 = btoa(raw);
    headers['Authorization'] = `NTLM ${b64}`;
    if (domain) headers['X-NTLM-Domain'] = domain;
    if (username) headers['X-NTLM-User'] = username;
    if (workstation) headers['X-NTLM-Workstation'] = workstation;
  }
}
