import { useState } from 'react';
import { useRequestStore, activeSubTab, type ReqSubTab } from '../stores/request';
import { useAppStore } from '../stores/app';
import KeyValueEditor from './KeyValueEditor';
import JsonBodyEditor from './JsonBodyEditor';
import ScriptCodeEditor from './ScriptCodeEditor';
import BinaryBodyEditor from './BinaryBodyEditor';
import OAuth2Editor from './OAuth2Editor';
import { PRE_REQUEST_SAMPLE, TESTS_SAMPLE } from '../lib/scripts';
import { inheritedScriptCount } from '../lib/script-chain';
import { useTranslation } from '../stores/language';
import type { BodyType, AuthType } from '../types/api';

const TABS: ReqSubTab[] = ['params', 'headers', 'body', 'pre', 'tests', 'auth'];

const BODY_TYPES: { id: BodyType; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'json', label: 'JSON' },
  { id: 'raw', label: 'Raw' },
  { id: 'form-data', label: 'Form-data' },
  { id: 'urlencoded', label: 'x-www-form-urlencoded' },
  { id: 'binary', label: 'Binary' },
];

export default function RequestTabs() {
  const { t: i18n } = useTranslation();
  const { current, set } = useRequestStore();
  const collections = useAppStore((s) => s.collections);
  const inherited = inheritedScriptCount(collections, current);
  // Bảng con đang mở là của RIÊNG tab này — đổi request khác không bị nhảy theo
  const tab = useRequestStore(activeSubTab);
  const setTab = useRequestStore((s) => s.setSubTab);
  const [fmtMsg, setFmtMsg] = useState('');

  const tabLabels: Record<ReqSubTab, string> = {
    params: i18n.request.params,
    headers: i18n.request.headers,
    body: i18n.request.body,
    pre: i18n.request.preScript,
    tests: i18n.request.tests,
    auth: 'Auth',
  };

  const showBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(current.method);

  return (
    <div>
      <div className="flex gap-4 border-b border-slate-800 mb-3 px-1">
        {TABS.map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`text-xs transition-all ${
              tab === id
                ? 'border-b-2 border-emerald-400 text-emerald-300 font-semibold pb-2 shadow-[0_2px_8px_rgba(16,185,129,0.25)]'
                : 'border-b-2 border-transparent text-slate-400 hover:text-slate-200 pb-2'
            }`}
          >
            {tabLabels[id]}
            {(id === 'pre' || id === 'tests') &&
              (id === 'pre' ? current.preRequest : current.tests)?.trim() && (
                <span className="ml-1 text-[10px] text-amber-400">●</span>
              )}
            {id === 'params' && current.params.length > 0 && (
              <span className="ml-1 text-[11px] text-emerald-400">({current.params.filter((p) => p.enabled).length})</span>
            )}
            {id === 'headers' && current.headers.length > 0 && (
              <span className="ml-1 text-[11px] text-emerald-400">({current.headers.filter((h) => h.enabled).length})</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'params' && (
        <div>
          <KeyValueEditor
            items={current.params}
            onChange={(params) => set({ params })}
            keyPlaceholder={i18n.request.paramKeyPlaceholder}
            valuePlaceholder={i18n.request.paramValuePlaceholder}
          />
          <p className="text-xs text-slate-500 mt-2">
            {i18n.request.paramsHelp}
          </p>
        </div>
      )}

      {tab === 'headers' && (
        <KeyValueEditor
          items={current.headers}
          onChange={(headers) => set({ headers })}
          keyPlaceholder={i18n.request.headerKeyPlaceholder}
          valuePlaceholder={i18n.request.headerValuePlaceholder}
        />
      )}

      {tab === 'body' && (
        <div className="flex flex-col gap-2">
          {!showBody && (
            <p className="text-xs text-amber-300">
              {i18n.request.noBodyWarning.replace('{method}', current.method)}
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
                  const r = formatJsonBody(current.body, i18n.request.jsonFormatError);
                  if (r.ok) {
                    set({ body: r.value });
                    setFmtMsg('');
                  } else {
                    setFmtMsg(r.error);
                  }
                }}
                title={i18n.request.formatJsonTitle}
                className="ml-auto px-2.5 py-1 rounded text-xs bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                {i18n.request.formatJsonBtn}
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
                  {i18n.request.formDataHelp}{' '}
                  <code className="text-emerald-400">key=value</code> /{' '}
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
                  {i18n.request.fileSampleBtn}
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
          ) : current.bodyType === 'binary' ? (
            <BinaryBodyEditor
              value={current.body}
              onChange={(v) => set({ body: v })}
            />
          ) : current.bodyType !== 'none' && (
            <textarea
              className="bg-slate-900 border border-slate-700 rounded p-2.5 font-mono text-sm min-h-32"
              rows={7}
              placeholder={
                current.bodyType === 'urlencoded'
                  ? 'name=test&userId={{userId}}'
                  : i18n.request.bodyContentPlaceholder
              }
              value={current.body}
              onChange={(e) => set({ body: e.target.value })}
            />
          )}
          {current.bodyType === 'json' && current.body.trim() !== '' && (
            <JsonHint body={current.body} validMsg={i18n.request.jsonValid} invalidMsg={i18n.request.jsonInvalid} />
          )}
          {fmtMsg && <p className="text-xs text-red-400">{fmtMsg}</p>}
        </div>
      )}

      {tab === 'auth' && <AuthEditor />}

      {tab === 'pre' && (
        <div className="flex flex-col gap-1.5">
          {current.origin === 'imported' && (
            <p className="text-[11px] text-amber-300/90">
              {i18n.request.importedScriptWarn}
            </p>
          )}
          {inherited.pre > 0 && (
            <p className="text-[11px] text-sky-300/90">
              {i18n.request.inheritedScriptPre.replace('{count}', String(inherited.pre))}
            </p>
          )}
          <div className="flex items-center gap-2">
            <p className="text-xs text-slate-500">
              {i18n.request.preScriptHelp}
            </p>
            <button
              onClick={() => set({ preRequest: PRE_REQUEST_SAMPLE })}
              className="ml-auto shrink-0 text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-1"
            >
              {i18n.request.insertSample}
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
              {i18n.request.importedScriptWarn}
            </p>
          )}
          {inherited.tests > 0 && (
            <p className="text-[11px] text-sky-300/90">
              {i18n.request.inheritedScriptTests.replace('{count}', String(inherited.tests))}
            </p>
          )}
          <div className="flex items-center gap-2">
            <p className="text-xs text-slate-500">
              {i18n.request.testsScriptHelp}
            </p>
            <button
              onClick={() => set({ tests: TESTS_SAMPLE })}
              className="ml-auto shrink-0 text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-1"
            >
              {i18n.request.insertSample}
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
function formatJsonBody(body: string, defaultError: string): { ok: true; value: string } | { ok: false; error: string } {
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
    return { ok: false, error: defaultError };
  }
}

