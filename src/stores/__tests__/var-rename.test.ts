import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest, Collection, Environment } from '../../types/api';
import { DEFAULT_REQUEST } from '../../types/api';
import { countVarRefs, renameVarInRequest, requestHasVarRef } from '../../lib/variables';

// Store app + store request đều dùng zustand persist → phải có localStorage TRƯỚC khi import.
vi.hoisted(() => {
  const store: Record<string, string> = {};
  const localStorageMock = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k in store) delete store[k]; },
    length: 0,
    key: () => null,
  } as Storage;
  const g = globalThis as { localStorage?: Storage; window?: { localStorage: Storage } };
  g.localStorage = localStorageMock;
  g.window = { localStorage: localStorageMock };
});

import { useAppStore } from '../app';
import { useRequestStore } from '../request';

function req(id: string, over: Partial<ApiRequest> = {}): ApiRequest {
  return { ...DEFAULT_REQUEST, id, name: id, url: `http://x/${id}`, updatedAt: 1, ...over };
}

const OLD = 'domain.sso.shome1';
const NEW = 'domain.sso.shome';

/** Một env có 2 biến (1 biến tham chiếu biến kia) + 1 request đã lưu + tab đang mở cùng request. */
function seed(tabDirty: boolean): void {
  const envA: Environment = {
    id: 'envA',
    name: 'shome-live',
    variables: { [OLD]: 'sso.shome1.vn', gateway: `https://{{${OLD}}}/gw` },
  };
  const envB: Environment = { id: 'envB', name: 'sysone-live', variables: { other: 'x' } };
  const saved = req('r1', {
    collectionId: 'c1',
    url: `https://{{${OLD}}}/api/login?back={{ ${OLD} }}`,
    body: `{"host":"{{${OLD}}}","other":"{{domain.sso.shome1extra}}"}`,
    headers: [{ id: 'h1', key: 'X-Host', value: `{{${OLD}}}`, enabled: true }],
    auth: { type: 'oauth2', oauth2: { tokenUrl: `https://{{${OLD}}}/oauth/token`, clientId: 'cid' } },
    tests: `pm.test('host', () => pm.expect(pm.response.text()).to.include('{{${OLD}}}'));`,
  });
  const col: Collection = {
    id: 'c1',
    name: 'C1',
    folders: [{ id: 'f1', name: 'F1', requestIds: ['r1'], folderIds: [], preRequest: `pm.variables.set('h','{{${OLD}}}')` }],
    rootRequestIds: [],
    preRequest: `const host = '{{${OLD}}}';`,
  };
  useAppStore.setState({
    environments: [envA, envB],
    activeEnvId: 'envA',
    envSecrets: {},
    globals: { tenant: `t-{{${OLD}}}` },
    globalSecrets: [],
    requests: { r1: saved },
    collections: [col],
  });
  useRequestStore.setState({
    tabs: [{ id: 'tabA', request: { ...saved, name: tabDirty ? 'đang sửa dở' : saved.name }, dirty: tabDirty }],
    activeId: 'tabA',
    current: { ...saved, name: tabDirty ? 'đang sửa dở' : saved.name },
    dirty: tabDirty,
  });
}

beforeEach(() => {
  localStorage.clear();
  seed(false);
});

describe('renameVarInRequest (hàm thuần)', () => {
  it('đổi ở mọi trường text, kể cả {{ có khoảng trắng }}', () => {
    const out = renameVarInRequest(
      req('r', { url: `{{${OLD}}}/x`, headers: [{ id: 'h', key: 'k', value: `{{ ${OLD} }}`, enabled: true }] }),
      OLD,
      NEW,
    );
    expect(out.url).toBe(`{{${NEW}}}/x`);
    expect(out.headers[0].value).toBe(`{{${NEW}}}`);
  });

  it('không ăn nhầm key có tiền đề giống nhau (shome ≠ shome1, shome1 ≠ shome1extra)', () => {
    const out = renameVarInRequest(req('r', { body: `{"a":"{{${OLD}}}","b":"{{${OLD}extra}}"}` }), OLD, NEW);
    expect(out.body).toContain(`{{${NEW}}}`);
    expect(out.body).toContain(`{{${OLD}extra}}`); // vẫn còn nguyên
    const back = renameVarInRequest(req('r', { url: `{{${NEW}}}/x` }), NEW, 'other');
    expect(back.url).toBe('{{other}}/x');
  });

  it('không có tham chiếu thì trả đúng object cũ (giữ so sánh tham chiếu)', () => {
    const r = req('r', { url: 'http://x/y' });
    expect(renameVarInRequest(r, OLD, NEW)).toBe(r);
    expect(requestHasVarRef(OLD, r)).toBe(false);
  });

  it('quét cả auth thường và cấu hình OAuth2 lồng trong auth', () => {
    const r = req('r', {
      url: 'http://x',
      auth: { type: 'apikey', apiKey: `{{${OLD}}}`, apiKeyName: 'X-K', oauth2: { tokenUrl: `https://{{${OLD}}}/t` } },
    });
    expect(requestHasVarRef(OLD, r)).toBe(true);
    const out = renameVarInRequest(r, OLD, NEW);
    expect(out.auth.apiKey).toBe(`{{${NEW}}}`);
    expect(out.auth.oauth2?.tokenUrl).toBe(`https://{{${NEW}}}/t`);
    expect(out.auth.apiKeyName).toBe('X-K');
  });
});

