import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiRequest } from '../types/api';
import { DEFAULT_REQUEST } from '../types/api';
import { uid, renameVarInRequest } from '../lib/variables';
import { stripRequestSecrets } from '../lib/secrets';

export type ReqSubTab = 'params' | 'headers' | 'body' | 'auth' | 'pre' | 'tests';
export type TabKind = 'request' | 'env';

export interface ReqTab {
  id: string;
  kind?: TabKind;
  envId?: string | null;
  request: ApiRequest;
  /** true = đã sửa, chưa lưu vào collection */
  dirty: boolean;
  /** Bảng con (Params/Headers/…/Pre-request/Tests) đang mở ở tab này.
   * Mỗi tab giữ riêng — thiếu thì RequestTabs coi như 'params'. */
  subTab?: ReqSubTab;
}

interface RequestState {
  tabs: ReqTab[];
  activeId: string;
  /** request của tab đang mở — giữ để tương thích với các component cũ */
  current: ApiRequest;
  /** true nếu tab đang mở đã sửa chưa lưu */
  dirty: boolean;
  /** Sửa tab đang mở (đánh dấu dirty) */
  set: (patch: Partial<ApiRequest>) => void;
  /** Mở tab trắng mới */
  reset: () => void;
  /** Mở request trong tab (đã mở rồi thì focus lại tab đó, tab trắng tinh thì tái dùng, còn lại mở tab mới) */
  load: (req: ApiRequest) => void;
  openTab: (req?: ApiRequest) => void;
  /** Mở tab quản lý biến môi trường trong Builder (giống Postman) */
  openEnvTab: (envId?: string | null) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  /** Chọn bảng con cho tab đang mở (không ảnh hưởng các tab khác) */
  setSubTab: (tab: ReqSubTab) => void;
  /** Yêu cầu focus và nháy sáng một trường cụ thể (vd: key header Authorization) */
  focusTarget: { subTab: ReqSubTab; fieldKey?: string; ts: number } | null;
  triggerFocus: (subTab: ReqSubTab, fieldKey?: string) => void;
  clearFocusTarget: () => void;
  /** Nạp lại bản mới nhất của request vào các tab đang mở (force = true: đè cả tab dirty do AI sửa) */
  refreshTabs: (requests: Record<string, ApiRequest>, force?: boolean) => void;
  /** Đổi tên biến: thay `{{oldKey}}` → `{{newKey}}` ngay trong mọi tab đang mở (kể cả tab đang sửa dở). */
  renameVarInTabs: (oldKey: string, newKey: string) => void;
  markClean: () => void;
}

function fresh(): ApiRequest {
  return { ...DEFAULT_REQUEST, id: uid('req'), updatedAt: Date.now() };
}

export function defaultSubTabFor(req?: ApiRequest): ReqSubTab {
  if (!req) return 'params';
  // Các phương thức thường xuyên làm việc với Payload / Body hoặc request có sẵn dữ liệu body
  const hasBodyMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const hasBodyContent = Boolean(
    req.body ||
    (req.formData && req.formData.length > 0) ||
    (req.urlEncoded && req.urlEncoded.length > 0) ||
    req.graphql
  );
  if (hasBodyMethod || hasBodyContent) {
    return 'body';
  }
  return 'params';
}

function newTab(request?: ApiRequest, dirty = false): ReqTab {
  const req = request ? { ...request } : fresh();
  return { id: uid('tab'), request: req, dirty, subTab: defaultSubTabFor(req) };
}

/** Bảng con đang mở của tab hoạt động — nếu chưa chọn riêng thì mặc định mở sẵn Body cho POST/PUT/PATCH hoặc request có body. */
export function activeSubTab(s: { tabs: ReqTab[]; activeId: string }): ReqSubTab {
  const tab = s.tabs.find((t) => t.id === s.activeId);
  return tab?.subTab ?? defaultSubTabFor(tab?.request);
}

/** Tab có phải tab trắng chưa đụng gì không (để tái dùng khi load)? */
function isPristine(t: ReqTab): boolean {
  if (t.kind && t.kind !== 'request') return false;
  const r = t.request;
  return (
    !t.dirty &&
    r.name === DEFAULT_REQUEST.name &&
    r.method === DEFAULT_REQUEST.method &&
    r.url === DEFAULT_REQUEST.url &&
    r.params.length === 0 &&
    r.headers.length === 0 &&
    r.body === '' &&
    r.auth.type === 'inherit' &&
    (r.preRequest ?? '') === '' &&
    (r.tests ?? '') === '' &&
    (r.description ?? '') === ''
  );
}

const first = newTab();