function JsonHint({ body, validMsg, invalidMsg }: { body: string; validMsg: string; invalidMsg: string }) {
  try {
    JSON.parse(body.replace(/\{\{\s*[\w.-]+\s*\}\}/g, '"__var__"'));
    return <p className="text-xs text-emerald-400">{validMsg}</p>;
  } catch {
    return <p className="text-xs text-red-400">{invalidMsg}</p>;
  }
}

function AuthEditor() {
  const { t: i18n } = useTranslation();
  const { current, set } = useRequestStore();
  const auth = current.auth;
  const setAuth = (patch: Partial<typeof auth>) => set({ auth: { ...auth, ...patch } });

  const oauth2 = auth.oauth2 ?? {};
  const setOAuth2 = (patch: Partial<typeof oauth2>) =>
    set({ auth: { ...auth, oauth2: { ...oauth2, ...patch } } });

  const digest = auth.digest ?? {};
  const setDigest = (patch: Partial<typeof digest>) =>
    set({ auth: { ...auth, digest: { ...digest, ...patch } } });

  const awsv4 = auth.awsv4 ?? {};
  const setAwsV4 = (patch: Partial<typeof awsv4>) =>
    set({ auth: { ...auth, awsv4: { ...awsv4, ...patch } } });

  const ntlm = auth.ntlm ?? {};
  const setNtlm = (patch: Partial<typeof ntlm>) =>
    set({ auth: { ...auth, ntlm: { ...ntlm, ...patch } } });

  return (
    <div className="flex flex-col gap-2.5 max-w-2xl">
      <div className="flex gap-1.5 flex-wrap">
        {(
          [
            ['none', 'No Auth'],
            ['bearer', 'Bearer Token'],
            ['basic', 'Basic Auth'],
            ['apikey', 'API Key'],
            ['oauth2', 'OAuth 2.0'],
            ['digest', 'Digest'],
            ['awsv4', 'AWS SigV4'],
            ['ntlm', 'NTLM'],
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
        <p className="text-xs text-slate-500">{i18n.request.noAuth}</p>
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
              {i18n.request.authKeyName}
              <input
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="X-API-Key"
                value={auth.apiKeyName ?? ''}
                onChange={(e) => setAuth({ apiKeyName: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {i18n.request.authWhere}
              <select
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5"
                value={auth.apiKeyIn ?? 'header'}
                onChange={(e) => setAuth({ apiKeyIn: e.target.value as 'header' | 'query' })}
              >
                <option value="header">{i18n.request.authHeader}</option>
                <option value="query">{i18n.request.authQueryParam}</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            {i18n.request.authKeyVal}
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

      {auth.type === 'oauth2' && (
        <OAuth2Editor oauth2={oauth2} onChange={setOAuth2} />
      )}

      {auth.type === 'digest' && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Username
              <input
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="admin"
                value={digest.username ?? ''}
                onChange={(e) => setDigest({ username: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Password
              <input
                type="password"
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="••••••"
                value={digest.password ?? ''}
                onChange={(e) => setDigest({ password: e.target.value })}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Realm
              <input
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="me@kennethreitz.com"
                value={digest.realm ?? ''}
                onChange={(e) => setDigest({ realm: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Nonce
              <input
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="nonce từ 401 challenge"
                value={digest.nonce ?? ''}
                onChange={(e) => setDigest({ nonce: e.target.value })}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Algorithm
              <select
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5"
                value={digest.algorithm ?? 'MD5'}
                onChange={(e) => setDigest({ algorithm: e.target.value as 'MD5' | 'SHA-256' })}
              >
                <option value="MD5">MD5</option>
                <option value="SHA-256">SHA-256</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              QoP
              <select
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5"
                value={digest.qop ?? 'auth'}
                onChange={(e) => setDigest({ qop: e.target.value as 'auth' | 'none' })}
              >
                <option value="auth">auth</option>
                <option value="none">none</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {auth.type === 'awsv4' && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Access Key ID
              <input
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="AKIA..."
                value={awsv4.accessKey ?? ''}
                onChange={(e) => setAwsV4({ accessKey: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Secret Access Key
              <input
                type="password"
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="••••••"
                value={awsv4.secretKey ?? ''}
                onChange={(e) => setAwsV4({ secretKey: e.target.value })}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              AWS Region
              <input
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="us-east-1 hoặc ap-southeast-1"
                value={awsv4.region ?? ''}
                onChange={(e) => setAwsV4({ region: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Service Name
              <input
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="s3, execute-api, dynamodb..."
                value={awsv4.service ?? ''}
                onChange={(e) => setAwsV4({ service: e.target.value })}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Session Token (Optional)
            <input
              type="password"
              className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
              placeholder="Dành cho temporary credentials / STS"
              value={awsv4.sessionToken ?? ''}
              onChange={(e) => setAwsV4({ sessionToken: e.target.value })}
            />
          </label>
        </div>
      )}

      {auth.type === 'ntlm' && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Username
              <input
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="DOMAIN\user hoặc user"
                value={ntlm.username ?? ''}
                onChange={(e) => setNtlm({ username: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Password
              <input
                type="password"
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="••••••"
                value={ntlm.password ?? ''}
                onChange={(e) => setNtlm({ password: e.target.value })}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Domain (Optional)
              <input
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="WORKGROUP hoặc CORP"
                value={ntlm.domain ?? ''}
                onChange={(e) => setNtlm({ domain: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Workstation (Optional)
              <input
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="CLIENT-PC"
                value={ntlm.workstation ?? ''}
                onChange={(e) => setNtlm({ workstation: e.target.value })}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
