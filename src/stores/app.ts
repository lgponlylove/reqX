import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useRequestStore } from './request';
import type { ApiRequest, ApiResponse, Collection, Dir, Environment, HistoryItem } from '../types/api';
import { uid } from '../lib/variables';
import { GEMINI_DEFAULT_MODEL, sanitizeContents, type GeminiContent } from '../lib/ai/gemini';
import type { AiChainEntry, AiStrategy, AiUsage } from '../lib/ai/ai-providers';
import { stripRequestSecrets } from '../lib/secrets';
import type { ScriptOutcome } from '../lib/scripts';

interface AppState {
  collections: Collection[];
  /** Thư mục cấp cao chứa collection (kiểu workspace) */
  dirs: Dir[];
  requests: Record<string, ApiRequest>;
  environments: Environment[];
  activeEnvId: string | null;
  globals: Record<string, string>;
  /** envId -> danh sách key secret (giá trị chỉ giữ trong RAM, không persist) */
  envSecrets: Record<string, string[]>;
  /** danh sách key global secret */
  globalSecrets: string[];
  history: HistoryItem[];
  response: ApiResponse | null;
  /** Kết quả tests của lần gửi gần nhất (không persist) */
  testRun: ScriptOutcome | null;
  sending: boolean;

  addCollection: (name: string) => void;
  renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void;
  addDir: (name: string) => void;
  renameDir: (id: string, name: string) => void;
  /** Xóa thư mục — các collection bên trong chuyển ra "Ngoài thư mục" (không mất). */
  deleteDir: (id: string) => void;
  /** Chuyển collection vào thư mục (dirId null = ra ngoài). */
  moveCollection: (collectionId: string, dirId: string | null) => void;
  removeRequestFromCollection: (collectionId: string, requestId: string) => void;
  duplicateRequest: (collectionId: string, requestId: string) => void;
  renameRequest: (requestId: string, name: string) => void;
  addFolder: (collectionId: string, name: string) => void;
  renameFolder: (collectionId: string, folderId: string, name: string) => void;
  deleteFolder: (collectionId: string, folderId: string) => void;
  moveRequest: (collectionId: string, requestId: string, target: { folderId: string } | 'root') => void;
  /** Chuyển request sang collection khác (kéo-thả liên collection). */
  moveRequestToCollection: (fromId: string, requestId: string, toId: string, target: { folderId: string } | 'root') => void;
  /** Lưu request: có gốc trong store thì ghi đè tại chỗ (giữ nguyên folder/collection);
   * request mới thì tạo vào collection chỉ định (mặc định collection đầu). Trả null nếu không lưu được. */
  saveRequest: (req: ApiRequest, collectionId?: string) => ApiRequest | null;
  addEnvironment: (name: string) => void;
  renameEnvironment: (id: string, name: string) => void;
  deleteEnvironment: (id: string) => void;
  duplicateEnvironment: (id: string) => void;
  setActiveEnv: (id: string | null) => void;
  setEnvVar: (envId: string, key: string, value: string) => void;
  deleteEnvVar: (envId: string, key: string) => void;
  setEnvSecret: (envId: string, key: string, secret: boolean) => void;
  setGlobal: (key: string, value: string) => void;
  deleteGlobal: (key: string) => void;
  setGlobalSecret: (key: string, secret: boolean) => void;
  pushHistory: (item: HistoryItem) => void;
  removeHistoryItem: (id: string) => void;
  clearHistory: () => void;
  setResponse: (r: ApiResponse | null) => void;
  setTestRun: (t: ScriptOutcome | null) => void;
  /** Response/tests của lần gửi gần nhất, giữ riêng theo từng request-tab (RAM, không persist) */
  respByTab: Record<string, { reqId: string; res: ApiResponse | null }>;
  testsByTab: Record<string, { reqId: string; res: ScriptOutcome | null }>;
  /** Xóa dữ liệu các tab đã đóng */
  pruneTabs: (ids: string[]) => void;
  setSending: (v: boolean) => void;
  importData: (collection: Collection, reqs: ApiRequest[]) => void;
  /** API key Google AI Studio cho tab AI (lưu trong máy này, chỉ gửi tới googleapis.com) */
  aiKey: string;
  /** Key dự phòng — tự dùng khi key chính gặp lỗi quota/rate limit */
  aiKeyBackup: string;
  aiModel: string;
  setAiKey: (k: string) => void;
  setAiKeyBackup: (k: string) => void;
  setAiModel: (m: string) => void;
  /** Chain providers cho tab AI: xoay vòng chia tải + lỗi thì failover sang nấc tiếp theo */
  aiChain: AiChainEntry[];
  /** Vị trí xoay vòng (tăng mỗi lượt chat để chia đều tải) */
  aiRrIndex: number;
  setAiChain: (c: AiChainEntry[]) => void;
  bumpAiRr: () => void;
  /** Chiến lược gọi chain: save-cost (free trước) hay stable (paid trước) */
  aiStrategy: AiStrategy;
  setAiStrategy: (s: AiStrategy) => void;
  /** Thống kê tokens theo entry chain (để ước tính chi phí nấc paid) */
  aiStats: Record<string, AiEntryStats>;
  recordAiUsage: (id: string, u: AiUsage, ok: boolean) => void;
  clearAiStats: () => void;
  /** Lịch sử chat tab AI (persist, tối đa 100 dòng — đổi tab/tắt app vẫn còn) */
  aiChat: AiChatMsg[];
  /** Ngữ cảnh hội thoại gửi kèm cho Gemini (persist, tối đa 30 lượt) */
  aiContents: GeminiContent[];
  pushAiChat: (m: AiChatMsg) => void;
  setAiContents: (c: GeminiContent[]) => void;
  clearAiChat: () => void;
}

