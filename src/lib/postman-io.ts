import type { ApiRequest, AuthConfig, Collection, Folder } from '../types/api';
import { compileAssertions } from './assertions';
import { uid } from './variables';

/** Parse auth từ Postman collection-level hoặc request-level. */
function parsePostmanAuth(auth?: { type?: string; bearer?: Array<{ key: string; value: string }>; basic?: Array<{ key: string; value: string }>; apikey?: Array<{ key: string; value: string }> }): AuthConfig {
  if (!auth || !auth.type) return { type: 'none' };
  const t = auth.type.toLowerCase();
  if (t === 'bearer') {
    const token = auth.bearer?.find((x) => x.key === 'token')?.value ?? '';
    return { type: 'bearer', token };
  }
  if (t === 'basic') {
    const username = auth.basic?.find((x) => x.key === 'username')?.value ?? '';
    const password = auth.basic?.find((x) => x.key === 'password')?.value ?? '';
    return { type: 'basic', username, password };
  }
  if (t === 'apikey') {
    const key = auth.apikey?.find((x) => x.key === 'key')?.value ?? '';
    const name = auth.apikey?.find((x) => x.key === 'name')?.value ?? 'X-API-Key';
    const inVal = auth.apikey?.find((x) => x.key === 'in')?.value ?? 'header';
    return { type: 'apikey', apiKeyIn: inVal as 'header' | 'query', apiKeyName: name, apiKey: key };
  }
  if (t === 'noauth' || t === 'none') return { type: 'none' };
  // OAuth2 / digest / hawk... → fallback none
  return { type: 'none' };
}

/** Parse mảng `event` của Postman (prerequest / test) thành script của ReqX. */
function parsePmEvents(events: unknown): { preRequest: string; tests: string; teardown: string } {
  const out = { preRequest: '', tests: '', teardown: '' };
  if (!Array.isArray(events)) return out;
  for (const e of events as Array<{ listen?: string; script?: { exec?: string[] | string } }>) {
    const exec = e?.script?.exec;
    const code = Array.isArray(exec) ? exec.join('\n') : (exec ?? '');
    if (!code.trim()) continue;
    if (e.listen === 'prerequest') out.preRequest = code;
    else if (e.listen === 'test') out.tests = code;
    // ReqX tự thêm (Postman bỏ qua event lạ khi import) — giữ script dọn dẹp khi đi vòng qua file
    else if (e.listen === 'teardown') out.teardown = code;
  }
  return out;
}

/** Import tối thiểu Postman Collection v2.1/v2.0 → Collection nội bộ. */
export function importPostmanCollection(json: unknown): {
  collection: Collection;
  requests: ApiRequest[];
} {
  const data = json as {
    info?: { name?: string };
    auth?: { type?: string; bearer?: Array<{ key: string; value: string }>; basic?: Array<{ key: string; value: string }>; apikey?: Array<{ key: string; value: string }> };
    event?: Array<unknown>;
    item?: Array<unknown>;
  };

  const colScripts = parsePmEvents(data?.event);
  const collection: Collection = {
    id: uid('col'),
    name: data?.info?.name || 'Imported Collection',
    folders: [],
    rootRequestIds: [],
    preRequest: colScripts.preRequest,
    tests: colScripts.tests,
    teardown: colScripts.teardown,
  };
  const requests: ApiRequest[] = [];
  const colAuth = parsePostmanAuth(data?.auth);

  // Walk đệ quy để xử lý nested folder
  function buildTree(items: Array<unknown>): { folders: Folder[]; rootIds: string[] } {
    const folders: Folder[] = [];
    const rootIds: string[] = [];

    /** parent = null → items nằm ở gốc collection; ngược lại gán vào folder cha. */
    function recurse(rawItems: Array<unknown>, parent: Folder | null) {
      for (const rawItem of rawItems) {
        const item = rawItem as { name?: string; item?: Array<unknown>; request?: object; event?: Array<unknown> };
        if (Array.isArray(item.item)) {
          // Folder — có thể chứa cả folder con lẫn request
          const fScripts = parsePmEvents(item.event);
          const folder: Folder = {
            id: uid('fld'),
            name: item.name || 'Folder',
            requestIds: [],
            folderIds: [],
            preRequest: fScripts.preRequest,
            tests: fScripts.tests,
          };
          folders.push(folder);
          if (parent) parent.folderIds.push(folder.id);
          recurse(item.item, folder);
        } else if (item.request) {
          const req = toApiRequest(item.name || 'Request', item.request, colAuth, item.event);
          req.collectionId = collection.id;
          requests.push(req);
          if (parent) parent.requestIds.push(req.id);
          else rootIds.push(req.id);
        }
      }
    }

    recurse(items, null);
    return { folders, rootIds };
  }

  const tree = buildTree(data?.item ?? []);
  collection.folders = tree.folders;
  collection.rootRequestIds = tree.rootIds;

  return { collection, requests };
}

