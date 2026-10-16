import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useRequestStore } from './request';
import type { ApiRequest, ApiResponse, Collection, Dir, Environment, Folder, HistoryItem } from '../types/api';
import { uid, renameVarInRequest, renameVarRef } from '../lib/variables';
import { GEMINI_DEFAULT_MODEL, sanitizeContents, type GeminiContent } from '../lib/ai/gemini';
import type { AiChainEntry, AiStrategy, AiUsage } from '../lib/ai/ai-providers';
import { stripRequestSecrets, looksSecret } from '../lib/secrets';
import { maskSensitiveBody } from '../lib/mask';
import type { ScriptOutcome } from '../lib/scripts';

/** Trạng thái cần chụp lại trước khi trích biến hàng loạt để hoàn tác 1 bước */
export interface VarsSnapshot {
  requests: Record<string, ApiRequest>;
  environments: Environment[];
  envSecrets: Record<string, string[]>;
  globals: Record<string, string>;
  globalSecrets: string[];
}

/**
 * Thay mọi tham chiếu `{{oldKey}}` → `{{newKey}}` trong request đã lưu (URL, params,
 * headers, body, auth + OAuth2, script), script cấp collection/folder, và **giá trị
 * của các biến khác** (vd `baseUrl = http://{{domain}}/api`). Tab đang mở do
 * `renameVarInTabs()` lo — xem `useRequestStore`.
 */
