import { useEffect, useRef, useState } from 'react';
import { useRequestStore } from '../stores/request';
import { useAppStore } from '../stores/app';
import { useTranslation } from '../stores/language';

/**
 * Nút ✨ "Nhờ AI viết script" — form 3 ô cho ca phổ biến nhất của QA/BA:
 * pre-request lấy token OAuth2 (client_credentials). Điền URL + tên biến, app
 * tự ghép prompt (kèm request đang mở + tên biến env/global đang có) rồi mở tab AI.
 * Giá trị secret KHÔNG nằm trong prompt — chỉ truyền TÊN biến để AI tham chiếu {{ten}}.
 */
export default function AiScriptButton({ className = '' }: { className?: string }) {
  const { lang } = useTranslation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = useRequestStore((s) => s.current);
  const environments = useAppStore((s) => s.environments);
  const activeEnvId = useAppStore((s) => s.activeEnvId);
  const globals = useAppStore((s) => s.globals);
  const envSecrets = useAppStore((s) => s.envSecrets);
  const globalSecrets = useAppStore((s) => s.globalSecrets);

  const [tokenUrl, setTokenUrl] = useState('');
  const [clientIdVar, setClientIdVar] = useState('');
  const [targetVar, setTargetVar] = useState('accessToken');

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const env = environments.find((e) => e.id === activeEnvId);
  const envVarNames = env ? Object.keys(env.variables) : [];
  const envSecretNames = activeEnvId ? envSecrets[activeEnvId] ?? [] : [];
  const globalNames = Object.keys(globals);
  // Gom tên biến (env thường + env secret + global thường + global secret) — KHÔNG truyền giá trị
  const allVarNames = [...new Set([...envVarNames, ...envSecretNames, ...globalNames, ...globalSecrets])].sort();

  const ask = () => {
    const vi = lang !== 'en';
    const lines: string[] = [];
    lines.push(
      vi
        ? `Viết giúp pre-request script lấy token OAuth2 cho request đang mở "${current.name}" (${current.method} ${current.url}).`
        : `Write a pre-request script that fetches an OAuth2 token for the currently open request "${current.name}" (${current.method} ${current.url}).`,
    );
    lines.push(vi ? 'Nhiệm vụ: grant_type=client_credentials, gửi pm.sendRequest rồi lưu token.' : 'Task: grant_type=client_credentials via pm.sendRequest, then save the token.');
    if (tokenUrl.trim()) lines.push(vi ? `Token URL: ${tokenUrl.trim()}` : `Token URL: ${tokenUrl.trim()}`);
    if (clientIdVar.trim()) lines.push(vi ? `client_id nằm trong biến {{${clientIdVar.trim()}}}` : `client_id is in variable {{${clientIdVar.trim()}}}`);
    if (targetVar.trim()) lines.push(vi ? `Lưu access token vào biến ${targetVar.trim()}` : `Save access_token into variable ${targetVar.trim()}`);
    lines.push(
      vi
        ? 'Nếu thiếu client_secret thì HỎI LẠI tên biến, đừng bịa. Chỉ dùng API có trong SANDBOX ReqX (pm.sendRequest, pm.environment.set, pm.variables).*'
        : 'If client_secret is missing, ASK me which variable holds it — do not invent. Only use ReqX sandbox APIs (pm.sendRequest, pm.environment.set, pm.variables).*',
    );
    lines.push(
      vi
        ? `Biến khả dụng ở env "${env?.name ?? '(no env)'}" + globals: ${allVarNames.slice(0, 40).join(', ') || '(không có)'}.`
        : `Variables available in env "${env?.name ?? '(no env)'}" + globals: ${allVarNames.slice(0, 40).join(', ') || '(none)'}.`,
    );
    lines.push(
      vi
        ? 'Sau khi viết xong, gọi update_current_request với field pre_request để chèn thẳng, rồi gửi thử bằng send_request để tự kiểm chứng.'
        : 'After writing, call update_current_request with the pre_request field, then send_request once to self-verify.',
    );
    useAppStore.getState().setAiSeedPrompt(lines.join('\n'));
    setOpen(false);
  };

  return (
    <div ref={box} className={`relative shrink-0 ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={lang === 'en' ? 'Ask AI to write a script for the current request' : 'Nhờ AI viết script cho request đang mở'}
        className="text-xs bg-fuchsia-900/40 hover:bg-fuchsia-800/60 text-fuchsia-200 border border-fuchsia-500/40 rounded px-2 py-1"
      >
        ✨ {lang === 'en' ? 'Ask AI' : 'Nhờ AI'} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="absolute z-40 right-0 mt-1 w-[380px] max-w-[80vw] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-3 flex flex-col gap-2">
          <p className="text-[11px] text-slate-400">
            {lang === 'en'
              ? 'Fill what you know — AI gets the open request + env name + variable list as context. Only NAMES are sent, never secret values.'
              : 'Điền gì biết nấy — AI sẽ nhận request đang mở + tên env + danh sách TÊN biến làm ngữ cảnh. Chỉ gửi TÊN, không gửi giá trị secret.'}
          </p>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            {lang === 'en' ? 'Token URL' : 'Token URL'}
            <input
              value={tokenUrl}
              onChange={(e) => setTokenUrl(e.target.value)}
              placeholder={lang === 'en' ? 'https://auth.example.com/oauth/token' : 'https://auth.example.com/oauth/token'}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 outline-none focus:border-fuchsia-500 font-mono"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            {lang === 'en' ? 'Variable holding client_id' : 'Biến chứa client_id'}
            <input
              value={clientIdVar}
              onChange={(e) => setClientIdVar(e.target.value)}
              list="ai-script-vars"
              placeholder="clientId"
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 outline-none focus:border-fuchsia-500 font-mono"
            />
            <datalist id="ai-script-vars">
              {allVarNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            {lang === 'en' ? 'Save access_token into variable' : 'Lưu access_token vào biến'}
            <input
              value={targetVar}
              onChange={(e) => setTargetVar(e.target.value)}
              list="ai-script-vars"
              placeholder="accessToken"
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 outline-none focus:border-fuchsia-500 font-mono"
            />
          </label>
          <div className="flex justify-end gap-2 mt-1">
            <button onClick={() => setOpen(false)} className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1">
              {lang === 'en' ? 'Cancel' : 'Hủy'}
            </button>
            <button
              onClick={ask}
              disabled={!tokenUrl.trim() && !clientIdVar.trim() && !targetVar.trim()}
              className="text-xs bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded px-3 py-1"
            >
              {lang === 'en' ? 'Send to AI' : 'Gửi cho AI'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
