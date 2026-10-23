import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest } from '../../types/api';
import { DEFAULT_REQUEST } from '../../types/api';

// Store dùng storage mặc định của zustand persist = `window.localStorage`, nên test
// môi trường node phải có window.localStorage TRƯỚC khi import store: persist chốt
// storage một lần lúc khởi tạo middleware, không có thì cache "unavailable" mãi.
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

import { activeSubTab, useRequestStore, type ReqTab } from '../request';

function req(id: string): ApiRequest {
  return { ...DEFAULT_REQUEST, id, name: id, url: `http://x/${id}`, updatedAt: 1 };
}

function twoTabs(): void {
  const a: ReqTab = { id: 'tabA', request: req('A'), dirty: false };
  const b: ReqTab = { id: 'tabB', request: req('B'), dirty: false };
  useRequestStore.setState({ tabs: [a, b], activeId: 'tabA', current: a.request, dirty: false });
}

beforeEach(() => {
  localStorage.clear();
  twoTabs();
});

describe('sub-tab lưu riêng theo từng request tab', () => {
  it('tab chưa có subTab (dữ liệu persist cũ) → Params', () => {
    expect(activeSubTab(useRequestStore.getState())).toBe('params');
  });

  it('đặt Pre-request ở A rồi sang B thì B vẫn Params, quay lại A vẫn Pre-request', () => {
    useRequestStore.getState().setSubTab('pre');
    expect(activeSubTab(useRequestStore.getState())).toBe('pre');

    useRequestStore.getState().setActiveTab('tabB');
    expect(activeSubTab(useRequestStore.getState())).toBe('params');
    expect(useRequestStore.getState().current.name).toBe('B');

    useRequestStore.getState().setActiveTab('tabA');
    expect(activeSubTab(useRequestStore.getState())).toBe('pre');
  });

  it('sửa request (set) không làm mất bảng con đang mở', () => {
    useRequestStore.getState().setSubTab('tests');
    useRequestStore.getState().set({ url: 'http://x/khac' });
    expect(activeSubTab(useRequestStore.getState())).toBe('tests');
    expect(useRequestStore.getState().current.url).toBe('http://x/khac');
  });

  it('mở request mới qua load → tab trắng tái dùng vẫn Params, tab cũ giữ nguyên', () => {
    useRequestStore.getState().setSubTab('auth');
    useRequestStore.getState().openTab(req('C'));
    expect(activeSubTab(useRequestStore.getState())).toBe('params');

    useRequestStore.getState().setActiveTab('tabA');
    expect(activeSubTab(useRequestStore.getState())).toBe('auth');
  });

  it('mở request có method POST/PUT hoặc có sẵn body → tự động mở sẵn focus tab Body', () => {
    const postReq: ApiRequest = {
      ...DEFAULT_REQUEST,
      id: 'req-post',
      name: 'Create Item',
      method: 'POST',
      url: 'http://api.test/items',
      bodyType: 'json',
      body: '{"name":"test"}',
      updatedAt: 1,
    };
    useRequestStore.getState().openTab(postReq);
    expect(activeSubTab(useRequestStore.getState())).toBe('body');

    const getReqWithBody: ApiRequest = {
      ...DEFAULT_REQUEST,
      id: 'req-get-body',
      name: 'Search Item',
      method: 'GET',
      url: 'http://api.test/search',
      bodyType: 'raw',
      body: 'custom payload',
      updatedAt: 1,
    };
    useRequestStore.getState().openTab(getReqWithBody);
    expect(activeSubTab(useRequestStore.getState())).toBe('body');
  });

  it('subTab xuống đĩa cùng persist (reload app không mất bảng đang mở)', () => {
    useRequestStore.getState().setSubTab('pre');
    const raw = localStorage.getItem('postman-clone-request-v1') ?? '';
    expect(JSON.parse(raw).state.tabs[0]).toMatchObject({ id: 'tabA', subTab: 'pre' });
  });
});