function toApiRequest(name: string, r: unknown, fallbackAuth: AuthConfig, events?: Array<unknown>): ApiRequest {
  const raw = r as {
    method?: string;
    url?: string | { raw?: string; query?: Array<{ key: string; value: string }> };
    header?: Array<{ key: string; value: string; disabled?: boolean }>;
    body?: { mode?: string; raw?: string; urlencoded?: Array<{ key: string; value?: string; type?: string }> };
    description?: string;
    auth?: { type?: string; bearer?: Array<{ key: string; value: string }>; basic?: Array<{ key: string; value: string }>; apikey?: Array<{ key: string; value: string }> };
  };
  const url = typeof raw?.url === 'string' ? raw.url : (raw?.url?.raw ?? '');
  // urlencoded Postman → body dòng key=value nội bộ; raw → json
  let bodyType: ApiRequest['bodyType'] = 'none';
  let body = '';
  let graphql: { query: string; variables: string } | undefined;
  if (raw?.body?.mode === 'urlencoded' && Array.isArray(raw.body.urlencoded)) {
    bodyType = 'urlencoded';
    body = raw.body.urlencoded
      .filter((e) => e && typeof e.key === 'string' && e.key !== '')
      .map((e) => `${e.key}=${e.value ?? ''}`)
      .join('\n');
  } else if (raw?.body?.mode === 'raw') {
    bodyType = 'json';
    body = raw.body.raw ?? '';
  } else if (raw?.body?.mode === 'formdata' && Array.isArray((raw.body as { formdata?: Array<{ key: string; value?: string }> }).formdata)) {
    const valid = (raw.body as { formdata: Array<{ key: string; value?: string }> }).formdata
      .filter((e) => e && typeof e.key === 'string' && e.key !== '');
    if (valid.length > 0) {
      bodyType = 'form-data';
      body = valid.map((e) => `${e.key}=${e.value ?? ''}`).join('\n');
    } else {
      bodyType = 'none';
      body = '';
    }
  } else if (raw?.body?.mode === 'file') {
    bodyType = 'binary';
    body = (raw.body as { file?: { src?: string } })?.file?.src ?? '';
  } else if (raw?.body?.mode === 'graphql') {
    bodyType = 'graphql';
    const g = (raw.body as { graphql?: { query?: string; variables?: string } })?.graphql;
    const q = g?.query ?? '';
    const v = g?.variables ?? '';
    graphql = { query: q, variables: v };
    let parsedVars = {};
    try {
      if (v.trim()) parsedVars = JSON.parse(v);
    } catch {}
    body = JSON.stringify({ query: q, variables: parsedVars }, null, 2);
  }
  // Auth: request-level override collection-level
  const auth = raw?.auth ? parsePostmanAuth(raw.auth) : fallbackAuth;
  const ev = parsePmEvents(events);
  return {
    id: uid('req'),
    name,
    method: ((raw?.method || 'GET').toUpperCase() as ApiRequest['method']) || 'GET',
    url,
    params: [],
    headers: (raw?.header ?? []).map((h) => ({ id: uid('kv'), key: h.key ?? '', value: h.value ?? '', enabled: !h.disabled })),
    bodyType,
    body,
    graphql,
    auth,
    preRequest: ev.preRequest,
    tests: ev.tests,
    origin: 'imported',
    updatedAt: Date.now(),
    description: typeof raw?.description === 'string' ? raw.description : '',
  };
}

export function exportCollection(collection: Collection, requests: ApiRequest[]): string {
  return JSON.stringify(collectionToPostman(collection, new Map(requests.map((r) => [r.id, r]))), null, 2);
}

