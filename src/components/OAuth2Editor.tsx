import { useState, useEffect } from 'react';
import type { OAuth2Config } from '../types/api';
import { useAppStore } from '../stores/app';
import { useTranslation } from '../stores/language';
import {
  fetchOAuth2Token,
  generatePkcePair,
  buildAuthorizationUrl,
  parseCallbackUrl,
  getTokenExpiryStatus,
} from '../lib/oauth2';
import {
  getOAuth2SessionInfo,
  ERROR_COOLDOWN_MS,
  type OAuth2SessionInfo,
} from '../lib/oauth2-refresh';

interface OAuth2EditorProps {
  oauth2: OAuth2Config;
  onChange: (patch: Partial<OAuth2Config>) => void;
}

function formatAgo(ms: number, isVi: boolean): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return isVi ? `${s}s trước` : `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return isVi ? `${m} phút trước` : `${m}m ago`;
  return isVi ? `${Math.floor(m / 60)} giờ trước` : `${Math.floor(m / 60)}h ago`;
}

function formatLeft(sec: number, isVi: boolean): string {
  if (sec <= 0) return isVi ? 'đã hết hạn' : 'expired';
  if (sec < 60) return isVi ? `${sec}s` : `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return isVi ? `${m} phút` : `${m}m`;
  return isVi ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
}

