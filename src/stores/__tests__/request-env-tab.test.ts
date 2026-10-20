import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest } from '../../types/api';
import { DEFAULT_REQUEST } from '../../types/api';

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

import { useRequestStore, type ReqTab } from '../request';

function sampleReq(id: string): ApiRequest {
  return { ...DEFAULT_REQUEST, id, name: id, url: `https://api.test/${id}`, updatedAt: Date.now() };
}

beforeEach(() => {
  localStorage.clear();
  const initTab: ReqTab = { id: 'req_1', request: sampleReq('Req 1'), dirty: false, kind: 'request' };
  useRequestStore.setState({
    tabs: [initTab],
    activeId: 'req_1',
    current: initTab.request,
    dirty: false,
  });
});

describe('Environment Tab in Builder Store', () => {
  it('opens an env tab and sets it active', () => {
    useRequestStore.getState().openEnvTab('env_prod');
    const state = useRequestStore.getState();
    expect(state.tabs).toHaveLength(2);
    const envTab = state.tabs.find((t) => t.kind === 'env');
    expect(envTab).toBeDefined();
    expect(envTab?.envId).toBe('env_prod');
    expect(state.activeId).toBe(envTab?.id);
    expect(envTab?.request.name).toBe('Biến môi trường');
  });

  it('reuses existing env tab without duplicating', () => {
    useRequestStore.getState().openEnvTab('env_1');
    const firstEnvTabId = useRequestStore.getState().activeId;

    // Switch back to request tab
    useRequestStore.getState().setActiveTab('req_1');
    expect(useRequestStore.getState().activeId).toBe('req_1');

    // Call openEnvTab again
    useRequestStore.getState().openEnvTab('env_2');
    const state = useRequestStore.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.activeId).toBe(firstEnvTabId);
  });

  it('does not overwrite env tab when loading a request', () => {
    useRequestStore.getState().openEnvTab();
    const envTabId = useRequestStore.getState().activeId;

    const newReq = sampleReq('Req 2');
    useRequestStore.getState().load(newReq);

    const state = useRequestStore.getState();
    expect(state.tabs).toHaveLength(3);
    const envTab = state.tabs.find((t) => t.id === envTabId);
    expect(envTab?.kind).toBe('env');
    expect(state.current.name).toBe('Req 2');
  });

  it('preserves env tabs across refreshTabs and renameVarInTabs', () => {
    useRequestStore.getState().openEnvTab();
    const stateBefore = useRequestStore.getState();
    const envTabBefore = stateBefore.tabs.find((t) => t.kind === 'env');

    useRequestStore.getState().renameVarInTabs('oldVar', 'newVar');
    useRequestStore.getState().refreshTabs({});

    const stateAfter = useRequestStore.getState();
    const envTabAfter = stateAfter.tabs.find((t) => t.kind === 'env');
    expect(envTabAfter?.id).toBe(envTabBefore?.id);
    expect(envTabAfter?.kind).toBe('env');
  });
});
