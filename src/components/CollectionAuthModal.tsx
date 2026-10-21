import { useEffect, useMemo, useState } from 'react';
import AuthFields from './AuthFields';
import { useAppStore, type VarsSnapshot } from '../stores/app';
import { useRequestStore } from '../stores/request';
import { describeAuth } from '../lib/auth-chain';
import type { ApiRequest, AuthConfig, AuthType, Collection } from '../types/api';
import { useTranslation } from '../stores/language';

const CHIPS: [AuthType, string][] = [
  ['none', 'No Auth'],
  ['bearer', 'Bearer Token'],
  ['basic', 'Basic Auth'],
  ['apikey', 'API Key'],
  ['oauth2', 'OAuth 2.0'],
  ['digest', 'Digest'],
  ['awsv4', 'AWS SigV4'],
  ['ntlm', 'NTLM'],
];

/** Mọi request nằm trong collection (root + mọi folder, đã flatten). */
function requestsOf(col: Collection, all: Record<string, ApiRequest>): ApiRequest[] {
  const ids = [...col.rootRequestIds, ...col.folders.flatMap((f) => f.requestIds ?? [])];
  return ids.map((id) => all[id]).filter(Boolean);
}

/**
 * Đặt auth cho collection. Auth này chỉ đi theo request chọn "Kế thừa collection" —
 * request đặt kiểu cụ thể (hoặc No Auth) vẫn giữ nguyên, nên bảng duyệt dưới đây liệt kê
 * đúng những request bị ảnh hưởng TRƯỚC khi ghi hàng loạt, kèm 1 bước hoàn tác.
 */