export default function OAuth2Editor({ oauth2, onChange }: OAuth2EditorProps) {
  const { lang, t } = useTranslation();
  const { environments, activeEnvId, globals, setEnvVar } = useAppStore();

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  /** URL ủy quyền đã sinh — hiển thị để người dùng tự mở khi webview chặn cửa sổ mới */
  const [pendingAuthUrl, setPendingAuthUrl] = useState<string | null>(null);

  // Lấy các biến môi trường và globals hiện hành
  const activeEnv = environments.find((e) => e.id === activeEnvId);
  const envVars = activeEnv?.variables ?? {};

  const grantType = oauth2.grantType ?? 'client_credentials';
  const expiry = getTokenExpiryStatus(oauth2);

  // Tình trạng auto-refresh trong phiên (RAM) — cập nhật định kỳ vì thời gian trôi
  const [session, setSession] = useState<OAuth2SessionInfo | null>(null);
  useEffect(() => {
    const sync = () => setSession(getOAuth2SessionInfo(oauth2, envVars, globals));
    sync();
    const timer = setInterval(sync, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauth2, activeEnvId, globals]);

  // Tự động clear success message sau 4s
  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  // Xử lý lấy Token mới
  const handleGetToken = async () => {
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const result = await fetchOAuth2Token(oauth2, envVars, globals);

      const patch: Partial<OAuth2Config> = {
        accessToken: result.accessToken,
        token: result.accessToken,
        refreshToken: result.refreshToken ?? oauth2.refreshToken,
        expiresIn: result.expiresIn,
        tokenType: result.tokenType,
        issuedAt: result.issuedAt,
        scope: result.scope ?? oauth2.scope,
      };

      onChange(patch);

      // Tự động lưu vào biến môi trường nếu user cấu hình
      const varName = oauth2.autoSaveVar?.trim();
      if (varName && activeEnvId) {
        setEnvVar(activeEnvId, varName, result.accessToken);
      }

      setSuccessMsg(
        lang === 'vi'
          ? `Lấy Token thành công! ${result.expiresIn ? `(Hết hạn sau ${result.expiresIn}s)` : ''}`
          : `Token acquired successfully! ${result.expiresIn ? `(Expires in ${result.expiresIn}s)` : ''}`
      );
    } catch (err: any) {
      setErrorMsg(err.message || (lang === 'vi' ? 'Không lấy được Token' : 'Failed to acquire token'));
    } finally {
      setLoading(false);
    }
  };

  // Làm mới Token (Refresh Token)
  const handleRefreshToken = async () => {
    if (!oauth2.refreshToken) return;
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const refreshConfig: OAuth2Config = {
        ...oauth2,
        grantType: 'refresh_token',
      };
      const result = await fetchOAuth2Token(refreshConfig, envVars, globals);

      const patch: Partial<OAuth2Config> = {
        accessToken: result.accessToken,
        token: result.accessToken,
        refreshToken: result.refreshToken ?? oauth2.refreshToken,
        expiresIn: result.expiresIn,
        tokenType: result.tokenType,
        issuedAt: result.issuedAt,
      };

      onChange(patch);

      const varName = oauth2.autoSaveVar?.trim();
      if (varName && activeEnvId) {
        setEnvVar(activeEnvId, varName, result.accessToken);
      }

      setSuccessMsg(lang === 'vi' ? 'Đã làm mới Token thành công!' : 'Token refreshed successfully!');
    } catch (err: any) {
      setErrorMsg(err.message || (lang === 'vi' ? 'Làm mới Token thất bại' : 'Refresh failed'));
    } finally {
      setLoading(false);
    }
  };

  // Tạo mã PKCE
  const handleGeneratePkce = async () => {
    try {
      const { codeVerifier, codeChallenge } = await generatePkcePair();
      onChange({ codeVerifier, codeChallenge });
      setSuccessMsg(lang === 'vi' ? 'Đã sinh cặp khóa PKCE mới (S256)' : 'Generated new PKCE pair (S256)');
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  // Xử lý dán URL chuyển hướng / callback
  const handleCallbackInput = (val: string) => {
    const parsed = parseCallbackUrl(val);
    if (parsed.error) {
      setErrorMsg(parsed.error);
    } else if (parsed.code) {
      onChange({ code: parsed.code });
      // Không in authorization code ra màn hình: nó là credential, tránh lộ qua ảnh chụp màn hình/log
      setSuccessMsg(lang === 'vi' ? 'Đã trích Code từ URL callback' : 'Extracted code from callback URL');
    } else if (parsed.accessToken) {
      onChange({ accessToken: parsed.accessToken, token: parsed.accessToken });
      setSuccessMsg(lang === 'vi' ? 'Đã trích Access Token từ URL callback' : 'Extracted Access Token from URL');
    } else {
      onChange({ code: val });
    }
  };

  // Mở trang đăng nhập ủy quyền
  const handleOpenAuthUrl = async () => {
    const url = buildAuthorizationUrl(oauth2, envVars, globals);
    if (!url) {
      setErrorMsg(lang === 'vi' ? 'Vui lòng nhập Auth URL trước' : 'Please provide Auth URL first');
      return;
    }
    setPendingAuthUrl(url);
    // Tauri webview chặn window.open (không có plugin opener) -> luôn copy để dán, và hiển thị URL
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard bị chặn (http không phải localhost) — người dùng vẫn thấy URL bên dưới */
    }
    const win = window.open(url, '_blank');
    if (!win) {
      setSuccessMsg(
        lang === 'vi'
          ? 'Đã sao chép URL ủy quyền. Mở trình duyệt rồi dán URL vào, sau đó dán lại URL callback ở dưới.'
          : 'Authorization URL copied. Open it in your browser, then paste the callback URL below.',
      );
    }
  };

  // Copy token
  const handleCopyToken = () => {
    const t = oauth2.accessToken || oauth2.token || '';
    if (t) {
      navigator.clipboard.writeText(t);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-xs">
      {/* 1. Header Bar: Grant Type + Client Auth + Prefix */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 bg-slate-900/50 p-2.5 rounded border border-slate-800">
        <label className="flex flex-col gap-1">
          <span className="text-slate-400 font-medium">
            Grant Type <span className="text-amber-400">*</span>
          </span>
          <select
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-sky-300 font-medium focus:border-sky-500"
            value={grantType}
            onChange={(e) => onChange({ grantType: e.target.value as any })}
          >
            <option value="client_credentials">Client Credentials (Máy chủ - Máy chủ)</option>
            <option value="password">Password Credentials (Username / Mật khẩu)</option>
            <option value="authorization_code">Authorization Code (Đăng nhập / OAuth2)</option>
            <option value="refresh_token">Refresh Token (Làm mới Token)</option>
            <option value="implicit">Implicit Flow (Frontend thuần)</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-slate-400 font-medium">Header Prefix</span>
          <input
            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-xs focus:border-sky-500"
            placeholder="Bearer"
            value={oauth2.headerPrefix ?? 'Bearer'}
            onChange={(e) => onChange({ headerPrefix: e.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-slate-400 font-medium">Add Token To</span>
          <select
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs focus:border-sky-500"
            value={oauth2.addTokenTo ?? 'header'}
            onChange={(e) => onChange({ addTokenTo: e.target.value as 'header' | 'query' })}
          >
            <option value="header">Request Headers (Authorization)</option>
            <option value="query">Query Params (?access_token=...)</option>
          </select>
        </label>
      </div>

      {/* 2. Cấu hình chi tiết theo từng Grant Type */}
      <div className="flex flex-col gap-2.5 bg-slate-900/30 p-2.5 rounded border border-slate-800/80">
        {/* Token URL */}
        {grantType !== 'implicit' && (
          <label className="flex flex-col gap-1">
            <div className="flex justify-between items-center text-slate-400">
              <span className="font-medium">
                Access Token URL <span className="text-amber-400">*</span>
              </span>
              <span className="text-[10px] text-slate-500">Hỗ trợ biến {'{{baseUrl}}'}</span>
            </div>
            <input
              className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-xs text-emerald-300 focus:border-sky-500"
              placeholder="https://auth.example.com/oauth/token hoặc {{tokenUrl}}"
              value={oauth2.tokenUrl ?? ''}
              onChange={(e) => onChange({ tokenUrl: e.target.value })}
            />
          </label>
        )}

        {/* Auth URL & Redirect URI cho Authorization Code & Implicit */}
        {(grantType === 'authorization_code' || grantType === 'implicit') && (
          <div className="flex flex-col gap-2 border-b border-slate-800 pb-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-slate-400 font-medium">Auth URL (Authorization Endpoint)</span>
                <input
                  className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-xs focus:border-sky-500"
                  placeholder="https://auth.example.com/oauth/authorize"
                  value={oauth2.authUrl ?? ''}
                  onChange={(e) => onChange({ authUrl: e.target.value })}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-slate-400 font-medium">Callback / Redirect URI</span>
                <input
                  className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-xs focus:border-sky-500"
                  placeholder="http://localhost:8080/callback hoặc https://app.example.com"
                  value={oauth2.redirectUri ?? ''}
                  onChange={(e) => onChange({ redirectUri: e.target.value })}
                />
              </label>
            </div>

            {/* Nút hành động PKCE & Mở trình duyệt */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleOpenAuthUrl}
                className="bg-sky-700 hover:bg-sky-600 text-white rounded px-3 py-1 font-medium transition-colors flex items-center gap-1.5"
              >
                <span>🔗</span>
                <span>{lang === 'vi' ? 'Mở trang đăng nhập (Authorize)' : 'Open Authorize Page'}</span>
              </button>

              <button
                type="button"
                onClick={handleGeneratePkce}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 rounded px-2.5 py-1 transition-colors flex items-center gap-1"
                title="Proof Key for Code Exchange (RFC 7636)"
              >
                <span>🔐</span>
                <span>{oauth2.codeVerifier ? 'Tạo lại PKCE' : 'Bật PKCE (S256)'}</span>
              </button>

              {oauth2.codeVerifier && (
                <span className="text-[11px] text-emerald-400 font-mono">
                  PKCE Challenge: {oauth2.codeChallenge?.slice(0, 12)}…
                </span>
              )}
            </div>

            {pendingAuthUrl && (
              <div className="flex flex-col gap-1 bg-slate-950/70 border border-sky-800/50 rounded p-2">
                <span className="text-[11px] text-sky-300">
                  {lang === 'vi'
                    ? 'URL ủy quyền (đã sao chép) — dán vào trình duyệt nếu cửa sổ mới không mở:'
                    : 'Authorization URL (copied) — paste it in a browser if no window opened:'}
                </span>
                <div className="flex items-center gap-1.5">
                  <input
                    readOnly
                    value={pendingAuthUrl}
                    onFocus={(e) => e.target.select()}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono text-[11px] text-slate-300 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(pendingAuthUrl)}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 rounded px-2 py-1 text-[11px] transition-colors"
                  >
                    {lang === 'vi' ? 'Copy' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            {/* Input nhận Code / Callback URL */}
            <label className="flex flex-col gap-1 pt-1">
              <div className="flex justify-between items-center text-slate-400">
                <span className="font-medium text-amber-300">
                  {grantType === 'implicit' ? 'Callback URL / Token' : 'Authorization Code hoặc Dán link redirect'}
                </span>
                <span className="text-[10px] text-slate-500">Tự trích code khi dán cả link</span>
              </div>
              <input
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-xs text-amber-200 focus:border-sky-500"
                placeholder={
                  grantType === 'implicit'
                    ? 'Dán callback URL chứa #access_token=...'
                    : 'Nhập code hoặc dán link callback vd: http://localhost:8080/?code=xyz'
                }
                value={oauth2.code ?? ''}
                onChange={(e) => handleCallbackInput(e.target.value)}
              />
            </label>
          </div>
        )}

        {/* Client ID & Client Secret */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-slate-400 font-medium">
              Client ID <span className="text-amber-400">*</span>
            </span>
            <input
              className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-xs focus:border-sky-500"
              placeholder="my-client-id hoặc {{clientId}}"
              value={oauth2.clientId ?? ''}
              onChange={(e) => onChange({ clientId: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between items-center text-slate-400">
              <span className="font-medium">Client Secret</span>
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="text-[10px] text-sky-400 hover:text-sky-300"
              >
                {showSecret ? 'Ẩn' : 'Hiện'}
              </button>
            </div>
            <input
              type={showSecret ? 'text' : 'password'}
              className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-xs focus:border-sky-500"
              placeholder="•••••••• hoặc {{clientSecret}}"
              value={oauth2.clientSecret ?? ''}
              onChange={(e) => onChange({ clientSecret: e.target.value })}
            />
          </label>
        </div>

        {/* Scope & Client Authentication Method */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-slate-400 font-medium">Scope (Phân quyền)</span>
            <input
              className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-xs focus:border-sky-500"
              placeholder="read write email profile hoặc {{scope}}"
              value={oauth2.scope ?? ''}
              onChange={(e) => onChange({ scope: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-slate-400 font-medium">Client Authentication</span>
            <select
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs focus:border-sky-500"
              value={oauth2.clientAuth ?? 'header'}
              onChange={(e) => onChange({ clientAuth: e.target.value as 'header' | 'body' })}
            >
              <option value="header">Gửi Basic Auth trong Header (Chuẩn RFC)</option>
              <option value="body">Gửi client_id & secret trong Body</option>
            </select>
          </label>
        </div>

        {/* Username / Password cho Password Grant */}
        {grantType === 'password' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 border-t border-slate-800 pt-2">
            <label className="flex flex-col gap-1">
              <span className="text-slate-400 font-medium">
                Username <span className="text-amber-400">*</span>
              </span>
              <input
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-xs focus:border-sky-500"
                placeholder="user@example.com hoặc {{username}}"
                value={oauth2.username ?? ''}
                onChange={(e) => onChange({ username: e.target.value })}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-slate-400 font-medium">
                Password <span className="text-amber-400">*</span>
              </span>
              <input
                type="password"
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-xs focus:border-sky-500"
                placeholder="•••••••• hoặc {{password}}"
                value={oauth2.password ?? ''}
                onChange={(e) => onChange({ password: e.target.value })}
              />
            </label>
          </div>
        )}

        {/* Refresh Token input */}
        {grantType === 'refresh_token' && (
          <label className="flex flex-col gap-1 border-t border-slate-800 pt-2">
            <span className="text-slate-400 font-medium">
              Refresh Token <span className="text-amber-400">*</span>
            </span>
            <input
              type="password"
              className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-xs focus:border-sky-500"
              placeholder="Dán Refresh Token hoặc {{refreshToken}}"
              value={oauth2.refreshToken ?? ''}
              onChange={(e) => onChange({ refreshToken: e.target.value })}
            />
          </label>
        )}

        {/* Tự động lưu vào biến môi trường */}
        <div className="flex items-center gap-2 border-t border-slate-800 pt-2">
          <input
            type="checkbox"
            id="oauth_autosave"
            checked={!!oauth2.autoSaveVar}
            onChange={(e) => onChange({ autoSaveVar: e.target.checked ? 'accessToken' : '' })}
            className="rounded bg-slate-900 border-slate-700 text-sky-600 focus:ring-0"
          />
          <label htmlFor="oauth_autosave" className="text-slate-300 cursor-pointer">
            {lang === 'vi' ? 'Tự động lưu Token vào biến môi trường:' : 'Auto-save Token to Environment Variable:'}
          </label>
          {!!oauth2.autoSaveVar && (
            <input
              className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 font-mono text-xs text-sky-300 w-36 focus:border-sky-500"
              placeholder="accessToken"
              value={oauth2.autoSaveVar}
              onChange={(e) => onChange({ autoSaveVar: e.target.value })}
            />
          )}
        </div>
      </div>

      {/* 3. Action Buttons & Status feedback */}
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={handleGetToken}
          disabled={loading || grantType === 'implicit'}
          className="bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-semibold rounded px-4 py-1.5 text-xs transition-all shadow-sm disabled:opacity-50 flex items-center gap-1.5"
        >
          {loading ? (
            <>
              <span className="animate-spin text-sm">⏳</span>
              <span>{lang === 'vi' ? 'Đang gửi yêu cầu Token...' : 'Acquiring token...'}</span>
            </>
          ) : (
            <>
              <span>⚡</span>
              <span>{lang === 'vi' ? 'Lấy Token Mới (Get Token)' : 'Get New Access Token'}</span>
            </>
          )}
        </button>

        {oauth2.refreshToken && (
          <button
            type="button"
            onClick={handleRefreshToken}
            disabled={loading}
            className="bg-slate-800 hover:bg-slate-700 text-sky-300 rounded px-3 py-1.5 transition-colors flex items-center gap-1"
          >
            <span>🔄</span>
            <span>{lang === 'vi' ? 'Làm mới (Refresh)' : 'Refresh Token'}</span>
          </button>
        )}

        {(oauth2.accessToken || oauth2.token) && (
          <button
            type="button"
            onClick={() => onChange({ accessToken: '', token: '', refreshToken: '', expiresIn: undefined, issuedAt: undefined })}
            className="text-slate-400 hover:text-red-400 px-2 py-1 transition-colors"
          >
            ✕ {lang === 'vi' ? 'Xoá Token' : 'Clear Token'}
          </button>
        )}
      </div>

      {/* Thông báo Lỗi / Thành công */}
      {errorMsg && (
        <div className="p-2.5 rounded bg-red-950/60 border border-red-800 text-red-300 text-xs flex items-start gap-2">
          <span className="text-base shrink-0">⚠️</span>
          <div className="flex-1 whitespace-pre-wrap break-all">{errorMsg}</div>
          <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-200">✕</button>
        </div>
      )}

      {successMsg && (
        <div className="p-2.5 rounded bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
          <span className="text-base shrink-0">✅</span>
          <div className="flex-1">{successMsg}</div>
        </div>
      )}

      {/* 4. Thẻ Quản lý Token Hiện Tại (Active Token Details Card) */}
      <div className="border border-slate-800 bg-slate-900/60 rounded p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-300">Active Access Token:</span>
            {expiry.isExpired ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-900/60 text-red-300 border border-red-800">
                🔴 {expiry.formatted}
              </span>
            ) : expiry.isExpiringSoon ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-900/60 text-amber-300 border border-amber-800">
                🟡 {expiry.formatted}
              </span>
            ) : oauth2.accessToken || oauth2.token ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-900/60 text-emerald-300 border border-emerald-800">
                🟢 {expiry.formatted}
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400">
                ⚪ Chưa có token
              </span>
            )}
          </div>

          {(oauth2.accessToken || oauth2.token) && (
            <button
              type="button"
              onClick={handleCopyToken}
              className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1"
            >
              <span>{copied ? '✓ Đã copy' : '📋 Copy Token'}</span>
            </button>
          )}
        </div>

        <div className="relative">
          <input
            type="text"
            className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-sky-500 pr-16"
            placeholder="Chưa có Access Token hoặc nhập trực tiếp token vào đây..."
            value={oauth2.accessToken || oauth2.token || ''}
            onChange={(e) => onChange({ accessToken: e.target.value, token: e.target.value })}
          />
        </div>

        {/* Thông tin metadata của Token */}
        {(oauth2.accessToken || oauth2.token) && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1 border-t border-slate-800/60 text-[11px] text-slate-400">
            <div>
              <span className="text-slate-500">Loại token:</span>{' '}
              <span className="text-slate-300 font-mono">{oauth2.tokenType || 'Bearer'}</span>
            </div>
            <div>
              <span className="text-slate-500">Thời hạn:</span>{' '}
              <span className="text-slate-300 font-mono">{oauth2.expiresIn ? `${oauth2.expiresIn}s` : 'Không xác định'}</span>
            </div>
            <div>
              <span className="text-slate-500">Refresh Token:</span>{' '}
              <span className="text-slate-300 font-mono">{oauth2.refreshToken ? '✓ Có sẵn' : 'Không'}</span>
            </div>
            <div>
              <span className="text-slate-500">Phân quyền:</span>{' '}
              <span className="text-slate-300 font-mono">{oauth2.scope || '(mặc định)'}</span>
            </div>
          </div>
        )}
      </div>

      {/* 5. Tự gia hạn trong phiên (N6) — RAM-only */}
      <div className="border border-slate-800 bg-slate-900/40 rounded p-2.5 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-300">{t.oauth2Session.title}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">RAM</span>
        </div>
        <p className="text-[11px] text-slate-500">{t.oauth2Session.ramNote}</p>
        {!(oauth2.refreshToken || '').trim() ? (
          <p className="text-[11px] text-slate-400">{t.oauth2Session.needsSetup}</p>
        ) : !session ? (
          <p className="text-[11px] text-slate-400">{t.oauth2Session.noneYet}</p>
        ) : (
          <div className="flex flex-col gap-1 text-[11px]">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-slate-400">
              <span>
                <span className="text-slate-500">{t.oauth2Session.lastRefresh.replace('{time}', '')}</span>{' '}
                <span className="text-slate-300 font-mono">{formatAgo(session.at, lang === 'vi')}</span>
              </span>
              <span>
                <span className="text-slate-500">{t.oauth2Session.count.replace('{n}', '')}</span>{' '}
                <span className="text-slate-300 font-mono">{session.count}</span>
              </span>
              {session.remainingSec !== null && (
                <span>
                  <span className="text-slate-500">{t.oauth2Session.remaining.replace('{time}', '')}</span>{' '}
                  <span className="text-emerald-300 font-mono">
                    {formatLeft(session.remainingSec, lang === 'vi')}
                  </span>
                </span>
              )}
            </div>
            {session.error && (
              <p className="text-red-300">
                {t.oauth2Session.error.replace('{msg}', session.error)}
                {Date.now() - session.at < ERROR_COOLDOWN_MS &&
                  ` ${t.oauth2Session.cooldown.replace(
                    '{sec}',
                    String(Math.max(0, Math.ceil((ERROR_COOLDOWN_MS - (Date.now() - session.at)) / 1000))),
                  )}`}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
