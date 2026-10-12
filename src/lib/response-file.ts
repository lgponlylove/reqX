import type { ApiResponse } from '../types/api';

/** Content-Type nào thì coi là text (hiển thị + copy được). */
export function isTextContentType(ct: string): boolean {
  const c = ct.toLowerCase().split(';')[0].trim();
  if (c.startsWith('text/')) return true;
  if (c === 'application/json' || c === 'application/xml' || c === 'application/javascript') return true;
  if (c === 'application/x-www-form-urlencoded' || c === 'application/graphql') return true;
  if (c.endsWith('+json') || c.endsWith('+xml') || c.endsWith('+text')) return true;
  if (c === 'application/octet-stream' || c === '') return false;
  return false;
}

export function contentTypeOf(headers: Record<string, string>): string {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'content-type') return v;
  }
  return '';
}

const NUL = String.fromCharCode(0);

/** ArrayBuffer -> { body, bodyKind }: text thì decode UTF-8, nhị phân thì base64. */
export function classifyBody(buf: ArrayBuffer, contentType: string): { body: string; bodyKind: 'text' | 'binary' } {
  const bytes = new Uint8Array(buf);
  if (isTextContentType(contentType)) {
    return { body: new TextDecoder('utf-8').decode(bytes), bodyKind: 'text' };
  }
  // Không có content-type rõ ràng: thử UTF-8, thất bại hoặc có byte 0 → binary
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.indexOf(NUL) !== -1) throw new Error('binary');
    return { body: text, bodyKind: 'text' };
  } catch {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return { body: btoa(bin), bodyKind: 'binary' };
  }
}

const MIME_EXT: Record<string, string> = {
  'application/json': 'json',
  'application/xml': 'xml',
  'text/html': 'html',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/gzip': 'gz',
  'application/octet-stream': 'bin',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
};

export function extForContentType(ct: string): string {
  const c = ct.toLowerCase().split(';')[0].trim();
  if (MIME_EXT[c]) return MIME_EXT[c];
  if (c.endsWith('+json')) return 'json';
  if (c.endsWith('+xml')) return 'xml';
  if (c.startsWith('text/')) return 'txt';
  return 'bin';
}

/** Đoán tên file: Content-Disposition > đuôi URL > response.<ext>. */
export function guessFileName(resp: ApiResponse, requestUrl?: string): string {
  for (const [k, v] of Object.entries(resp.headers)) {
    if (k.toLowerCase() === 'content-disposition') {
      const mStar = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(v);
      if (mStar) {
        try { return decodeURIComponent(mStar[1].trim().replace(/^"|"$/g, '')); } catch { /* bỏ qua */ }
      }
      const m = /filename\s*=\s*"?([^";]+)"?/i.exec(v);
      if (m) return m[1].trim();
    }
  }
  if (requestUrl) {
    try {
      const seg = new URL(requestUrl).pathname.split('/').filter(Boolean).pop();
      if (seg) {
        const name = decodeURIComponent(seg);
        if (/\.[\w]{1,5}$/.test(name)) return name;
      }
    } catch { /* bỏ qua */ }
  }
  return `response.${extForContentType(contentTypeOf(resp.headers))}`;
}

/** Data URL để preview (img/pdf/video/audio) hoặc tải về. */
export function responseDataUrl(resp: ApiResponse): string {
  const ct = contentTypeOf(resp.headers) || 'application/octet-stream';
  if (resp.bodyKind === 'binary') return `data:${ct};base64,${resp.body}`;
  return `data:${ct};charset=utf-8,${encodeURIComponent(resp.body)}`;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Tải response ra file (giữ nguyên byte gốc với binary). */
export function downloadResponse(resp: ApiResponse, requestUrl?: string): void {
  const ct = contentTypeOf(resp.headers) || 'application/octet-stream';
  const blob = resp.bodyKind === 'binary'
    ? new Blob([base64ToBytes(resp.body)], { type: ct })
    : new Blob([resp.body], { type: ct });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = guessFileName(resp, requestUrl);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Mở thư mục Downloads trong Explorer.
 * Chỉ chạy trong app Tauri (.exe) — trên web trình duyệt tự quản lý, trả về false.
 */
export async function openDownloadsFolder(inTauri: boolean): Promise<boolean> {
  if (!inTauri) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_downloads');
  return true;
}

function inTauriApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Lưu file export ngay cạnh file .exe (chỉ trong app Tauri).
 * Thành công → { path }; thất bại / đang chạy web → null (caller tự fallback tải về Downloads).
 */
export async function saveExportBesideApp(filename: string, text: string): Promise<{ path: string } | null> {
  if (!inTauriApp()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string>('save_export_file', { filename, content: text });
    return { path };
  } catch {
    return null;
  }
}

export async function saveWorkspaceFile(filename: string, text: string): Promise<{ path: string } | null> {
  if (!inTauriApp()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string>('save_workspace_file', { filename, content: text });
    return { path };
  } catch {
    return null;
  }
}

export async function readWorkspaceFiles(): Promise<string[]> {
  if (!inTauriApp()) return [];
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string[]>('read_workspace_files');
  } catch {
    return [];
  }
}

/** Mở Explorer tới thư mục chứa file + bôi đen file (chỉ trong app Tauri). */
export async function revealExportedFile(path: string): Promise<void> {
  if (!inTauriApp()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('reveal_in_explorer', { path });
  } catch {
    /* mở không được thì thôi — file vẫn nằm cạnh app */
  }
}
