import OAuth2Editor from './OAuth2Editor';
import VarHighlightInput from './VarHighlightInput';
import type { AuthConfig } from '../types/api';
import { useTranslation } from '../stores/language';

/**
 * Các ô nhập theo từng kiểu auth (bearer/basic/apikey/oauth2/digest/awsv4/ntlm).
 * Tách khỏi tab request để collection dùng lại đúng form này —
 * auth đặt ở collection thì mọi request "Kế thừa" gửi theo (xem lib/auth-chain.ts).
 */
export default function AuthFields({
  auth,
  onPatch,
  hasVar,
}: {
  auth: AuthConfig;
  onPatch: (patch: Partial<AuthConfig>) => void;
  hasVar: (name: string) => boolean;
}) {
  const { t: i18n } = useTranslation();

  const oauth2 = auth.oauth2 ?? {};
  const digest = auth.digest ?? {};
  const awsv4 = auth.awsv4 ?? {};
  const ntlm = auth.ntlm ?? {};

  return (
    <>
      {auth.type === 'bearer' && (
        <label className="flex flex-col gap-1 text-sm">
          Token
          <div className="bg-slate-900 border border-slate-700 rounded focus-within:border-emerald-500 transition-colors">
            <VarHighlightInput
              value={auth.token ?? ''}
              onChange={(v) => onPatch({ token: v })}
              placeholder="eyJhbGciOi... hoặc {{token}}"
              hasVar={hasVar}
            />
          </div>
        </label>
      )}

      {auth.type === 'basic' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Username
            <div className="bg-slate-900 border border-slate-700 rounded focus-within:border-emerald-500 transition-colors">
              <VarHighlightInput
                value={auth.username ?? ''}
                onChange={(v) => onPatch({ username: v })}
                placeholder="admin hoặc {{username}}"
                hasVar={hasVar}
              />
            </div>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Password
            <div className="bg-slate-900 border border-slate-700 rounded focus-within:border-emerald-500 transition-colors">
              <VarHighlightInput
                value={auth.password ?? ''}
                onChange={(v) => onPatch({ password: v })}
                placeholder="•••••• hoặc {{password}}"
                hasVar={hasVar}
              />
            </div>
          </label>
        </div>
      )}

      {auth.type === 'apikey' && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              {i18n.request.authKeyName}
              <div className="bg-slate-900 border border-slate-700 rounded focus-within:border-emerald-500 transition-colors">
                <VarHighlightInput
                  value={auth.apiKeyName ?? ''}
                  onChange={(v) => onPatch({ apiKeyName: v })}
                  placeholder="X-API-Key"
                  hasVar={hasVar}
                />
              </div>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {i18n.request.authWhere}
              <select
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5"
                value={auth.apiKeyIn ?? 'header'}
                onChange={(e) => onPatch({ apiKeyIn: e.target.value as 'header' | 'query' })}
              >
                <option value="header">{i18n.request.authHeader}</option>
                <option value="query">{i18n.request.authQueryParam}</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            {i18n.request.authKeyVal}
            <div className="bg-slate-900 border border-slate-700 rounded focus-within:border-emerald-500 transition-colors">
              <VarHighlightInput
                value={auth.apiKey ?? ''}
                onChange={(v) => onPatch({ apiKey: v })}
                placeholder="abc123 hoặc {{apiKey}}"
                hasVar={hasVar}
              />
            </div>
          </label>
        </div>
      )}

      {auth.type === 'oauth2' && (
        <OAuth2Editor oauth2={oauth2} onChange={(patch) => onPatch({ oauth2: { ...oauth2, ...patch } })} />
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
                onChange={(e) => onPatch({ digest: { ...digest, username: e.target.value } })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Password
              <input
                type="password"
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="••••••"
                value={digest.password ?? ''}
                onChange={(e) => onPatch({ digest: { ...digest, password: e.target.value } })}
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
                onChange={(e) => onPatch({ digest: { ...digest, realm: e.target.value } })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Nonce
              <input
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="nonce từ 401 challenge"
                value={digest.nonce ?? ''}
                onChange={(e) => onPatch({ digest: { ...digest, nonce: e.target.value } })}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Algorithm
              <select
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5"
                value={digest.algorithm ?? 'MD5'}
                onChange={(e) => onPatch({ digest: { ...digest, algorithm: e.target.value as 'MD5' | 'SHA-256' } })}
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
                onChange={(e) => onPatch({ digest: { ...digest, qop: e.target.value as 'auth' | 'none' } })}
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
                onChange={(e) => onPatch({ awsv4: { ...awsv4, accessKey: e.target.value } })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Secret Access Key
              <input
                type="password"
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="••••••"
                value={awsv4.secretKey ?? ''}
                onChange={(e) => onPatch({ awsv4: { ...awsv4, secretKey: e.target.value } })}
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
                onChange={(e) => onPatch({ awsv4: { ...awsv4, region: e.target.value } })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Service Name
              <input
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="s3, execute-api, dynamodb..."
                value={awsv4.service ?? ''}
                onChange={(e) => onPatch({ awsv4: { ...awsv4, service: e.target.value } })}
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
              onChange={(e) => onPatch({ awsv4: { ...awsv4, sessionToken: e.target.value } })}
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
                onChange={(e) => onPatch({ ntlm: { ...ntlm, username: e.target.value } })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Password
              <input
                type="password"
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="••••••"
                value={ntlm.password ?? ''}
                onChange={(e) => onPatch({ ntlm: { ...ntlm, password: e.target.value } })}
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
                onChange={(e) => onPatch({ ntlm: { ...ntlm, domain: e.target.value } })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Workstation (Optional)
              <input
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono"
                placeholder="CLIENT-PC"
                value={ntlm.workstation ?? ''}
                onChange={(e) => onPatch({ ntlm: { ...ntlm, workstation: e.target.value } })}
              />
            </label>
          </div>
        </div>
      )}
    </>
  );
}
