import { useState } from 'react';
import { useAppStore } from '../stores/app';

export default function EnvironmentManager() {
  const {
    environments, activeEnvId, globals, envSecrets, globalSecrets,
    addEnvironment, renameEnvironment, deleteEnvironment, duplicateEnvironment,
    setActiveEnv, setEnvVar, deleteEnvVar, setEnvSecret,
    setGlobal, deleteGlobal, setGlobalSecret,
  } = useAppStore();

  const [open, setOpen] = useState(false);
  const [newEnv, setNewEnv] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [gKey, setGKey] = useState('');
  const [gVal, setGVal] = useState('');

  const active = environments.find((e) => e.id === activeEnvId);

  function commitRename(id: string) {
    const name = editingName.trim();
    if (name) renameEnvironment(id, name);
    setEditingId(null);
  }

  function addVar() {
    if (!active || !newKey.trim()) return;
    setEnvVar(active.id, newKey.trim(), newVal);
    setNewKey('');
    setNewVal('');
  }

  function addGlobal() {
    if (!gKey.trim()) return;
    setGlobal(gKey.trim(), gVal);
    setGKey('');
    setGVal('');
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <h3 className="font-semibold">Môi trường</h3>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-1"
        >
          {open ? 'Đóng' : 'Quản lý'}
        </button>
      </div>

      <select
        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5"
        value={activeEnvId ?? ''}
        onChange={(e) => setActiveEnv(e.target.value || null)}
      >
        {environments.length === 0 && <option value="">(chưa có môi trường)</option>}
        {environments.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>

      {!open && (
        <div className="mt-1 text-xs text-slate-400">
          {active
            ? Object.entries(active.variables).map(([k, v]) => (
                <div key={k} className="font-mono truncate">{k} = {v}</div>
              ))
            : <span className="text-slate-500">Chưa chọn môi trường.</span>}
        </div>
      )}

      {open && (
        <div className="mt-2 border border-slate-800 rounded p-2 space-y-3">
          <div className="flex gap-2">
            <input
              className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs"
              placeholder="Tên môi trường mới (vd: Staging)..."
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
              className="bg-sky-600 hover:bg-sky-500 rounded px-2 text-xs"
            >
              Thêm
            </button>
          </div>

          <div className="space-y-1">
            {environments.map((e) => (
              <div
                key={e.id}
                className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs ${
                  e.id === activeEnvId ? 'bg-slate-800' : 'hover:bg-slate-800/60'
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
                    className="flex-1 text-left truncate"
                    title="Đặt làm môi trường đang dùng"
                    onClick={() => setActiveEnv(e.id)}
                  >
                    {e.id === activeEnvId ? '● ' : '○ '}{e.name}
                    <span className="text-slate-500"> ({Object.keys(e.variables).length})</span>
                  </button>
                )}
                <button
                  title="Đổi tên"
                  className="px-1 text-slate-400 hover:text-white"
                  onClick={() => { setEditingId(e.id); setEditingName(e.name); }}
                >
                  ✎
                </button>
                <button
                  title="Nhân bản"
                  className="px-1 text-slate-400 hover:text-white"
                  onClick={() => duplicateEnvironment(e.id)}
                >
                  ⧉
                </button>
                <button
                  title="Xóa"
                  className="px-1 text-slate-400 hover:text-red-300"
                  onClick={() => {
                    if (confirm(`Xóa môi trường "${e.name}"?`)) deleteEnvironment(e.id);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {active && (
            <div>
              <p className="text-xs font-semibold mb-1">
                Biến của <span className="text-emerald-300">{active.name}</span>
              </p>
              <p className="text-[11px] text-slate-500 mb-1">
                Tick 🔒 = secret: che khi hiển thị, chỉ giữ trong RAM, reload là mất.
              </p>
              {[...new Set([...Object.keys(active.variables), ...(envSecrets[active.id] ?? [])])].map((k) => {
                const v = active.variables[k] ?? '';
                const isSecret = (envSecrets[active.id] ?? []).includes(k);
                return (
                <div key={k} className="flex gap-1 mb-1 items-center">
                  <span className="flex-1 font-mono text-xs bg-slate-900 rounded px-1.5 py-1 truncate" title={k}>{k}</span>
                  <input
                    type={isSecret ? 'password' : 'text'}
                    className="flex-[2] bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-xs"
                    value={v}
                    placeholder={isSecret ? '(secret — chỉ phiên này)' : undefined}
                    onChange={(e) => setEnvVar(active.id, k, e.target.value)}
                  />
                  <button
                    onClick={() => setEnvSecret(active.id, k, !isSecret)}
                    className={`px-1 ${isSecret ? 'text-amber-300' : 'text-slate-500 hover:text-white'}`}
                    title={isSecret ? 'Bỏ đánh dấu secret' : 'Đánh dấu secret (không lưu localStorage)'}
                  >
                    {isSecret ? '🔒' : '🔓'}
                  </button>
                  <button
                    onClick={() => deleteEnvVar(active.id, k)}
                    className="text-slate-400 hover:text-red-300 px-1"
                    title="Xóa biến"
                  >
                    ✕
                  </button>
                </div>
                );
              })}
              <div className="flex gap-1">
                <input
                  className="flex-1 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-xs"
                  placeholder="key"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                />
                <input
                  className="flex-[2] bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-xs"
                  placeholder="value"
                  value={newVal}
                  onChange={(e) => setNewVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addVar(); }}
                />
                <button onClick={addVar} className="bg-slate-700 hover:bg-slate-600 rounded px-2 text-xs">
                  +
                </button>
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold mb-1">Globals (dùng chung mọi môi trường)</p>
            {[...new Set([...Object.keys(globals), ...globalSecrets])].map((k) => {
              const v = globals[k] ?? '';
              const isSecret = globalSecrets.includes(k);
              return (
              <div key={k} className="flex gap-1 mb-1 items-center">
                <span className="flex-1 font-mono text-xs bg-slate-900 rounded px-1.5 py-1 truncate" title={k}>{k}</span>
                <input
                  type={isSecret ? 'password' : 'text'}
                  className="flex-[2] bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-xs"
                  value={v}
                  placeholder={isSecret ? '(secret — chỉ phiên này)' : undefined}
                  onChange={(e) => setGlobal(k, e.target.value)}
                />
                <button
                  onClick={() => setGlobalSecret(k, !isSecret)}
                  className={`px-1 ${isSecret ? 'text-amber-300' : 'text-slate-500 hover:text-white'}`}
                  title={isSecret ? 'Bỏ đánh dấu secret' : 'Đánh dấu secret (không lưu localStorage)'}
                >
                  {isSecret ? '🔒' : '🔓'}
                </button>
                <button
                  onClick={() => deleteGlobal(k)}
                  className="text-slate-400 hover:text-red-300 px-1"
                  title="Xóa global"
                >
                  ✕
                </button>
              </div>
              );
            })}
            <div className="flex gap-1">
              <input
                className="flex-1 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-xs"
                placeholder="key"
                value={gKey}
                onChange={(e) => setGKey(e.target.value)}
              />
              <input
                className="flex-[2] bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-xs"
                placeholder="value"
                value={gVal}
                onChange={(e) => setGVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addGlobal(); }}
              />
              <button onClick={addGlobal} className="bg-slate-700 hover:bg-slate-600 rounded px-2 text-xs">
                +
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
