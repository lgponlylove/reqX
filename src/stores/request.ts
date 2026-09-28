import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiRequest } from '../types/api';
import { DEFAULT_REQUEST } from '../types/api';
import { uid } from '../lib/variables';
import { stripRequestSecrets } from '../lib/secrets';

export interface ReqTab {
  id: string;
  request: ApiRequest;
  /** true = đã sửa, chưa lưu vào collection */
  dirty: boolean;
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
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  markClean: () => void;
}

function fresh(): ApiRequest {
  return { ...DEFAULT_REQUEST, id: uid('req'), updatedAt: Date.now() };
}

function newTab(request?: ApiRequest, dirty = false): ReqTab {
  const req = request ? { ...request } : fresh();
  return { id: uid('tab'), request: req, dirty };
}

/** Tab có phải tab trắng chưa đụng gì không (để tái dùng khi load)? */
function isPristine(t: ReqTab): boolean {
  const r = t.request;
  return (
    !t.dirty &&
    r.name === DEFAULT_REQUEST.name &&
    r.method === DEFAULT_REQUEST.method &&
    r.url === DEFAULT_REQUEST.url &&
    r.params.length === 0 &&
    r.headers.length === 0 &&
    r.body === '' &&
    r.auth.type === 'none' &&
    (r.preRequest ?? '') === '' &&
    (r.tests ?? '') === ''
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
            const t = { ...active, request: { ...req }, dirty: false };
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

      markClean: () =>
        set((s) => ({
          dirty: false,
          tabs: s.tabs.map((t) => (t.id === s.activeId ? { ...t, dirty: false } : t)),
        })),
    }),
    {
      name: 'postman-clone-request-v1',
      version: 3,
      // Auth secrets chỉ giữ trong RAM, không ghi localStorage.
      partialize: (s) => ({
        tabs: s.tabs.map((t) => ({ ...t, request: stripRequestSecrets(t.request) })),
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
