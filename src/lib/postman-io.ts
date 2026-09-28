import type { ApiRequest, Collection, Folder } from '../types/api';
import { uid } from './variables';

/** Import tối thiểu Postman Collection v2.1 → Collection nội bộ. */
export function importPostmanCollection(json: unknown): {
  collection: Collection;
  requests: ApiRequest[];
} {
  const data = json as {
    info?: { name?: string };
    item?: Array<{
      name?: string;
      item?: Array<{
        name?: string;
        request?: {
          method?: string;
          url?: string | { raw?: string; query?: Array<{ key: string; value: string }> };
          header?: Array<{ key: string; value: string }>;
          body?: { mode?: string; raw?: string; urlencoded?: Array<{ key: string; value?: string }> };
        };
      }>;
    }>;
  };

  const collection: Collection = {
    id: uid('col'),
    name: data?.info?.name || 'Imported Collection',
    folders: [],
    rootRequestIds: [],
  };
  const requests: ApiRequest[] = [];

  for (const folderItem of data?.item ?? []) {
    // Folder có item con
    if (folderItem.item) {
      const folder: Folder = { id: uid('fld'), name: folderItem.name || 'Folder', requestIds: [] };
      for (const r of folderItem.item) {
        const req = toApiRequest(r.name || 'Request', r.request);
        req.collectionId = collection.id;
        requests.push(req);
        folder.requestIds.push(req.id);
      }
      collection.folders.push(folder);
    } else {
      // Request nằm ở root (trường hợp hiếm)
      const req = toApiRequest(
        folderItem.name || 'Request',
        (folderItem as unknown as { request?: object }).request,
      );
      req.collectionId = collection.id;
      requests.push(req);
      collection.rootRequestIds.push(req.id);
    }
  }
  return { collection, requests };
}

function toApiRequest(name: string, r: unknown): ApiRequest {
  const raw = r as {
    method?: string;
    url?: string | { raw?: string };
    header?: Array<{ key: string; value: string }>;
    body?: { mode?: string; raw?: string; urlencoded?: Array<{ key: string; value?: string }> };
  };
  const url = typeof raw?.url === 'string' ? raw.url : (raw?.url?.raw ?? '');
  // urlencoded Postman → body dòng key=value nội bộ; raw → json
  let bodyType: ApiRequest['bodyType'] = 'none';
  let body = '';
  if (raw?.body?.mode === 'urlencoded' && Array.isArray(raw.body.urlencoded)) {
    bodyType = 'urlencoded';
    body = raw.body.urlencoded
      .filter((e) => e && typeof e.key === 'string' && e.key !== '')
      .map((e) => `${e.key}=${e.value ?? ''}`)
      .join('\n');
  } else if (raw?.body?.mode === 'raw') {
    bodyType = 'json';
    body = raw.body.raw ?? '';
  }
  return {
    id: uid('req'),
    name,
    method: ((raw?.method || 'GET').toUpperCase() as ApiRequest['method']) || 'GET',
    url,
    params: [],
    headers: (raw?.header ?? []).map((h) => ({ id: uid('kv'), key: h.key, value: h.value, enabled: true })),
    bodyType,
    body,
    auth: { type: 'none' },
    preRequest: '',
    tests: '',
    origin: 'imported',
    updatedAt: Date.now(),
  };
}

export function exportCollection(collection: Collection, requests: ApiRequest[]): string {
  return JSON.stringify(collectionToPostman(collection, new Map(requests.map((r) => [r.id, r]))), null, 2);
}

/** 1 collection → object Postman v2.1 (dùng chung cho export 1 cái và export tất cả). */
export function collectionToPostman(collection: Collection, byId: Map<string, ApiRequest>) {
  const folders = Array.isArray(collection.folders) ? collection.folders : [];
  const rootIds = Array.isArray(collection.rootRequestIds) ? collection.rootRequestIds : [];
  return {
    info: { name: collection.name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [
      ...folders.map((f) => ({
        name: f.name,
        item: (Array.isArray(f.requestIds) ? f.requestIds : []).map((id) => fromApiRequest(byId.get(id))).filter(Boolean),
      })),
      ...rootIds.map((id) => fromApiRequest(byId.get(id))).filter(Boolean),
    ],
  };
}

/** Collection sinh ra từ import flow (tên kết thúc " (flow)") — chỉ là vỏ chứa request cho flow chạy, không phải collection thật. */
export function isFlowContainer(c: Collection): boolean {
  return (c.name ?? '').trim().toLowerCase().endsWith('(flow)');
}

/** Xuất TẤT CẢ collections → 1 file JSON mảng Postman v2.1 (import lại được, Postman đọc từng phần tử). */
export function exportAllCollections(collections: Collection[], requests: ApiRequest[]): string {
  const byId = new Map(requests.map((r) => [r.id, r]));
  return JSON.stringify(collections.map((c) => collectionToPostman(c, byId)), null, 2);
}

function fromApiRequest(r?: ApiRequest) {
  if (!r) return null;
  // Dữ liệu cũ (persist bản đầu) có thể thiếu field → guard để export không chết im
  const headers = Array.isArray(r.headers) ? r.headers : [];
  return {
    name: r.name ?? 'Request',
    request: {
      method: r.method ?? 'GET',
      url: r.url ?? '',
      header: headers.filter((h) => h && h.enabled).map((h) => ({ key: h.key ?? '', value: h.value ?? '' })),
      body: r.bodyType === 'none' || !r.bodyType ? undefined : { mode: 'raw', raw: r.body ?? '' },
    },
  };
}
