import { useState } from 'react';
import { useRequestStore } from '../stores/request';
import { useAppStore } from '../stores/app';
import KeyValueEditor from './KeyValueEditor';
import JsonBodyEditor from './JsonBodyEditor';
import ScriptCodeEditor from './ScriptCodeEditor';
import { PRE_REQUEST_SAMPLE, TESTS_SAMPLE } from '../lib/scripts';
import { inheritedScriptCount } from '../lib/script-chain';
import type { BodyType, AuthType } from '../types/api';

type Tab = 'params' | 'headers' | 'body' | 'auth' | 'pre' | 'tests';

const TABS: { id: Tab; label: string }[] = [
  { id: 'params', label: 'Params' },
  { id: 'headers', label: 'Headers' },
  { id: 'body', label: 'Body' },
  { id: 'auth', label: 'Auth' },
  { id: 'pre', label: 'Pre-request' },
  { id: 'tests', label: 'Tests' },
];

const BODY_TYPES: { id: BodyType; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'json', label: 'JSON' },
  { id: 'raw', label: 'Raw' },
  { id: 'form-data', label: 'Form-data' },
  { id: 'urlencoded', label: 'x-www-form-urlencoded' },
];

export default function RequestTabs() {
  const { current, set } = useRequestStore();
  const collections = useAppStore((s) => s.collections);
  const inherited = inheritedScriptCount(collections, current);
  const [tab, setTab] = useState<Tab>('params');
  const [fmtMsg, setFmtMsg] = useState('');

  const showBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(current.method);

  return (
    <div>
      <div className="flex gap-1 border-b border-slate-800 mb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-sm rounded-t ${
              tab === t.id
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
            {(t.id === 'pre' || t.id === 'tests') &&
              (t.id === 'pre' ? current.preRequest : current.tests)?.trim() && (
                <span className="ml-1 text-xs text-amber-400">●</span>
              )}
            {t.id === 'params' && current.params.length > 0 && (
              <span className="ml-1 text-xs text-emerald-400">({current.params.filter((p) => p.enabled).length})</span>
            )}
            {t.id === 'headers' && current.headers.length > 0 && (
              <span className="ml-1 text-xs text-emerald-400">({current.headers.filter((h) => h.enabled).length})</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'params' && (
        <div>
          <KeyValueEditor
            items={current.params}
            onChange={(params) => set({ params })}
            keyPlaceholder="param (vd: page)"
            valuePlaceholder="giá trị (vd: 1 hoặc {{userId}})"
          />
          <p className="text-xs text-slate-500 mt-2">
            Params được tự động nối vào URL khi gửi.
          </p>
        </div>
      )}

      {tab === 'headers' && (
        <KeyValueEditor
          items={current.headers}
          onChange={(headers) => set({ headers })}
          keyPlaceholder="Header (vd: Content-Type)"
          valuePlaceholder="giá trị (vd: application/json)"
        />
      )}

      {tab === 'body' && (
        <div className="flex flex-col gap-2">
          {!showBody && (
            <p className="text-xs text-amber-300">
              Method {current.method} thường không có body. Chuyển sang POST/PUT/PATCH/DELETE để dùng body.
            </p>
          )}
          <div className="flex gap-1.5 flex-wrap">
            {BODY_TYPES.map((b) => (
              <button
                key={b.id}
                onClick={() => set({ bodyType: b.id })}
                className={`px-2.5 py-1 rounded text-xs ${
                  current.bodyType === b.id
                    ? 'bg-emerald-600 font-semibold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {b.label}
              </button>
            ))}
            {current.bodyType === 'json' && (
              <button
                onClick={() => {
                  const r = formatJsonBody(current.body);
                  if (r.ok) {
                    set({ body: r.value });
                    setFmtMsg('');
                  } else {
                    setFmtMsg(r.error);
                  }
                }}
                title="Căn lề JSON cho đẹp (giữ nguyên {{biến}})"
                className="ml-auto px-2.5 py-1 rounded text-xs bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                ✨ Format JSON
              </button>
            )}
          </div>
          {current.bodyType === 'json' ? (
            <JsonBodyEditor
              value={current.body}
              onChange={(v) => set({ body: v })}
              placeholder={'{\n  "name": "test",\n  "userId": "{{userId}}"\n}'}
            />
          ) : current.bodyType === 'form-data' ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                  Mỗi dòng 1 cặp <code className="text-emerald-400">key=value</code> hoặc đính kèm file:{' '}
                  <code className="text-emerald-400">files=@D:/path/file.png</code>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const sample = 'files=@D:/test/image.png\nname=example';
                    set({ body: current.body ? current.body + '\n' + sample : sample });
                  }}
                  className="px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  + Mẫu file
                </button>
              </div>
              <textarea
                className="bg-slate-900 border border-slate-700 rounded p-2.5 font-mono text-sm min-h-32"
                rows={7}
                placeholder={'files=@"D:/test/image.png"\nuserId={{userId}}\ntitle=Báo cáo'}
                value={current.body}
                onChange={(e) => set({ body: e.target.value })}
              />
            </div>
          ) : current.bodyType !== 'none' && (
            <textarea
              className="bg-slate-900 border border-slate-700 rounded p-2.5 font-mono text-sm min-h-32"
              rows={7}
              placeholder={
                current.bodyType === 'urlencoded'
                  ? 'name=test&userId={{userId}}'
                  : 'Nội dung body... (hỗ trợ {{var}})'
              }
              value={current.body}
              onChange={(e) => set({ body: e.target.value })}
            />
          )}
          {current.bodyType === 'json' && current.body.trim() !== '' && (
            <JsonHint body={current.body} />
          )}
          {fmtMsg && <p className="text-xs text-red-400">{fmtMsg}</p>}
        </div>
      )}

      {tab === 'auth' && <AuthEditor />}

      {tab === 'pre' && (
        <div className="flex flex-col gap-1.5">
          {current.origin === 'imported' && (
            <p className="text-[11px] text-amber-300/90">
              ⚠ Request từ file import — chạy Flow/Runner sẽ hỏi xác nhận script. Bấm Lưu ở Builder = đánh dấu đã xem, lần sau không hỏi.
            </p>
          )}
          {inherited.pre > 0 && (
            <p className="text-[11px] text-sky-300/90">
              📜 {inherited.pre} script từ collection/folder cũng chạy trước script này.
            </p>
          )}
          <div className="flex items-center gap-2">
            <p className="text-xs text-slate-500">
              JS chạy <b>trước khi gửi</b>: dùng <code className="text-emerald-300">pm.environment.set/get</code>,{' '}
              <code className="text-emerald-300">pm.globals</code>, <code className="text-emerald-300">pm.variables.get</code>, sửa{' '}
              <code className="text-emerald-300">request.url/headers/body</code>.
            </p>
            <button
              onClick={() => set({ preRequest: PRE_REQUEST_SAMPLE })}
              className="ml-auto shrink-0 text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-1"
            >
              Chèn mẫu
            </button>
          </div>
          <ScriptCodeEditor
            rows={8}
            value={current.preRequest ?? ''}
            onChange={(v) => set({ preRequest: v })}
            placeholder="// pm.environment.set('ts', Date.now().toString());"
          />
        </div>
      )}

      {tab === 'tests' && (
        <div className="flex flex-col gap-1.5">
          {current.origin === 'imported' && (
            <p className="text-[11px] text-amber-300/90">
              ⚠ Request từ file import — chạy Flow/Runner sẽ hỏi xác nhận script. Bấm Lưu ở Builder = đánh dấu đã xem, lần sau không hỏi.
            </p>
          )}
          {inherited.tests > 0 && (
            <p className="text-[11px] text-sky-300/90">
              📜 {inherited.tests} script tests từ collection/folder cũng chạy sau script này.
            </p>
          )}
          <div className="flex items-center gap-2">
            <p className="text-xs text-slate-500">
              JS kiểm tra <b>response</b>: <code className="text-emerald-300">pm.test(name, fn)</code>,{' '}
              <code className="text-emerald-300">pm.expect(x).to.equal/eql/include/be.below...</code>,{' '}
              <code className="text-emerald-300">pm.response.status/json()/text()</code>.
            </p>
            <button
              onClick={() => set({ tests: TESTS_SAMPLE })}
              className="ml-auto shrink-0 text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-1"
            >
              Chèn mẫu
            </button>
          </div>
          <ScriptCodeEditor
            rows={8}
            value={current.tests ?? ''}
            onChange={(v) => set({ tests: v })}
            placeholder="// pm.test('Status 200', () => { pm.expect(pm.response.status).to.equal(200); });"
          />
        </div>
      )}
    </div>
  );
}

/** Căn lề JSON (2 spaces). {{biến}} được che lại khi parse rồi trả về đúng chỗ cũ. */
function formatJsonBody(body: string): { ok: true; value: string } | { ok: false; error: string } {
  const tokens: string[] = [];
  const mask = (m: string) => {
    tokens.push(m);
    return `"__REQX_VAR_${tokens.length - 1}__"`;
  };
  // "{{var}}" đã có ngoặc kép thì giữ nguyên cặp kép đó, {{var}} trần thì bọc kép để parse được
  const masked = body
    .replace(/"\{\{\s*[\w.-]+\s*\}\}"/g, mask)
    .replace(/\{\{\s*[\w.-]+\s*\}\}/g, mask);
  try {
    const pretty = JSON.stringify(JSON.parse(masked), null, 2);
    const restored = pretty.replace(/"__REQX_VAR_(\d+)__"/g, (_, i: string) => tokens[Number(i)] ?? '');
    return { ok: true, value: restored };
  } catch {
    return { ok: false, error: 'JSON sai cú pháp nên không format được — kiểm tra dấu ngoặc/dấu phẩy.' };
  }
}

function JsonHint({ body }: { body: string }) {  try {
    JSON.parse(body.replace(/\{\{\s*[\w.-]+\s*\}\}/g, '"__var__"'));
    return <p className="text-xs text-emerald-400">JSON hợp lệ ✓</p>;
  } catch {
    return <p className="text-xs text-red-400">JSON chưa hợp lệ — kiểm tra dấu ngoặc/dấu phẩy.</p>;
  }
}

function AuthEditor() {
  const { current, set } = useRequestStore();
  const auth = current.auth;
  const setAuth = (patch: Partial<typeof auth>) => set({ auth: { ...auth, ...patch } });

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      <div className="flex gap-1.5 flex-wrap">
        {(
          [
            ['none', 'No Auth'],
            ['bearer', 'Bearer Token'],
            ['basic', 'Basic Auth'],
            ['apikey', 'API Key'],
          ] as [AuthType, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setAuth({ type: id })}
            className={`px-2.5 py-1 rounded text-xs ${
              auth.type === id
                ? 'bg-emerald-600 font-semibold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {auth.type === 'none' && (
        <p className="text-xs text-slate-500">Không dùng xác thực.</p>
      )}

      {auth.type === 'bearer' && (
        <label className="flex flex-col gap-1 text-sm">
          Token
          <input
            type="password"
            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
            placeholder="eyJhbGciOi... hoặc {{token}}"
            value={auth.token ?? ''}
            onChange={(e) => setAuth({ token: e.target.value })}
          />
        </label>
      )}

      {auth.type === 'basic' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Username
            <input
              className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
              placeholder="admin hoặc {{username}}"
              value={auth.username ?? ''}
              onChange={(e) => setAuth({ username: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Password
            <input
              type="password"
              className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
              placeholder="••••••"
              value={auth.password ?? ''}
              onChange={(e) => setAuth({ password: e.target.value })}
            />
          </label>
        </div>
      )}

      {auth.type === 'apikey' && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Tên key
              <input
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="X-API-Key"
                value={auth.apiKeyName ?? ''}
                onChange={(e) => setAuth({ apiKeyName: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Gửi ở đâu
              <select
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5"
                value={auth.apiKeyIn ?? 'header'}
                onChange={(e) => setAuth({ apiKeyIn: e.target.value as 'header' | 'query' })}
              >
                <option value="header">Header</option>
                <option value="query">Query param</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Giá trị key
            <input
              type="password"
              className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
              placeholder="abc123 hoặc {{apiKey}}"
              value={auth.apiKey ?? ''}
              onChange={(e) => setAuth({ apiKey: e.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  );
}
