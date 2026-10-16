import { dump as yamlDump, load as yamlLoad } from 'js-yaml';
import JSZip from 'jszip';
import type { ApiRequest, Collection, Folder, KeyValue, AuthConfig, BodyType } from '../types/api';
import { uid } from './variables';

export interface GitVirtualFile {
  path: string;
  content: string;
}

export interface YamlRequestSchema {
  name: string;
  method: string;
  url: string;
  headers?: Array<{ key: string; value: string; enabled?: boolean }>;
  params?: Array<{ key: string; value: string; enabled?: boolean }>;
  body?: {
    type: BodyType;
    content?: string;
    rawType?: string;
    graphql?: { query: string; variables: string };
  };
  auth?: AuthConfig;
  preRequest?: string;
  tests?: string;
  description?: string;
}

export interface YamlCollectionSchema {
  name: string;
  version: string;
  description?: string;
  auth?: AuthConfig;
}

/** Chuyển ApiRequest thành chuỗi YAML chuẩn Git-friendly */
export function requestToYaml(req: ApiRequest): string {
  const schema: YamlRequestSchema = {
    name: req.name,
    method: req.method,
    url: req.url,
  };

  if (req.headers && req.headers.length > 0) {
    schema.headers = req.headers.map((h) => ({
      key: h.key,
      value: h.value,
      enabled: h.enabled !== false,
    }));
  }

  if (req.params && req.params.length > 0) {
    schema.params = req.params.map((p) => ({
      key: p.key,
      value: p.value,
      enabled: p.enabled !== false,
    }));
  }

  if (req.bodyType && req.bodyType !== 'none') {
    schema.body = {
      type: req.bodyType,
      content: req.body || '',
      ...(req.rawType ? { rawType: req.rawType } : {}),
      ...(req.graphql ? { graphql: req.graphql } : {}),
    };
  }

  if (req.auth && req.auth.type !== 'none') {
    schema.auth = req.auth;
  }

  if (req.preRequest && req.preRequest.trim()) {
    schema.preRequest = req.preRequest;
  }

  if (req.tests && req.tests.trim()) {
    schema.tests = req.tests;
  }

  if (req.description && req.description.trim()) {
    schema.description = req.description;
  }

  return yamlDump(schema, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
  });
}

/** Chuyển chuỗi YAML thành ApiRequest */
export function yamlToRequest(yamlStr: string, collectionId: string, idPrefix = 'req'): ApiRequest {
  const parsed = yamlLoad(yamlStr) as YamlRequestSchema;

  const headers: KeyValue[] = (parsed.headers || []).map((h) => ({
    id: uid('kv'),
    key: h.key || '',
    value: h.value || '',
    enabled: h.enabled !== false,
  }));

  const params: KeyValue[] = (parsed.params || []).map((p) => ({
    id: uid('kv'),
    key: p.key || '',
    value: p.value || '',
    enabled: p.enabled !== false,
  }));

  return {
    id: uid(idPrefix),
    name: parsed.name || 'Untitled Request',
    method: (parsed.method || 'GET').toUpperCase() as ApiRequest['method'],
    url: parsed.url || '',
    params,
    headers,
    bodyType: parsed.body?.type || 'none',
    rawType: (parsed.body?.rawType as ApiRequest['rawType']) || undefined,
    graphql: parsed.body?.graphql,
    body: parsed.body?.content || '',
    auth: parsed.auth || { type: 'none' },
    preRequest: parsed.preRequest || '',
    tests: parsed.tests || '',
    collectionId,
    updatedAt: Date.now(),
    description: parsed.description || '',
  };
}

/** Chuẩn hóa tên file / folder an toàn cho hệ điều hành và Git */
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'unnamed';
}

/**
 * Xuất một Collection thành cấu trúc cây thư mục gồm các file plain-text YAML
 */
export function exportCollectionToGitFiles(
  collection: Collection,
  requests: ApiRequest[]
): GitVirtualFile[] {
  const files: GitVirtualFile[] = [];
  const reqById = new Map(requests.map((r) => [r.id, r]));

  // 1. File metadata gốc của collection
  const colMeta: YamlCollectionSchema = {
    name: collection.name,
    version: '1.0',
    description: collection.description || '',
    auth: collection.auth,
  };
  files.push({
    path: 'collection.yaml',
    content: yamlDump(colMeta, { indent: 2, lineWidth: -1 }),
  });

  // 2. Các request nằm ở thư mục gốc (root)
  for (const reqId of collection.rootRequestIds || []) {
    const req = reqById.get(reqId);
    if (!req) continue;
    const safeName = sanitizeFileName(req.name);
    files.push({
      path: `${safeName}.reqx.yaml`,
      content: requestToYaml(req),
    });
  }

  // 3. Đệ quy các folder con
  const folderById = new Map((collection.folders || []).map((f) => [f.id, f]));

  function processFolder(folder: Folder, currentPath: string) {
    const folderPath = `${currentPath}/${sanitizeFileName(folder.name)}`;

    for (const reqId of folder.requestIds || []) {
      const req = reqById.get(reqId);
      if (!req) continue;
      const safeName = sanitizeFileName(req.name);
      files.push({
        path: `${folderPath}/${safeName}.reqx.yaml`,
        content: requestToYaml(req),
      });
    }

    for (const childId of folder.folderIds || []) {
      const child = folderById.get(childId);
      if (child) {
        processFolder(child, folderPath);
      }
    }
  }

  for (const folder of collection.folders || []) {
    // Chỉ xử lý các top-level folder (không phải con của folder khác)
    const isChild = (collection.folders || []).some((f) => f.folderIds?.includes(folder.id));
    if (!isChild) {
      processFolder(folder, '');
    }
  }

  return files;
}