describe('countVarRefs báo đúng số nơi sẽ được đổi', () => {
  it('đếm theo request (mỗi request 1 lần) + script collection/folder', () => {
    const s = useAppStore.getState();
    expect(countVarRefs(OLD, s.requests, s.collections)).toBe(2); // 1 request + 1 collection
  });

  it('tính thêm giá trị biến khác khi có `extra`', () => {
    const s = useAppStore.getState();
    const extra = [...s.environments.flatMap((e) => Object.values(e.variables)), ...Object.values(s.globals)];
    // gateway của envA + tenant global
    expect(countVarRefs(OLD, s.requests, s.collections, extra)).toBe(4);
  });
});

describe('renameEnvVar — đồng bộ mọi nơi người dùng nhìn thấy', () => {
  it('đổi key trong env + request đã lưu + script + oauth2 + giá trị biến khác', () => {
    useAppStore.getState().renameEnvVar('envA', OLD, NEW);
    const s = useAppStore.getState();

    expect(s.environments[0].variables[NEW]).toBe('sso.shome1.vn');
    expect(OLD in s.environments[0].variables).toBe(false);
    expect(s.environments[0].variables.gateway).toBe(`https://{{${NEW}}}/gw`);
    expect(s.globals.tenant).toBe(`t-{{${NEW}}}`);

    const r = s.requests.r1;
    expect(r.url).toBe(`https://{{${NEW}}}/api/login?back={{${NEW}}}`);
    expect(r.body).toContain(`"host":"{{${NEW}}}"`);
    expect(r.body).toContain(`{{${OLD}extra}}`);
    expect(r.headers[0].value).toBe(`{{${NEW}}}`);
    expect(r.tests).toContain(`{{${NEW}}}`);
    expect(r.auth.oauth2?.tokenUrl).toBe(`https://{{${NEW}}}/oauth/token`);
    expect(s.collections[0].preRequest).toBe(`const host = '{{${NEW}}}';`);
    expect(s.collections[0].folders[0].preRequest).toContain(`{{${NEW}}}`);
  });

  it('tab ĐANG MỞ đổi theo — đây là lỗi "thông báo rồi nhưng chưa thấy đổi theo"', () => {
    useAppStore.getState().renameEnvVar('envA', OLD, NEW);
    const st = useRequestStore.getState();
    expect(st.current.url).toBe(`https://{{${NEW}}}/api/login?back={{${NEW}}}`);
    expect(JSON.stringify(st.tabs[0].request)).not.toContain(`{{${OLD}}}`);
  });

  it('tab đang sửa dở vẫn đổi tên biến và giữ nguyên sửa dở + dirty', () => {
    seed(true);
    useAppStore.getState().renameEnvVar('envA', OLD, NEW);
    const t = useRequestStore.getState().tabs[0];
    expect(t.dirty).toBe(true);
    expect(t.request.name).toBe('đang sửa dở');
    expect(t.request.url).toContain(`{{${NEW}}}`);
    expect(t.request.url).not.toContain(OLD);
  });

  it('đổi tên không có tham chiếu thì không làm dirty tab', () => {
    useAppStore.getState().renameEnvVar('envA', 'gateway', 'gw');
    const st = useRequestStore.getState();
    expect(st.dirty).toBe(false);
    expect(st.tabs[0].request.url).toBe(useAppStore.getState().requests.r1.url);
  });
});

describe('renameGlobal', () => {
  it('đổi key global và sync cả request đã lưu lẫn tab đang mở', () => {
    const saved = req('r9', { url: `https://api/x?t={{tenant}}&k={{${OLD}}}` });
    useAppStore.setState({ requests: { r9: saved } });
    useRequestStore.setState({
      tabs: [{ id: 'tabZ', request: { ...saved }, dirty: false }],
      activeId: 'tabZ',
      current: { ...saved },
      dirty: false,
    });

    useAppStore.getState().renameGlobal('tenant', 'org');

    const s = useAppStore.getState();
    expect(s.globals.org).toBe('t-{{domain.sso.shome1}}'); // giá trị chuyển theo key
    expect('tenant' in s.globals).toBe(false);
    expect(s.requests.r9.url).toBe(`https://api/x?t={{org}}&k={{${OLD}}}`);
    expect(useRequestStore.getState().current.url).toBe(`https://api/x?t={{org}}&k={{${OLD}}}`);
  });
});