export const useRequestStore = create<RequestState>()(
  persist(
    (set) => ({
      tabs: [first],
      activeId: first.id,
      current: first.request,
      dirty: false,

      set: (patch) =>
        set((s) => {
          const current = { ...s.current, ...patch, updatedAt: Date.now() };
          return {
            current,
            dirty: true,
            tabs: s.tabs.map((t) =>
              t.id === s.activeId ? { ...t, request: current, dirty: true } : t,
            ),
          };
        }),

      reset: () =>
        set((s) => {
          const t = newTab();
          return {
            tabs: [...s.tabs, t],
            activeId: t.id,
            current: t.request,
            dirty: false,
          };
        }),

      load: (req) =>
        set((s) => {
          // Đã mở rồi → focus lại tab đó (tab sạch thì nạp bản mới nhất, tab đang sửa dở thì giữ nguyên)
          if (req.id) {
            const existing = s.tabs.find((t) => t.request.id === req.id);
            if (existing) {
              const t = existing.dirty ? existing : { ...existing, request: { ...req } };
              return {
                tabs: s.tabs.map((x) => (x.id === t.id ? t : x)),
                activeId: t.id,
                current: t.request,
                dirty: t.dirty,
              };
            }
          }
          const active = s.tabs.find((t) => t.id === s.activeId);
          // Tái dùng tab trắng tinh để khỏi đẻ tab rác
          if (active && isPristine(active)) {
            const t = { ...active, request: { ...req }, dirty: false, subTab: defaultSubTabFor(req) };
            return {
              tabs: s.tabs.map((x) => (x.id === t.id ? t : x)),
              current: t.request,
              dirty: false,
            };
          }
          const t = newTab(req);
          return {
            tabs: [...s.tabs, t],
            activeId: t.id,
            current: t.request,
            dirty: false,
          };
        }),

      openTab: (req) =>
        set((s) => {
          const t = newTab(req);
          return {
            tabs: [...s.tabs, t],
            activeId: t.id,
            current: t.request,
            dirty: false,
          };
        }),

      openEnvTab: (envId) =>
        set((s) => {
          const existing = s.tabs.find((t) => t.kind === 'env');
          if (existing) {
            return {
              activeId: existing.id,
              current: existing.request,
              dirty: existing.dirty,
            };
          }
          const envReq: ApiRequest = {
            ...DEFAULT_REQUEST,
            id: 'env_tab',
            name: 'Biến môi trường',
            method: 'GET',
            url: '',
            updatedAt: Date.now(),
          };
          const t: ReqTab = {
            id: uid('tab_env'),
            kind: 'env',
            envId: envId ?? null,
            request: envReq,
            dirty: false,
          };
          return {
            tabs: [...s.tabs, t],
            activeId: t.id,
            current: envReq,
            dirty: false,
          };
        }),

      closeTab: (id) =>
        set((s) => {
          if (s.tabs.length <= 1) {
            const t = newTab();
            return { tabs: [t], activeId: t.id, current: t.request, dirty: false };
          }
          const tabs = s.tabs.filter((t) => t.id !== id);
          const activeId = id === s.activeId ? tabs[tabs.length - 1].id : s.activeId;
          const active = tabs.find((t) => t.id === activeId)!;
          return { tabs, activeId, current: active.request, dirty: active.dirty };
        }),

      setActiveTab: (id) =>
        set((s) => {
          const t = s.tabs.find((x) => x.id === id);
          if (!t) return {};
          return { activeId: id, current: t.request, dirty: t.dirty };
        }),

      setSubTab: (tab) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === s.activeId ? { ...t, subTab: tab } : t)) })),

      focusTarget: null,

      triggerFocus: (subTab, fieldKey) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === s.activeId ? { ...t, subTab } : t)),
          focusTarget: { subTab, fieldKey, ts: Date.now() },
        })),

      clearFocusTarget: () => set({ focusTarget: null }),

      markClean: () =>
        set((s) => ({
          dirty: false,
          tabs: s.tabs.map((t) => (t.id === s.activeId ? { ...t, dirty: false } : t)),
        })),

      refreshTabs: (requests, force = false) =>
        set((s) => {
          const tabs = s.tabs.map((t) => {
            if (t.kind === 'env') return t;
            const next = requests[t.request.id];
            if (!next) return t;
            if (force || !t.dirty) {
              return { ...t, request: { ...next }, dirty: force ? false : t.dirty };
            }
            return t;
          });
          const active = tabs.find((t) => t.id === s.activeId) ?? tabs[0];
          return { tabs, current: active.request, dirty: active.dirty };
        }),

      // Đổi tên biến thì ngay cả tab ĐANG SỬA DỞ cũng phải đổi theo: `refreshTabs`
      // bỏ qua tab dirty nên bản cũ vẫn còn {{oldKey}} và bấm Save là ghi đè ngược.
      renameVarInTabs: (oldKey, newKey) =>
        set((s) => {
          const tabs = s.tabs.map((t) => {
            if (t.kind === 'env') return t;
            const next = renameVarInRequest(t.request, oldKey, newKey);
            return next === t.request ? t : { ...t, request: next };
          });
          const active = tabs.find((t) => t.id === s.activeId) ?? tabs[0];
          return { tabs, current: active.request, dirty: active.dirty };
        }),
    }),
    {
      name: 'postman-clone-request-v1',
      version: 3,
      partialize: (s) => ({
        tabs: s.tabs,
        activeId: s.activeId,
      }),
      merge: (persisted, currentState) => {
        const p = persisted as Partial<RequestState>;
        const tabs = p.tabs && p.tabs.length > 0 ? p.tabs : currentState.tabs;
        const activeId = p.activeId && tabs.some((t) => t.id === p.activeId) ? p.activeId : tabs[0].id;
        const active = tabs.find((t) => t.id === activeId)!;
        return { ...currentState, ...p, tabs, activeId, current: active.request, dirty: active.dirty };
      },
    },
  ),
);