function renameVarRefs(oldKey: string, newKey: string, state: AppState) {
  const swap = (txt?: string) => renameVarRef(txt, oldKey, newKey);

  const requests: Record<string, ApiRequest> = {};
  for (const [id, req] of Object.entries(state.requests)) requests[id] = renameVarInRequest(req, oldKey, newKey);

  const collections = state.collections.map((c) => ({
    ...c,
    preRequest: swap(c.preRequest),
    tests: swap(c.tests),
    folders: (c.folders ?? []).map((f) => ({ ...f, preRequest: swap(f.preRequest), tests: swap(f.tests) })),
  }));

  const environments = state.environments.map((e) => {
    const variables: Record<string, string> = {};
    for (const [k, v] of Object.entries(e.variables)) variables[k] = swap(v) ?? v;
    return { ...e, variables };
  });
  const globals: Record<string, string> = {};
  for (const [k, v] of Object.entries(state.globals)) globals[k] = swap(v) ?? v;

  return { requests, collections, environments, globals };
}

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
  /** Lỗi lúc gửi request (mất kết nối / timeout) — hiển thị trong bảng Response, không persist */
  sendError: string | null;
  /** Kết quả tests của lần gửi gần nhất (không persist) */
  testRun: ScriptOutcome | null;
  sending: boolean;
  abortCurrentRequest: (() => void) | null;
  setAbortCurrentRequest: (fn: (() => void) | null) => void;

  addCollection: (name: string) => void;
  renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void;
  addDir: (name: string, parentId?: string | null) => void;
  renameDir: (id: string, name: string) => void;
  /** Xóa thư mục + toàn bộ thư mục con + collections/requests bên trong (UI confirm trước). */
  deleteDir: (id: string) => void;
  /** Chuyển thư mục vào thư mục khác (null = ra gốc). Tự chặn kéo vào chính nó/con của nó. */
  moveDir: (dirId: string, newParentId: string | null) => void;
  /** Chuyển collection vào thư mục (dirId null = ra ngoài). */
  moveCollection: (collectionId: string, dirId: string | null) => void;
  removeRequestFromCollection: (collectionId: string, requestId: string) => void;
  duplicateRequest: (collectionId: string, requestId: string) => void;
  renameRequest: (requestId: string, name: string) => void;
  addFolder: (collectionId: string, name: string, parentFolderId?: string) => void;
  renameFolder: (collectionId: string, folderId: string, name: string) => void;
  deleteFolder: (collectionId: string, folderId: string) => void;
  /** Script cấp collection (chạy trước/sau mọi request trong collection). */
  setCollectionScripts: (collectionId: string, patch: { preRequest?: string; tests?: string }) => void;
  /** Script cấp folder (kế thừa xuống request trong folder). */
  setFolderScripts: (collectionId: string, folderId: string, patch: { preRequest?: string; tests?: string }) => void;
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
  renameEnvVar: (envId: string, oldKey: string, newKey: string) => void;
  setEnvSecret: (envId: string, key: string, secret: boolean) => void;
  /** Thêm nhiều biến vào một môi trường cùng lượt (dùng cho trích biến hàng loạt) */
  addEnvVars: (envId: string, values: Record<string, string>, secretKeys?: string[]) => void;
  /** Thêm nhiều biến vào Globals (môi trường dùng chung) cùng lượt */
  addGlobals: (values: Record<string, string>, secretKeys?: string[]) => void;
  /** Ghi đè toàn bộ requests — dùng khi áp dụng/hoàn tác trích biến */
  setRequestsBulk: (next: Record<string, ApiRequest>) => void;
  /** Chụp lại nguyên trạng trước khi trích biến để hoàn tác 1 bước */
  restoreVarState: (snap: VarsSnapshot) => void;
  setGlobal: (key: string, value: string) => void;
  /** Đổi tên global và auto-sync mọi tham chiếu tới biến đó trong request/script */
  renameGlobal: (oldKey: string, newKey: string) => void;
  deleteGlobal: (key: string) => void;
  setGlobalSecret: (key: string, secret: boolean) => void;
  importEnvironments: (envs: import('../types/api').Environment[], globals: Record<string, string>) => void;
  pushHistory: (item: HistoryItem) => void;
  removeHistoryItem: (id: string) => void;
  clearHistory: () => void;
  setResponse: (r: ApiResponse | null) => void;
  /** Ghi lỗi gửi request vào bảng response (null = xóa) — giữ riêng theo tab như response */
  setSendError: (e: string | null) => void;
  setTestRun: (t: ScriptOutcome | null) => void;
  /** Response/tests của lần gửi gần nhất, giữ riêng theo từng request-tab (RAM, không persist) */
  respByTab: Record<string, { reqId: string; res: ApiResponse | null; err?: string | null }>;
  testsByTab: Record<string, { reqId: string; res: ScriptOutcome | null }>;
  /** Xóa dữ liệu các tab đã đóng */
  pruneTabs: (ids: string[]) => void;
  setSending: (v: boolean) => void;
  importDirs: (dirs: import('../types/api').Dir[]) => void;
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
  /** AI vừa ghi script thì app tự gửi 1 request để chứng minh script chạy được (mặc định BẬT) */
  aiAutoVerify: boolean;
  setAiAutoVerify: (v: boolean) => void;
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
  /** Prompt tạm thời gửi từ nút "✨ AI viết script" → AiAssistant nhận rồi xóa. */
  aiSeedPrompt: string | null;
  setAiSeedPrompt: (p: string | null) => void;
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
  aiAutoVerify: true,
  aiStats: {},
  aiChat: [],
  aiContents: [],
  aiSeedPrompt: null,
  history: [],
  response: null,
  sendError: null,
  testRun: null,
  respByTab: {},
  testsByTab: {},
  sending: false,
  abortCurrentRequest: null,

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

  addDir: (name, parentId) =>
    set((s) => ({ dirs: [...s.dirs, { id: uid('dir'), name, collectionIds: [], parentId: parentId ?? null }] })),

  renameDir: (id, name) =>
    set((s) => ({ dirs: s.dirs.map((d) => (d.id === id ? { ...d, name } : d)) })),

  deleteDir: (id) =>
    set((s) => {
      // Gom toàn bộ thư mục con (đệ quy) của id
      const doomedDirs = new Set<string>([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const d of s.dirs) {
          if (d.parentId && doomedDirs.has(d.parentId) && !doomedDirs.has(d.id)) {
            doomedDirs.add(d.id);
            grew = true;
          }
        }
      }
      // Collections nằm trong các thư mục bị xóa → xóa theo + requests của chúng
      const doomedCols = new Set<string>();
      for (const d of s.dirs) {
        if (doomedDirs.has(d.id)) {
          for (const cid of d.collectionIds) doomedCols.add(cid);
        }
      }
      const doomedReqs = new Set<string>();
      for (const c of s.collections) {
        if (doomedCols.has(c.id)) {
          for (const rid of c.rootRequestIds) doomedReqs.add(rid);
          for (const f of c.folders) for (const rid of f.requestIds) doomedReqs.add(rid);
        }
      }
      const requests = { ...s.requests };
      for (const rid of doomedReqs) delete requests[rid];
      return {
        dirs: s.dirs.filter((d) => !doomedDirs.has(d.id)),
        collections: s.collections.filter((c) => !doomedCols.has(c.id)),
        requests,
      };
    }),

  moveDir: (dirId, newParentId) =>
    set((s) => {
      if (dirId === newParentId) return s;
      // Chặn vòng lặp: không cho kéo vào chính nó hoặc con/cháu của nó
      if (newParentId) {
        const target = s.dirs.find((d) => d.id === newParentId);
        if (!target) return s;
        let p: string | null | undefined = target.parentId;
        const seen = new Set<string>([dirId, newParentId]);
        while (p) {
          if (p === dirId) return s;
          if (seen.has(p)) return s;
          seen.add(p);
          p = s.dirs.find((d) => d.id === p)?.parentId;
        }
      }
      return { dirs: s.dirs.map((d) => (d.id === dirId ? { ...d, parentId: newParentId } : d)) };
    }),

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

  addFolder: (collectionId, name, parentFolderId) =>
    set((s) => {
      const folder: Folder = { id: uid('fld'), name, requestIds: [], folderIds: [] };
      return {
        collections: s.collections.map((c) => {
          if (c.id !== collectionId) return c;
          const folders = [...c.folders, folder];
          // Folder con: ghi id vào folderIds của cha để cây render đúng cấp
          return {
            ...c,
            folders: parentFolderId
              ? folders.map((f) => (f.id === parentFolderId ? { ...f, folderIds: [...(f.folderIds ?? []), folder.id] } : f))
              : folders,
          };
        }),
      };
    }),

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
        
        // Helper: thu thập tất cả folder ID con (đệ quy)
        const collectFolderIds = (fid: string): string[] => {
          const folder = c.folders.find(f => f.id === fid);
          if (!folder || !folder.folderIds) return [];
          const childIds = [...folder.folderIds];
          for (const childId of folder.folderIds) {
            childIds.push(...collectFolderIds(childId));
          }
          return childIds;
        };
        
        const allDoomedIds = new Set([folderId, ...collectFolderIds(folderId)]);
        
        // Gom tất cả requests từ folder và nested folders
        const allRequestIds = new Set<string>();
        for (const f of c.folders) {
          if (allDoomedIds.has(f.id)) {
            for (const rid of f.requestIds) allRequestIds.add(rid);
          }
        }
        
        return {
          ...c,
          folders: c.folders.filter((f) => !allDoomedIds.has(f.id)),
          rootRequestIds: [...c.rootRequestIds, ...Array.from(allRequestIds)],
        };
      }),
    })),

  setCollectionScripts: (collectionId, patch) =>
    set((s) => ({
      collections: s.collections.map((c) => (c.id !== collectionId ? c : { ...c, ...patch })),
    })),

  setFolderScripts: (collectionId, folderId, patch) =>
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id !== collectionId
          ? c
          : { ...c, folders: c.folders.map((f) => (f.id === folderId ? { ...f, ...patch } : f)) },
      ),
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
    set((s) => {
      // Tên/giá trị dạng credential tự nhảy secret: giá trị không xuống đĩa (policy RAM-only).
      const secret = looksSecret(key, value);
      const cur = s.envSecrets[envId] ?? [];
      const nextSecrets =
        secret && !cur.includes(key)
          ? { ...s.envSecrets, [envId]: [...cur, key] }
          : s.envSecrets;
      return {
        environments: s.environments.map((e) =>
          e.id === envId ? { ...e, variables: { ...e.variables, [key]: value } } : e,
        ),
        envSecrets: nextSecrets,
      };
    }),

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

  renameEnvVar: (envId, oldKey, newKey) => {
    if (!newKey || newKey === oldKey) return;
    set((s) => {
      // 1. Copy giá trị và secret status sang key mới, xóa key cũ trong environment
      const environments = s.environments.map((e) => {
        if (e.id !== envId) return e;
        const oldValue = e.variables[oldKey] ?? '';
        const variables = { ...e.variables };
        delete variables[oldKey];
        variables[newKey] = oldValue;
        return { ...e, variables };
      });

      const envSecrets = { ...s.envSecrets };
      const wasSecret = (s.envSecrets[envId] ?? []).includes(oldKey);
      if (wasSecret) {
        envSecrets[envId] = (envSecrets[envId] ?? []).filter((k) => k !== oldKey);
        envSecrets[envId] = [...envSecrets[envId], newKey];
      }

      // 2. Auto-sync {{oldKey}} trong request đã lưu + script collection/folder + giá trị biến khác
      return { envSecrets, ...renameVarRefs(oldKey, newKey, { ...s, environments }) };
    });
    // 3. Tab đang mở là thứ người dùng nhìn thấy — đổi theo ngay, kể cả tab đang sửa dở
    useRequestStore.getState().renameVarInTabs(oldKey, newKey);
  },

  setEnvSecret: (envId, key, secret) =>
    set((s) => {
      const cur = s.envSecrets[envId] ?? [];
      const next = secret ? [...new Set([...cur, key])] : cur.filter((k) => k !== key);
      return { envSecrets: { ...s.envSecrets, [envId]: next } };
    }),

  addEnvVars: (envId, values, secretKeys = []) =>
    set((s) => ({
      environments: s.environments.map((e) =>
        e.id === envId ? { ...e, variables: { ...e.variables, ...values } } : e,
      ),
      envSecrets: {
        ...s.envSecrets,
        [envId]: [...new Set([...(s.envSecrets[envId] ?? []), ...secretKeys])],
      },
    })),

  setRequestsBulk: (next) => set({ requests: next }),

  addGlobals: (values, secretKeys = []) =>
    set((s) => ({
      globals: { ...s.globals, ...values },
      globalSecrets: [...new Set([...s.globalSecrets, ...secretKeys])],
    })),

  restoreVarState: (snap) =>
    set({
      requests: snap.requests,
      environments: snap.environments,
      envSecrets: snap.envSecrets,
      globals: snap.globals,
      globalSecrets: snap.globalSecrets,
    }),

  setGlobal: (key, value) =>
    set((s) => ({
      globals: { ...s.globals, [key]: value },
      globalSecrets:
        looksSecret(key, value) && !s.globalSecrets.includes(key)
          ? [...s.globalSecrets, key]
          : s.globalSecrets,
    })),

  renameGlobal: (oldKey, newKey) => {
    if (!newKey || newKey === oldKey) return;
    set((s) => {
      const globals = { ...s.globals };
      const oldValue = globals[oldKey] ?? '';
      delete globals[oldKey];
      globals[newKey] = oldValue;
      const globalSecrets = s.globalSecrets.includes(oldKey)
        ? [...new Set([...s.globalSecrets.filter((k) => k !== oldKey), newKey])]
        : s.globalSecrets;
      return { globalSecrets, ...renameVarRefs(oldKey, newKey, { ...s, globals }) };
    });
    useRequestStore.getState().renameVarInTabs(oldKey, newKey);
  },

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

  importEnvironments: (envs, newGlobals) =>
    set((s) => {
      const mergedEnvs = [...s.environments];
      for (const inc of envs) {
        const exist = mergedEnvs.findIndex((e) => e.name === inc.name);
        if (exist >= 0) {
          mergedEnvs[exist] = { ...mergedEnvs[exist], variables: { ...mergedEnvs[exist].variables, ...inc.variables } };
        } else {
          mergedEnvs.push({ ...inc, id: 'env_' + Date.now() + Math.random().toString(36).slice(2) });
        }
      }
      return {
        environments: mergedEnvs,
        globals: { ...s.globals, ...newGlobals },
      };
    }),

  pushHistory: (item) => set((s) => ({ history: [item, ...s.history].slice(0, 100) })),
  removeHistoryItem: (id) => set((s) => ({ history: s.history.filter((h) => h.id !== id) })),
  clearHistory: () => set({ history: [] }),
  setResponse: (r) =>
    set((s) => {
      const t = useRequestStore.getState();
      return {
        response: r,
        sendError: null,
        respByTab: { ...s.respByTab, [t.activeId]: { reqId: t.current.id, res: r, err: null } },
      };
    }),
  setSendError: (e) =>
    set((s) => {
      const t = useRequestStore.getState();
      const prev = s.respByTab[t.activeId];
      return {
        sendError: e,
        respByTab: {
          ...s.respByTab,
          [t.activeId]: { reqId: t.current.id, res: prev?.res ?? null, err: e },
        },
      };
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
  setAbortCurrentRequest: (fn) => set({ abortCurrentRequest: fn }),
  setAiKey: (k) => set({ aiKey: k }),
  setAiKeyBackup: (k) => set({ aiKeyBackup: k }),
  setAiModel: (m) => set({ aiModel: m || GEMINI_DEFAULT_MODEL }),
  setAiChain: (c) => set({ aiChain: c }),
  bumpAiRr: () => set((s) => ({ aiRrIndex: s.aiRrIndex + 1 })),
  setAiStrategy: (s) => set({ aiStrategy: s }),
  setAiAutoVerify: (v) => set({ aiAutoVerify: v }),
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
  setAiSeedPrompt: (p) => set({ aiSeedPrompt: p }),

  importDirs: (dirs) =>
    set((s) => ({ dirs: [...s.dirs, ...dirs] })),

  importData: (collection, reqs) =>
    set((s) => {
      const next: Record<string, ApiRequest> = { ...s.requests };
      for (const r of reqs) next[r.id] = { ...r, collectionId: collection.id };
      
      const collections = [...s.collections];
      const idx = collections.findIndex(c => c.id === collection.id);
      if (idx >= 0) {
        collections[idx] = collection;
      } else {
        collections.push(collection);
      }
      return { collections, requests: next };
    }),
    }),
    {
      name: 'postman-clone-app-v1',
      version: 5,
      // v2 -> v3: model mặc định đổi sang gemini-flash-lite-latest (nhanh nhất).
      // v3 -> v4: Dir thêm parentId (thư mục con lồng nhau), dữ liệu cũ mặc định về gốc (null).
      // v4 -> v5: Folder thêm folderIds (folder lồng nhau), dữ liệu cũ mặc định không có folder con.
      migrate: (s: any) => {
        if (s && s.aiModel === 'gemini-2.0-flash') s.aiModel = GEMINI_DEFAULT_MODEL;
        if (s && Array.isArray(s.dirs)) {
          s.dirs = s.dirs.map((d: any) => ({ ...d, parentId: d.parentId ?? null }));
        }
        if (s && Array.isArray(s.collections)) {
          s.collections = s.collections.map((c: any) => ({
            ...c,
            folders: (Array.isArray(c.folders) ? c.folders : []).map((f: any) => ({ ...f, folderIds: f.folderIds ?? [] })),
          }));
        }
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
          history: s.history.map((h) => {
            const safeRequest = stripRequestSecrets(h.request);
            if (!h.response) return { ...h, request: safeRequest };
            const safeHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(h.response.headers)) {
              if (/^(set-cookie|cookie|authorization|x-api-key|api-key)$/i.test(k)) continue;
              safeHeaders[k] = v;
            }
            // Body nhị phân (base64) không che nổi bằng regex -> chỉ giữ kích thước.
            const safeBody =
              h.response.bodyKind === 'binary' ? '' : maskSensitiveBody(h.response.body).slice(0, 20000);
            return { ...h, request: safeRequest, response: { ...h.response, headers: safeHeaders, body: safeBody } };
          }),
          aiKey: s.aiKey,
          aiKeyBackup: s.aiKeyBackup,
          aiModel: s.aiModel,
          aiChain: s.aiChain,
          aiRrIndex: s.aiRrIndex,
          aiStrategy: s.aiStrategy,
          aiAutoVerify: s.aiAutoVerify,
          aiStats: s.aiStats,
          aiChat: s.aiChat.slice(-100),
          aiContents: s.aiContents.slice(-30),
        };
      },
    },
  ),
);
