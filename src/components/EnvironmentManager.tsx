import { useMemo, useState } from 'react';
import { useAppStore } from '../stores/app';
import { useTranslation } from '../stores/language';
import { countVarRefs } from '../lib/variables';
import ExtractVarsDialog from './ExtractVarsDialog';

const ACCENT = {
  emerald: { ring: 'border-emerald-900/50', btn: 'bg-emerald-700 hover:bg-emerald-600', text: 'text-emerald-400' },
  sky: { ring: 'border-sky-900/50', btn: 'bg-sky-700 hover:bg-sky-600', text: 'text-sky-400' },
} as const;

/** Bảng biến (dùng chung cho biến môi trường và Globals): sửa giá trị, đổi tên có đồng bộ, secret, xóa, thêm mới. */
function VarTable({
  title,
  accent,
  hint,
  vars,
  secrets,
  onSet,
  onDelete,
  onRename,
  onToggleSecret,
  onAdd,
}: {
  title: React.ReactNode;
  accent: keyof typeof ACCENT;
  hint: string;
  vars: Record<string, string>;
  secrets: string[];
  onSet: (key: string, value: string) => void;
  onDelete: (key: string) => void;
  onRename: (oldKey: string, newKey: string) => void;
  onToggleSecret: (key: string, secret: boolean) => void;
  onAdd: (key: string, value: string) => void;
}) {
  const requests = useAppStore((s) => s.requests);
  const collections = useAppStore((s) => s.collections);
  const environments = useAppStore((s) => s.environments);
  const globals = useAppStore((s) => s.globals);
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const allKeys = useMemo(
    () => [...new Set([...Object.keys(vars), ...secrets])].sort((a, b) => a.localeCompare(b)),
    [vars, secrets],
  );
  const q = filter.trim().toLowerCase();
  const keys = q ? allKeys.filter((k) => k.toLowerCase().includes(q)) : allKeys;
  const refs = useMemo(() => {
    // Giá trị của biến khác cũng được đổi theo khi rename (vd baseUrl = http://{{domain}}/api)
    // nên tính vào "N nơi" — nếu không thì hộp thoại báo thiếu so với việc thực sự xảy ra.
    const otherVarValues = [
      ...environments.flatMap((e) => Object.values(e.variables)),
      ...Object.values(globals),
    ];
    const out: Record<string, number> = {};
    for (const k of allKeys) out[k] = countVarRefs(k, requests, collections, otherVarValues);
    return out;
  }, [allKeys, requests, collections, environments, globals]);

  function commitRename(oldKey: string) {
    const nk = editingName.trim();
    setEditingKey(null);
    if (!nk || nk === oldKey) return;
    const used = refs[oldKey] ?? 0;
    if (used > 0 && !confirm(t.env.renamePrompt.replace('{oldKey}', oldKey).replace('{newKey}', nk).replace('{used}', String(used)))) return;
    onRename(oldKey, nk);
  }

  function copyRef(k: string) {
    void navigator.clipboard.writeText(`{{${k}}}`);
    setCopied(k);
    setTimeout(() => setCopied((c) => (c === k ? null : c)), 1000);
  }

  function add() {
    const k = newKey.trim();
    if (!k) return;
    onAdd(k, newVal);
    setNewKey('');
    setNewVal('');
  }

  const a = ACCENT[accent];

  return (
    <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-800">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h3 className="text-lg font-bold">{title}</h3>
        <span className="text-xs text-slate-500">{allKeys.length} {t.env.varsCount}</span>
        <div className="flex-1" />
        {allKeys.length > 6 && (
          <input
            className="w-44 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs"
            placeholder={t.env.filterVars}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
      </div>
      <p className="text-xs text-slate-500 mb-3">{hint}</p>

      <div className="flex flex-col gap-2">
        {keys.map((k) => {
          const v = vars[k] ?? '';
          const isSecret = secrets.includes(k);
          const used = refs[k] ?? 0;
          return (
            <div key={k} className="flex gap-2 items-center">
              {editingKey === k ? (
                <input
                  autoFocus
                  className="w-1/3 font-mono text-sm bg-slate-900 border border-emerald-600 rounded px-2 py-1.5"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => commitRename(k)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(k);
                    if (e.key === 'Escape') setEditingKey(null);
                  }}
                />
              ) : (
                <button
                  onClick={() => copyRef(k)}
                  title={t.env.copyVar}
                  className={`w-1/3 font-mono text-sm text-left border border-slate-800 rounded px-2 py-1.5 truncate transition-colors ${
                    copied === k ? `${a.text} bg-slate-800` : 'bg-slate-950 hover:bg-slate-800'
                  }`}
                >
                  {copied === k ? t.common.copied : k}
                </button>
              )}
              <div className="relative flex-1">
                <input
                  type={visible[k] ? 'text' : 'password'}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 font-mono text-sm pr-8"
                  value={v}
                  placeholder={isSecret ? t.env.secretPlaceholder : t.env.valuePlaceholder}
                  onChange={(e) => onSet(k, e.target.value)}
                />
                <button
                  onClick={() => setVisible((p) => ({ ...p, [k]: !p[k] }))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  title={t.env.toggleSecret}
                >
                  {visible[k] ? '🙈' : '👁️'}
                </button>
              </div>
              <span
                className="w-8 shrink-0 text-right text-[11px] text-slate-500"
                title={used ? `${used} refs` : ''}
              >
                {used ? `${used}×` : ''}
              </span>
              <button
                onClick={() => onToggleSecret(k, !isSecret)}
                className={`px-2 py-1 rounded border ${isSecret ? 'bg-amber-900/30 border-amber-700 text-amber-400' : 'border-slate-700 text-slate-500 hover:text-slate-300'}`}
                title={isSecret ? 'Secret' : 'Public'}
              >
                {isSecret ? '🔒 Secret' : '🔓 Public'}
              </button>
              {editingKey !== k && (
                <button
                  onClick={() => { setEditingKey(k); setEditingName(k); }}
                  className="text-slate-400 hover:text-white px-2 py-1 border border-transparent hover:border-slate-600 rounded"
                  title={t.common.edit}
                >
                  ✎
                </button>
              )}
              <button
                onClick={() => { if (confirm(`${t.env.deleteVar} "${k}"?`)) onDelete(k); }}
                className="text-slate-400 hover:text-red-400 px-2 py-1 border border-transparent hover:border-red-900 rounded"
                title={t.env.deleteVar}
              >
                ✕
              </button>
            </div>
          );
        })}
        {allKeys.length > 6 && keys.length === 0 && (
          <p className="text-sm text-slate-500 italic">{t.env.noVars}</p>
        )}

        <div className="flex gap-2 mt-2 items-center">
          <input
            className={`w-1/3 bg-slate-950 border ${a.ring} rounded px-2 py-1.5 font-mono text-sm`}
            placeholder={t.env.keyInputPlaceholder}
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          />
          <input
            className={`flex-1 bg-slate-950 border ${a.ring} rounded px-2 py-1.5 font-mono text-sm`}
            placeholder={t.env.valueInputPlaceholder}
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          />
          <button
            onClick={add}
            disabled={!newKey.trim()}
            className={`${a.btn} font-bold rounded px-4 py-1.5 text-sm disabled:opacity-40`}
          >
            {t.env.add}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EnvironmentManager() {
  const {
    environments, activeEnvId, globals, envSecrets, globalSecrets,
    addEnvironment, renameEnvironment, deleteEnvironment, duplicateEnvironment,
    setActiveEnv, setEnvVar, deleteEnvVar, renameEnvVar, setEnvSecret,
    setGlobal, deleteGlobal, renameGlobal, setGlobalSecret,
  } = useAppStore();

  const [newEnv, setNewEnv] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  /** true = đang quản lý Globals ("môi trường" dùng chung), false = môi trường đang chọn */
  const [managingGlobals, setManagingGlobals] = useState(false);
  const [extract, setExtract] = useState(false);

  const active = environments.find((e) => e.id === activeEnvId);
  const globalCount = Object.keys(globals).length + globalSecrets.filter((k) => !(k in globals)).length;

  function commitRename(id: string) {
    const name = editingName.trim();
    if (name) renameEnvironment(id, name);
    setEditingId(null);
  }

  function exportEnvironments() {
    void (async () => {
      try {
        const state = useAppStore.getState();
        const envs = state.environments.map((e) => {
          const secrets = new Set(state.envSecrets[e.id] ?? []);
          const vars: Record<string, string> = {};
          for (const [k, v] of Object.entries(e.variables)) {
            if (!secrets.has(k)) vars[k] = v;
          }
          return { ...e, variables: vars };
        });

        const secretGlobals = new Set(state.globalSecrets ?? []);
        const globs: Record<string, string> = {};
        for (const [k, v] of Object.entries(state.globals)) {
          if (!secretGlobals.has(k)) globs[k] = v;
        }

        const data = { kind: 'reqx-env', environments: envs, globals: globs };
        const text = JSON.stringify(data, null, 2);

        const { saveExportBesideApp, revealExportedFile } = await import('../lib/response-file');
        const saved = await saveExportBesideApp('reqx-environments.json', text);
        if (saved) {
          await revealExportedFile(saved.path);
          alert(`Đã xuất thành công ra file:\n${saved.path}`);
        } else {
          const blob = new Blob([text], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'reqx-environments.json';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
          alert('Đã xuất thành công vào thư mục Downloads!');
        }
      } catch (err) {
        alert('Lỗi khi xuất: ' + (err instanceof Error ? err.message : err));
      }
    })();
  }

  function importEnvironments() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.kind !== 'reqx-env') throw new Error('File không đúng định dạng của ReqX Environment');
        useAppStore.getState().importEnvironments(data.environments || [], data.globals || {});
        alert('Đã nhập thành công các biến môi trường!');
      } catch (err) {
        alert('Lỗi nhập: ' + (err instanceof Error ? err.message : err));
      }
    };
    input.click();
  }

  const { t } = useTranslation();

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded p-4 overflow-auto">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">🌍 {t.env.manage}</h2>
        <div className="flex gap-2">
          <button onClick={() => setExtract(true)} className="text-sm px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 text-amber-400" title="Extract variables from requests">
            {t.env.extractVars}
          </button>
          <button onClick={importEnvironments} className="text-sm px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700" title="Import from JSON">
            {t.env.import}
          </button>
          <button onClick={exportEnvironments} className="text-sm px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 text-emerald-400" title="Export environments (public)">
            {t.env.export}
          </button>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Cột trái: Globals + danh sách môi trường */}
        <div className="w-1/3 min-w-[250px] border-r border-slate-800 pr-4 flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm"
              placeholder={t.env.newEnvPlaceholder}
              value={newEnv}
              onChange={(e) => setNewEnv(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newEnv.trim()) {
                  addEnvironment(newEnv.trim());
                  setNewEnv('');
                }
              }}
            />
            <button
              onClick={() => { if (newEnv.trim()) { addEnvironment(newEnv.trim()); setNewEnv(''); } }}
              className="bg-emerald-600 hover:bg-emerald-500 font-bold rounded px-3 text-sm"
            >
              {t.env.add}
            </button>
          </div>

          <div className="flex flex-col gap-1 overflow-auto flex-1">
            <div
              className={`flex items-center gap-1 rounded px-2 py-1.5 text-sm border border-slate-800 ${
                managingGlobals ? 'bg-slate-800' : 'hover:bg-slate-800/60'
              }`}
            >
              <button
                className="flex-1 text-left truncate flex items-center gap-2"
                title={t.env.globalsHint}
                onClick={() => setManagingGlobals(true)}
              >
                <span className={managingGlobals ? 'text-sky-400' : 'text-slate-500'}>{managingGlobals ? '●' : '○'}</span>
                {t.env.globalsTitle}
                <span className="text-slate-500 text-xs">({globalCount})</span>
              </button>
            </div>

            <p className="text-[11px] uppercase tracking-wide text-slate-600 mt-1">{t.env.environment}</p>
            {environments.map((e) => (
              <div
                key={e.id}
                className={`flex items-center gap-1 rounded px-2 py-1.5 text-sm ${
                  !managingGlobals && e.id === activeEnvId ? 'bg-slate-800' : 'hover:bg-slate-800/60'
                }`}
              >
                {editingId === e.id ? (
                  <input
                    autoFocus
                    className="flex-1 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5"
                    value={editingName}
                    onChange={(ev) => setEditingName(ev.target.value)}
                    onBlur={() => commitRename(e.id)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') commitRename(e.id);
                      if (ev.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <button
                    className="flex-1 text-left truncate flex items-center gap-2"
                    title={e.name}
                    onClick={() => { setActiveEnv(e.id); setManagingGlobals(false); }}
                  >
                    <span className={!managingGlobals && e.id === activeEnvId ? 'text-emerald-400' : 'text-slate-500'}>
                      {!managingGlobals && e.id === activeEnvId ? '●' : '○'}
                    </span>
                    {e.name}
                    <span className="text-slate-500 text-xs">({Object.keys(e.variables).length})</span>
                  </button>
                )}
                <button
                  title={t.env.renameEnv}
                  className="px-1 text-slate-400 hover:text-white"
                  onClick={() => { setEditingId(e.id); setEditingName(e.name); }}
                >
                  ✎
                </button>
                <button
                  title={t.env.duplicateEnv}
                  className="px-1 text-slate-400 hover:text-white"
                  onClick={() => duplicateEnvironment(e.id)}
                >
                  ⧉
                </button>
                <button
                  title={t.env.deleteEnv}
                  className="px-1 text-slate-400 hover:text-red-400"
                  onClick={() => {
                    if (confirm(t.env.deleteEnvConfirm.replace('{name}', e.name))) deleteEnvironment(e.id);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            {environments.length === 0 && (
              <p className="text-sm text-slate-500 italic mt-2 text-center">{t.env.noEnvs}</p>
            )}
          </div>
        </div>

        {/* Cột phải: bảng biến của mục đang chọn ở cột trái */}
        <div className="flex-1">
          {managingGlobals ? (
            <VarTable
              accent="sky"
              title={<span><span className="text-sky-400">{t.env.globals}</span></span>}
              hint={t.env.globalsHint}
              vars={globals}
              secrets={globalSecrets}
              onSet={setGlobal}
              onDelete={deleteGlobal}
              onRename={renameGlobal}
              onToggleSecret={setGlobalSecret}
              onAdd={(k, v) => setGlobal(k, v)}
            />
          ) : active ? (
            <VarTable
              accent="emerald"
              title={<span>{t.env.environment}: <span className="text-emerald-400">{active.name}</span></span>}
              hint={t.env.envHint}
              vars={active.variables}
              secrets={envSecrets[active.id] ?? []}
              onSet={(k, v) => setEnvVar(active.id, k, v)}
              onDelete={(k) => deleteEnvVar(active.id, k)}
              onRename={(oldK, newK) => renameEnvVar(active.id, oldK, newK)}
              onToggleSecret={(k, secret) => setEnvSecret(active.id, k, secret)}
              onAdd={(k, v) => setEnvVar(active.id, k, v)}
            />
          ) : (
            <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-800 flex items-center justify-center min-h-[150px]">
              <p className="text-slate-500">{t.env.selectEnvPrompt}</p>
            </div>
          )}
        </div>
      </div>

      {extract && <ExtractVarsDialog onClose={() => setExtract(false)} />}
    </div>
  );
}