export default function CollectionAuthModal({ collection, onClose }: { collection: Collection; onClose: () => void }) {
  const { t: i18n } = useTranslation();
  const {
    setCollectionAuth, requests, environments, activeEnvId, globals, envSecrets, globalSecrets,
    setRequestsBulk, restoreVarState,
  } = useAppStore();

  const [draft, setDraft] = useState<AuthConfig>(collection.auth ?? { type: 'none' });
  const [pending, setPending] = useState<Set<string> | null>(null);
  /** Bản chụp trước khi ghi hàng loạt — có là hiện nút Hoàn tác (1 bước). */
  const [applied, setApplied] = useState<{ snapshot: VarsSnapshot; prevAuth: AuthConfig } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const activeEnv = environments.find((e) => e.id === activeEnvId);
  const activeSec = new Set(activeEnv ? envSecrets[activeEnv.id] ?? [] : []);
  const gSec = new Set(globalSecrets ?? []);
  const hasVar = (name: string) => {
    if (!name) return false;
    if (activeEnv && (activeEnv.variables[name] !== undefined || activeSec.has(name))) return true;
    if (globals[name] !== undefined || gSec.has(name)) return true;
    return environments.some((e) => name in e.variables || (envSecrets[e.id] ?? []).includes(name));
  };

  const own = useMemo(() => requestsOf(collection, requests), [collection, requests]);
  const inheriting = own.filter((r) => r.auth.type === 'inherit');
  // Chỉ request "No Auth" mới cần hỏi — request đã đặt kiểu riêng không bị auth collection che
  const blocking = own.filter((r) => r.auth.type === 'none');
  const selected = pending ?? new Set(blocking.map((r) => r.id));
  const dirty = JSON.stringify(draft) !== JSON.stringify(collection.auth ?? { type: 'none' });
  const patch = (p: Partial<AuthConfig>) => setDraft((d) => ({ ...d, ...p }));
  const draftLabel = draft.type === 'none' ? 'No Auth' : describeAuth(draft);

  const apply = () => {
    const snapshot: VarsSnapshot = { requests, environments, envSecrets, globalSecrets, globals };
    const prevAuth = collection.auth ?? { type: 'none' };
    setCollectionAuth(collection.id, draft);
    if (draft.type !== 'none' && selected.size > 0) {
      const next = { ...requests };
      for (const r of blocking) {
        if (selected.has(r.id)) next[r.id] = { ...r, auth: { type: 'inherit' } };
      }
      setRequestsBulk(next);
      // Tab đang mở nhìn thấy bản mới (tab đang sửa dở thì refreshTabs tự bỏ qua, không đè công chưa lưu)
      useRequestStore.getState().refreshTabs(next);
    }
    setApplied({ snapshot, prevAuth });
  };

  const undo = () => {
    if (!applied) return;
    setCollectionAuth(collection.id, applied.prevAuth);
    restoreVarState(applied.snapshot);
    setApplied(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-slate-900 border border-slate-700 rounded-lg shadow-2xl">
        <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-slate-800">
          <div>
            <h3 className="font-bold">🔑 {i18n.request.authCollectionTitle} — {collection.name}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{i18n.request.authCollectionDesc}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white px-2" title="Đóng (Esc)">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          <div className="flex gap-1.5 flex-wrap">
            {CHIPS.map(([id, label]) => (
              <button
                key={id}
                onClick={() => patch({ type: id })}
                className={`px-2.5 py-1 rounded text-xs ${
                  draft.type === id ? 'bg-emerald-600 font-semibold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <AuthFields auth={draft} onPatch={patch} hasVar={hasVar} />

          <div className="text-xs border border-slate-700/70 rounded px-3 py-2 flex flex-col gap-2">
            <p className="text-slate-300">
              Auth mọi request kế thừa sẽ gửi: <span className="text-emerald-300 font-medium">{draftLabel}</span>
            </p>
            <p className="text-slate-400">Đang kế thừa: <b>{inheriting.length}</b>/{own.length} request trong collection.</p>

            {draft.type !== 'none' && blocking.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-amber-300">
                  {blocking.length} request đang đặt “No Auth” — bỏ tích request nào bạn MUỐN giữ nguyên No Auth:
                </p>
                <div className="max-h-40 overflow-y-auto border border-slate-700/60 rounded divide-y divide-slate-800">
                  {blocking.map((r) => (
                    <label key={r.id} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-800/60 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() =>
                          setPending((prev) => {
                            const s = new Set(prev ?? blocking.map((x) => x.id));
                            if (s.has(r.id)) s.delete(r.id);
                            else s.add(r.id);
                            return s;
                          })
                        }
                      />
                      <span className="font-mono text-[10px] text-slate-500 w-12 shrink-0">{r.method}</span>
                      <span className="truncate">{r.name}</span>
                      <span className="text-slate-600 truncate ml-auto text-[10px]">{r.url}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {draft.type !== 'none' && blocking.length === 0 && own.length > 0 && (
              <p className="text-slate-500">
                Không có request “No Auth” nào cần chuyển — các request khác đã tự đặt auth riêng.
              </p>
            )}
            {own.length === 0 && <p className="text-slate-500">Collection này chưa có request nào.</p>}

            {applied && (
              <div className="flex items-center gap-2 border-t border-slate-700/70 pt-2">
                <span className="text-emerald-300">✓ Đã lưu{selected.size ? ` + chuyển ${selected.size} request sang kế thừa` : ''}.</span>
                <button
                  onClick={undo}
                  className="ml-auto text-xs px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800"
                >
                  ↩ Hoàn tác
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 px-4 pb-3">
          {collection.auth && collection.auth.type !== 'none' && (
            <button
              onClick={() => patch({ type: 'none' })}
              className="text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-400 hover:bg-slate-800"
            >
              {i18n.request.authCollectionClear}
            </button>
          )}
          <span className="flex-1" />
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border border-slate-700 hover:bg-slate-800">
            {applied ? i18n.common.close : i18n.common.cancel}
          </button>
          <button
            onClick={apply}
            disabled={!dirty}
            className="text-sm px-4 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 font-bold disabled:opacity-40"
          >
            {i18n.request.authCollectionSave}
          </button>
        </div>
      </div>
    </div>
  );
}