/**
 * Tái tạo Collection và Requests từ danh sách các file YAML trong thư mục
 */
export function importCollectionFromGitFiles(
  files: GitVirtualFile[],
  defaultCollectionName = 'Imported Git Collection'
): { collection: Collection; requests: ApiRequest[] } {
  const colId = uid('col');
  const requests: ApiRequest[] = [];
  const folders: Folder[] = [];
  const rootRequestIds: string[] = [];

  let collectionName = defaultCollectionName;
  let collectionDesc = '';
  let collectionAuth: AuthConfig = { type: 'none' };

  // Tìm file collection.yaml
  const metaFile = files.find((f) => f.path.toLowerCase().endsWith('collection.yaml'));
  if (metaFile) {
    try {
      const meta = yamlLoad(metaFile.content) as YamlCollectionSchema;
      if (meta?.name) collectionName = meta.name;
      if (meta?.description) collectionDesc = meta.description;
      if (meta?.auth) collectionAuth = meta.auth;
    } catch {}
  }

  // Quản lý folder theo đường dẫn tương đối (vd: "auth" -> Folder, "users/admin" -> Folder)
  const folderPathMap = new Map<string, Folder>();

  function getOrCreateFolder(dirPath: string): Folder {
    const normalized = dirPath.replace(/^\/+|\/+$/g, '');
    if (folderPathMap.has(normalized)) {
      return folderPathMap.get(normalized)!;
    }

    const segments = normalized.split('/');
    const folderName = segments[segments.length - 1];
    const newFolder: Folder = {
      id: uid('fld'),
      name: folderName,
      requestIds: [],
      folderIds: [],
    };
    folders.push(newFolder);
    folderPathMap.set(normalized, newFolder);

    // Nếu có parent folder
    if (segments.length > 1) {
      const parentPath = segments.slice(0, -1).join('/');
      const parentFolder = getOrCreateFolder(parentPath);
      if (!parentFolder.folderIds) parentFolder.folderIds = [];
      if (!parentFolder.folderIds.includes(newFolder.id)) {
        parentFolder.folderIds.push(newFolder.id);
      }
    }

    return newFolder;
  }

  // Xử lý từng file request
  for (const file of files) {
    const p = file.path.replace(/^\/+/, '');
    if (p.toLowerCase().endsWith('collection.yaml') || p.startsWith('.')) continue;

    if (p.endsWith('.yaml') || p.endsWith('.yml')) {
      try {
        const req = yamlToRequest(file.content, colId);
        requests.push(req);

        const lastSlash = p.lastIndexOf('/');
        if (lastSlash === -1) {
          // File nằm ngay ở thư mục gốc
          rootRequestIds.push(req.id);
        } else {
          // File nằm trong thư mục con
          const dirPath = p.slice(0, lastSlash);
          const folder = getOrCreateFolder(dirPath);
          folder.requestIds.push(req.id);
        }
      } catch {}
    }
  }

  const collection: Collection = {
    id: colId,
    name: collectionName,
    description: collectionDesc,
    auth: collectionAuth,
    folders,
    rootRequestIds,
  };

  return { collection, requests };
}

/**
 * Đóng gói toàn bộ Collection thành file ZIP chứa cấu trúc thư mục Git-friendly
 */
export async function exportCollectionToZip(
  collection: Collection,
  requests: ApiRequest[]
): Promise<Blob> {
  const zip = new JSZip();
  const files = exportCollectionToGitFiles(collection, requests);

  for (const file of files) {
    const cleanPath = file.path.replace(/^\/+/, '');
    zip.file(cleanPath, file.content);
  }

  return await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}

/**
 * Đọc file ZIP và giải nén thành Collection + Requests
 */
export async function importCollectionFromZip(
  zipData: Blob | ArrayBuffer,
  fallbackName?: string
): Promise<{ collection: Collection; requests: ApiRequest[] }> {
  const zip = await JSZip.loadAsync(zipData);
  const files: GitVirtualFile[] = [];

  const promises: Promise<void>[] = [];
  zip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir) {
      promises.push(
        zipEntry.async('string').then((content) => {
          files.push({
            path: relativePath,
            content,
          });
        })
      );
    }
  });

  await Promise.all(promises);
  return importCollectionFromGitFiles(files, fallbackName);
}

/**
 * Tải file ZIP Git Collection về máy người dùng
 */
export async function downloadGitCollectionZip(collection: Collection, requests: ApiRequest[]) {
  const blob = await exportCollectionToZip(collection, requests);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFileName(collection.name)}-git-collection.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
