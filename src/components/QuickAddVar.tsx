import { useState } from 'react';
import { useAppStore } from '../stores/app';
import { looksSecret } from '../lib/secrets';
import { useTranslation } from '../stores/language';

/** Giá trị đặc biệt cho ô "Lưu vào" khi người dùng chọn Globals thay vì một môi trường. */
export const GLOBALS_TARGET = '__globals__';

/**
 * Form tạo nhanh một biến `{{ten}}` còn thiếu, ngay tại dải lỗi của RequestBar.
 * Tên hiển thị cố định: request đang tham chiếu đúng tên đó, sửa tên ở đây thì
 * biến mới tạo vẫn thiếu với request.
 */
export default function QuickAddVar({
  name,
  onCancel,
  onDone,
}: {
  name: string;
  onCancel: () => void;
  onDone: (msg: string) => void;
}) {
  const { t: i18n } = useTranslation();
  const environments = useAppStore((s) => s.environments);
  const activeEnvId = useAppStore((s) => s.activeEnvId);
  const addEnvVars = useAppStore((s) => s.addEnvVars);
  const addGlobals = useAppStore((s) => s.addGlobals);

  const [target, setTarget] = useState(activeEnvId ?? GLOBALS_TARGET);
  const [value, setValue] = useState('');
  const [secret, setSecret] = useState(() => looksSecret(name, ''));
  const [err, setErr] = useState('');

  const targetName =
    target === GLOBALS_TARGET ? i18n.env.globalsTitle : environments.find((e) => e.id === target)?.name ?? '';
  const dup = target !== GLOBALS_TARGET && name in (environments.find((e) => e.id === target)?.variables ?? {});

  function submit() {
    const v = value.trim();
    if (!v) {
      setErr(i18n.request.varAddNeedValue);
      return;
    }
    if (dup) {
      setErr(i18n.request.varAddExists.replace('{key}', name).replace('{target}', targetName));
      return;
    }
    // addEnvVars/addGlobals không tự dò secret như setEnvVar — tự chốt ở đây
    // để tên dạng token/secret không bao giờ xuống đĩa, kể cả khi user bỏ tick.
    const isSecret = secret || looksSecret(name, v);
    const keys = isSecret ? [name] : [];
    if (target === GLOBALS_TARGET) addGlobals({ [name]: v }, keys);
    else addEnvVars(target, { [name]: v }, keys);
    onDone(i18n.request.varAddDone.replace('{key}', name).replace('{target}', targetName));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs bg-slate-900/70 border border-slate-700 rounded px-2 py-1.5">
      <code className="font-mono text-amber-200">{`{{${name}}}`}</code>
      <input
        autoFocus
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (err) setErr('');
        }}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder={i18n.env.valueInputPlaceholder}
        className="flex-1 min-w-[160px] bg-slate-800 border border-slate-700 rounded px-2 py-1 font-mono"
      />
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        title={i18n.request.varAddTargetLabel}
        className="bg-slate-800 border border-slate-700 rounded px-1.5 py-1"
      >
        {environments.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
        <option value={GLOBALS_TARGET}>{i18n.env.globalsTitle}</option>
      </select>
      <label className="flex items-center gap-1 text-slate-300" title={i18n.request.varAddSecretTitle}>
        <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
        {i18n.request.varAddSecretLabel}
      </label>
      <button onClick={submit} className="bg-emerald-700 hover:bg-emerald-600 rounded px-2.5 py-1 font-semibold shrink-0">
        {i18n.env.add}
      </button>
      <button onClick={onCancel} className="bg-slate-800 hover:bg-slate-700 rounded px-2.5 py-1 shrink-0">
        {i18n.common.cancel}
      </button>
      {err && <span className="text-red-400 w-full">{err}</span>}
    </div>
  );
}