/** Thống kê 1 nấc chain: số lần gọi/lỗi + tokens (cộng dồn, có nút reset) */
export interface AiEntryStats {
  calls: number;
  fails: number;
  prompt: number;
  completion: number;
}

/** 1 dòng chat tab AI */
export interface AiChatMsg {
  role: 'user' | 'model' | 'tool';
  text: string;
}

const seedEnv: Environment = {
  id: uid('env'),
  name: 'Dev',
  variables: { baseUrl: 'https://jsonplaceholder.typicode.com' },
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
  collections: [],
  dirs: [],
  requests: {},
  environments: [seedEnv],
  activeEnvId: seedEnv.id,
  globals: {},
  envSecrets: {},
  globalSecrets: [],
  aiKey: '',
  aiKeyBackup: '',
  aiModel: GEMINI_DEFAULT_MODEL,
  aiChain: [],
  aiRrIndex: 0,
  aiStrategy: 'save-cost',
  aiStats: {},
  aiChat: [],
  aiContents: [],
  history: [],
  response: null,
  testRun: null,
  respByTab: {},
  testsByTab: {},
  sending: false,

  addCollection: (name) =>
    set((s) => ({
      collections: [...s.collections, { id: uid('col'), name, folders: [], rootRequestIds: [] }],
    })),

  renameCollection: (id, name) =>
    set((s) => ({
      collections: s.collections.map((c) => (c.id === id ? { ...c, name } : c)),
    })),

  deleteCollection: (id) =>
    set((s) => {
      const col = s.collections.find((c) => c.id === id);
      const doomed = new Set([
        ...(col?.rootRequestIds ?? []),
        ...(col?.folders.flatMap((f) => f.requestIds) ?? []),
      ]);
      const requests = { ...s.requests };
      for (const rid of doomed) delete requests[rid];
      return {
        collections: s.collections.filter((c) => c.id !== id),
        dirs: s.dirs.map((d) => ({ ...d, collectionIds: d.collectionIds.filter((cid) => cid !== id) })),
        requests,
      };
    }),

  addDir: (name) =>
    set((s) => ({ dirs: [...s.dirs, { id: uid('dir'), name, collectionIds: [] }] })),

  renameDir: (id, name) =>
    set((s) => ({ dirs: s.dirs.map((d) => (d.id === id ? { ...d, name } : d)) })),

  deleteDir: (id) =>
    set((s) => ({ dirs: s.dirs.filter((d) => d.id !== id) })),

  moveCollection: (collectionId, dirId) =>
    set((s) => ({
      dirs: s.dirs.map((d) => {
        const without = d.collectionIds.filter((cid) => cid !== collectionId);
        return d.id === dirId ? { ...d, collectionIds: [...without, collectionId] } : { ...d, collectionIds: without };
      }),
    })),

  removeRequestFromCollection: (collectionId, requestId) =>
    set((s) => {
      const requests = { ...s.requests };
      delete requests[requestId];
      return {
        requests,
        collections: s.collections.map((c) =>
          c.id !== collectionId
            ? c
            : {
                ...c,
                rootRequestIds: c.rootRequestIds.filter((id) => id !== requestId),
                folders: c.folders.map((f) => ({
                  ...f,
                  requestIds: f.requestIds.filter((id) => id !== requestId),
                })),
              },
        ),
      };
    }),

  duplicateRequest: (collectionId, requestId) =>
    set((s) => {
      const src = s.requests[requestId];
      if (!src) return s;
      const copy: ApiRequest = {
        ...src,
        id: uid('req'),
        name: `${src.name || '(không tên)'} (copy)`,
        collectionId,
        updatedAt: Date.now(),
      };
      // Chèn ngay sau bản gốc (chỉ ở nơi chứa nó: root hoặc đúng 1 folder)
      const insertAfter = (ids: string[]) => {
        const i = ids.indexOf(requestId);
        return i < 0 ? ids : [...ids.slice(0, i + 1), copy.id, ...ids.slice(i + 1)];
      };
      return {
        requests: { ...s.requests, [copy.id]: copy },
        collections: s.collections.map((c) =>
          c.id !== collectionId
            ? c
            : {
                ...c,
                rootRequestIds: insertAfter(c.rootRequestIds),
                folders: c.folders.map((f) => ({ ...f, requestIds: insertAfter(f.requestIds) })),
              },
        ),
      };
    }),

  renameRequest: (requestId, name) =>
    set((s) => ({
      requests: s.requests[requestId]
        ? { ...s.requests, [requestId]: { ...s.requests[requestId], name, updatedAt: Date.now() } }
        : s.requests,
    })),

  addFolder: (collectionId, name) =>
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id !== collectionId
          ? c
          : { ...c, folders: [...c.folders, { id: uid('fld'), name, requestIds: [] }] },
      ),
    })),

  renameFolder: (collectionId, folderId, name) =>
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id !== collectionId
          ? c
          : { ...c, folders: c.folders.map((f) => (f.id === folderId ? { ...f, name } : f)) },
      ),
    })),

  deleteFolder: (collectionId, folderId) =>
    set((s) => ({
      collections: s.collections.map((c) => {
        if (c.id !== collectionId) return c;
        const folder = c.folders.find((f) => f.id === folderId);
        return {
          ...c,
          folders: c.folders.filter((f) => f.id !== folderId),
          // Giữ requests: chuyển về root thay vì xóa
          rootRequestIds: [...c.rootRequestIds, ...(folder?.requestIds ?? [])],
        };
      }),
    })),

  moveRequest: (collectionId, requestId, target) =>
    set((s) => ({
      collections: s.collections.map((c) => {
        if (c.id !== collectionId) return c;
        const rootRequestIds = c.rootRequestIds.filter((id) => id !== requestId);
        const folders = c.folders.map((f) => ({
          ...f,
          requestIds: f.requestIds.filter((id) => id !== requestId),
        }));
        if (target === 'root') rootRequestIds.push(requestId);
        else {
          const f = folders.find((x) => x.id === target.folderId);
          f?.requestIds.push(requestId);
        }
        return { ...c, rootRequestIds, folders };
      }),
    })),

  moveRequestToCollection: (fromId, requestId, toId, target) =>
    set((s) => {
      if (!s.requests[requestId] || fromId === toId) return s;
      const strip = (c: Collection) => ({
        ...c,
        rootRequestIds: c.rootRequestIds.filter((id) => id !== requestId),
        folders: c.folders.map((f) => ({ ...f, requestIds: f.requestIds.filter((id) => id !== requestId) })),
      });
      return {
        requests: { ...s.requests, [requestId]: { ...s.requests[requestId], collectionId: toId, updatedAt: Date.now() } },
        collections: s.collections.map((c) => {
          if (c.id === fromId) return strip(c);
          if (c.id !== toId) return c;
          const base = strip(c);
          if (target === 'root') return { ...base, rootRequestIds: [...base.rootRequestIds, requestId] };
          return {
            ...base,
            folders: base.folders.map((f) =>
              f.id === target.folderId ? { ...f, requestIds: [...f.requestIds, requestId] } : f,
            ),
          };
        }),
      };
    }),

  saveRequest: (req, collectionId) => {
    const s = get();
    // Đã có gốc trong store → ghi đè tại chỗ, giữ nguyên folder/collection đang chứa
    if (req.id && s.requests[req.id]) {
      // Đã mở ra xem và bấm Lưu = tin cậy → xóa dấu 'imported', lần sau chạy script không hỏi nữa
      const saved: ApiRequest = { ...req, origin: undefined, updatedAt: Date.now() };
      set({ requests: { ...s.requests, [req.id]: saved } });
      return saved;
    }
    // Request mới (tab trắng) → tạo vào collection chỉ định, mặc định collection đầu
    const target = s.collections.find((c) => c.id === collectionId) ?? s.collections[0] ?? null;
    if (!target) return null;
    const saved: ApiRequest = { ...req, id: req.id || uid('req'), collectionId: target.id, origin: undefined, updatedAt: Date.now() };
    set((st) => ({
      requests: { ...st.requests, [saved.id]: saved },
      collections: st.collections.map((c) =>
        c.id === target.id && !c.rootRequestIds.includes(saved.id)
          ? { ...c, rootRequestIds: [...c.rootRequestIds, saved.id] }
          : c,
      ),
    }));
    return saved;
  },

  addEnvironment: (name) =>
    set((s) => {
      const env: Environment = { id: uid('env'), name, variables: {} };
      return { environments: [...s.environments, env], activeEnvId: env.id };
    }),

  renameEnvironment: (id, name) =>
    set((s) => ({
      environments: s.environments.map((e) => (e.id === id ? { ...e, name } : e)),
    })),

  deleteEnvironment: (id) =>
    set((s) => {
      const environments = s.environments.filter((e) => e.id !== id);
      const activeEnvId =
        s.activeEnvId === id ? (environments[0]?.id ?? null) : s.activeEnvId;
      const envSecrets = { ...s.envSecrets };
      delete envSecrets[id];
      return { environments, activeEnvId, envSecrets };
    }),

  duplicateEnvironment: (id) =>
    set((s) => {
      const src = s.environments.find((e) => e.id === id);
      if (!src) return {};
      const copy: Environment = {
        id: uid('env'),
        name: `${src.name} (copy)`,
        // Không copy giá trị secret — chỉ copy biến thường.
        variables: Object.fromEntries(
          Object.entries(src.variables).filter(
            ([k]) => !(s.envSecrets[id] ?? []).includes(k),
          ),
        ),
      };
      return {
        environments: [...s.environments, copy],
        envSecrets: { ...s.envSecrets, [copy.id]: [...(s.envSecrets[id] ?? [])] },
      };
    }),

  setActiveEnv: (id) => set({ activeEnvId: id }),

  setEnvVar: (envId, key, value) =>
    set((s) => ({
      environments: s.environments.map((e) =>
        e.id === envId ? { ...e, variables: { ...e.variables, [key]: value } } : e,
      ),
    })),

  deleteEnvVar: (envId, key) =>
    set((s) => ({
      environments: s.environments.map((e) => {
        if (e.id !== envId) return e;
        const variables = { ...e.variables };
        delete variables[key];
        return { ...e, variables };
      }),
      envSecrets: {
        ...s.envSecrets,
        [envId]: (s.envSecrets[envId] ?? []).filter((k) => k !== key),
      },
    })),

  setEnvSecret: (envId, key, secret) =>
    set((s) => {
      const cur = s.envSecrets[envId] ?? [];
      const next = secret ? [...new Set([...cur, key])] : cur.filter((k) => k !== key);
      return { envSecrets: { ...s.envSecrets, [envId]: next } };
    }),

  setGlobal: (key, value) => set((s) => ({ globals: { ...s.globals, [key]: value } })),

  deleteGlobal: (key) =>
    set((s) => {
      const globals = { ...s.globals };
      delete globals[key];
      return { globals, globalSecrets: s.globalSecrets.filter((k) => k !== key) };
    }),

  setGlobalSecret: (key, secret) =>
    set((s) => ({
      globalSecrets: secret
        ? [...new Set([...s.globalSecrets, key])]
        : s.globalSecrets.filter((k) => k !== key),
    })),

  pushHistory: (item) => set((s) => ({ history: [item, ...s.history].slice(0, 100) })),
  removeHistoryItem: (id) => set((s) => ({ history: s.history.filter((h) => h.id !== id) })),
  clearHistory: () => set({ history: [] }),
  setResponse: (r) =>
    set((s) => {
      const t = useRequestStore.getState();
      return { response: r, respByTab: { ...s.respByTab, [t.activeId]: { reqId: t.current.id, res: r } } };
    }),
  setTestRun: (t) =>
    set((s) => {
      const r = useRequestStore.getState();
      return { testRun: t, testsByTab: { ...s.testsByTab, [r.activeId]: { reqId: r.current.id, res: t } } };
    }),
  pruneTabs: (ids) =>
    set((s) => {
      const keep = new Set(ids);
      const respByTab: AppState['respByTab'] = {};
      for (const [k, v] of Object.entries(s.respByTab)) if (keep.has(k)) respByTab[k] = v;
      const testsByTab: AppState['testsByTab'] = {};
      for (const [k, v] of Object.entries(s.testsByTab)) if (keep.has(k)) testsByTab[k] = v;
      return { respByTab, testsByTab };
    }),
  setSending: (v) => set({ sending: v }),
  setAiKey: (k) => set({ aiKey: k }),
  setAiKeyBackup: (k) => set({ aiKeyBackup: k }),
  setAiModel: (m) => set({ aiModel: m || GEMINI_DEFAULT_MODEL }),
  setAiChain: (c) => set({ aiChain: c }),
  bumpAiRr: () => set((s) => ({ aiRrIndex: s.aiRrIndex + 1 })),
  setAiStrategy: (s) => set({ aiStrategy: s }),
  recordAiUsage: (id, u, ok) =>
    set((s) => {
      const prev = s.aiStats[id] ?? { calls: 0, fails: 0, prompt: 0, completion: 0 };
      return {
        aiStats: {
          ...s.aiStats,
          [id]: {
            calls: prev.calls + 1,
            fails: prev.fails + (ok ? 0 : 1),
            prompt: prev.prompt + (u?.prompt ?? 0),
            completion: prev.completion + (u?.completion ?? 0),
          },
        },
      };
    }),
  clearAiStats: () => set({ aiStats: {} }),
  pushAiChat: (m) => set((s) => ({ aiChat: [...s.aiChat, m].slice(-100) })),
  setAiContents: (c) => set({ aiContents: sanitizeContents(c.slice(-30)) }),
  clearAiChat: () => set({ aiChat: [], aiContents: [] }),

  importData: (collection, reqs) =>
    set((s) => {
      const next: Record<string, ApiRequest> = { ...s.requests };
      for (const r of reqs) next[r.id] = { ...r, collectionId: collection.id };
      return { collections: [...s.collections, collection], requests: next };
    }),
    }),
    {
      name: 'postman-clone-app-v1',
      version: 3,
      // v2 -> v3: model mặc định đổi sang gemini-flash-lite-latest (nhanh nhất).
      migrate: (s: any) => {
        if (s && s.aiModel === 'gemini-2.0-flash') s.aiModel = GEMINI_DEFAULT_MODEL;
        return s;
      },
      // Chỉ lưu data, không lưu response/sending (trạng thái tạm).
      // Secrets không persist: giá trị biến secret + auth token/password/apiKey bị xóa.
      partialize: (s) => {
        const secretGlobals = new Set(s.globalSecrets ?? []);
        const globals: Record<string, string> = {};
        for (const [k, v] of Object.entries(s.globals)) {
          if (!secretGlobals.has(k)) globals[k] = v;
        }
        const requests: Record<string, ApiRequest> = {};
        for (const [id, r] of Object.entries(s.requests)) {
          requests[id] = stripRequestSecrets(r);
        }
        return {
          collections: s.collections,
          dirs: s.dirs,
          requests,
          environments: s.environments.map((e) => {
            const secrets = new Set(s.envSecrets[e.id] ?? []);
            if (secrets.size === 0) return e;
            const variables: Record<string, string> = {};
            for (const [k, v] of Object.entries(e.variables)) {
              if (!secrets.has(k)) variables[k] = v;
            }
            return { ...e, variables };
          }),
          activeEnvId: s.activeEnvId,
          globals,
          envSecrets: s.envSecrets,
          globalSecrets: s.globalSecrets,
          history: s.history.map((h) => ({ ...h, request: stripRequestSecrets(h.request) })),
          aiKey: s.aiKey,
          aiKeyBackup: s.aiKeyBackup,
          aiModel: s.aiModel,
          aiChain: s.aiChain,
          aiRrIndex: s.aiRrIndex,
          aiStrategy: s.aiStrategy,
          aiStats: s.aiStats,
          aiChat: s.aiChat.slice(-100),
          aiContents: s.aiContents.slice(-30),
        };
      },
    },
  ),
);