/** Script ReqX → mảng `event` Postman (bỏ trống để khỏi thêm rác vào file). */
function toPmEvents(
  preRequest?: string,
  tests?: string,
  /** Chỉ ở mức collection: script dọn dẹp, Postman bỏ qua listen lạ khi import. */
  teardown?: string,
): Array<{ listen: string; script: { type: string; exec: string[] } }> {
  const out: Array<{ listen: string; script: { type: string; exec: string[] } }> = [];
  if ((preRequest ?? '').trim()) {
    out.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: preRequest!.split('\n') } });
  }
  if ((tests ?? '').trim()) {
    out.push({ listen: 'test', script: { type: 'text/javascript', exec: tests!.split('\n') } });
  }
  if ((teardown ?? '').trim()) {
    out.push({ listen: 'teardown', script: { type: 'text/javascript', exec: teardown!.split('\n') } });
  }
  return out;
}

/** 1 collection → object Postman v2.1 (dùng chung cho export 1 cái và export tất cả). */
export function collectionToPostman(collection: Collection, byId: Map<string, ApiRequest>) {
  const folders = Array.isArray(collection.folders) ? collection.folders : [];
  const rootIds = Array.isArray(collection.rootRequestIds) ? collection.rootRequestIds : [];
  
  // Tìm tất cả folder IDs được nested trong folder khác
  const nestedFolderIds = new Set<string>();
  for (const f of folders) {
    if (f.folderIds) {
      for (const fid of f.folderIds) {
        nestedFolderIds.add(fid);
      }
    }
  }
  
  // Root-level folders = không nằm trong folder nào khác
  const rootFolders = folders.filter(f => !nestedFolderIds.has(f.id));
  
  // Helper: convert folder tree sang Postman item tree
  function folderToPostmanItem(folder: Folder): unknown {
    const childFolders = folder.folderIds 
      ? folders.filter(f => folder.folderIds!.includes(f.id))
      : [];
    
    const events = toPmEvents(folder.preRequest, folder.tests);
    return {
      name: folder.name,
      ...(events.length ? { event: events } : {}),
      item: [
        ...childFolders.map(child => folderToPostmanItem(child)),
        ...(Array.isArray(folder.requestIds) ? folder.requestIds : []).map((id) => fromApiRequest(byId.get(id))).filter(Boolean),
      ],
    };
  }
  
  const colEvents = toPmEvents(collection.preRequest, collection.tests, collection.teardown);
  return {
    info: { name: collection.name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    ...(colEvents.length ? { event: colEvents } : {}),
    item: [
      ...rootFolders.map(f => folderToPostmanItem(f)),
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
  // Bảng điều kiện chỉ có ở ReqX → khi xuất sang Postman phải compile thành code.
  // Một chiều: Postman/ReqX khi import lại chỉ đọc được phần script, không dựng lại được bảng.
  const tableCode = compileAssertions(r.assertions);
  const testsCode = [r.tests ?? '', tableCode].map((s) => s.trim()).filter(Boolean).join('\n\n');
  const events = toPmEvents(r.preRequest, testsCode);
  let bodyObj: unknown = undefined;
  if (r.bodyType === 'graphql') {
    bodyObj = {
      mode: 'graphql',
      graphql: {
        query: r.graphql?.query ?? '',
        variables: r.graphql?.variables ?? '',
      },
    };
  } else if (r.bodyType === 'binary') {
    bodyObj = {
      mode: 'file',
      file: {
        src: r.body ?? '',
      },
    };
  } else if (r.bodyType === 'urlencoded') {
    bodyObj = {
      mode: 'urlencoded',
      urlencoded: (r.body ?? '').split('\n').filter(Boolean).map((line) => {
        const idx = line.indexOf('=');
        return idx >= 0
          ? { key: line.slice(0, idx), value: line.slice(idx + 1) }
          : { key: line, value: '' };
      }),
    };
  } else if (r.bodyType !== 'none' && r.bodyType) {
    bodyObj = { mode: 'raw', raw: r.body ?? '' };
  }
  return {
    name: r.name ?? 'Request',
    ...(events.length ? { event: events } : {}),
    request: {
      method: r.method ?? 'GET',
      url: r.url ?? '',
      header: headers.filter((h) => h && h.enabled).map((h) => ({ key: h.key ?? '', value: h.value ?? '' })),
      body: bodyObj,
      description: r.description ?? '',
    },
  };
}
