import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLicenseStore } from '../stores/license';
import { useTranslation } from '../stores/language';

export default function LicenseModal() {
  const { isPro, info, isLoading, lastError, activateLicense, deactivateLicense } = useLicenseStore();
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [inputKey, setInputKey] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setFeedback(null);
      setInputKey('');
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const key = inputKey.trim();
    if (!key) {
      setFeedback({ type: 'error', message: t.license.keyPlaceholder });
      return;
    }

    const res = await activateLicense(key);
    if (res.valid && res.is_pro) {
      setFeedback({ type: 'success', message: t.license.activationSuccess });
      setInputKey('');
    } else {
      setFeedback({
        type: 'error',
        message: res.error || t.license.activationFailed,
      });
    }
  };

  const handleDeactivate = async () => {
    if (window.confirm(t.license.deactivateConfirm)) {
      await deactivateLicense();
      setFeedback(null);
    }
  };

  const formatDate = (ms?: number | null) => {
    if (!ms) return t.license.lifetime;
    try {
      return new Date(ms).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return String(ms);
    }
  };

  const getDaysLeftText = (ms?: number | null) => {
    if (!ms) return '';
    const diff = ms - Date.now();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    const count = days > 0 ? days : 0;
    return ` ${t.license.daysLeft.replace('{n}', String(count))}`;
  };

  return (
    <>
      {/* Top Header Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title={isPro ? t.license.proActive : t.license.upgradePro}
        aria-label={isPro ? t.license.proActive : t.license.upgradePro}
        className={`px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm shrink-0 ${
          isPro
            ? 'bg-gradient-to-r from-amber-500/20 via-yellow-500/15 to-amber-500/10 border border-amber-500/50 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.25)] hover:border-amber-400'
            : 'bg-slate-900/80 hover:bg-slate-800 border border-slate-700/80 hover:border-amber-500/60 text-slate-300 hover:text-amber-300'
        }`}
      >
        {isPro ? (
          <>
            <span className="text-amber-400 text-sm leading-none">★</span>
            <span className="tracking-wide font-bold bg-gradient-to-r from-amber-300 to-yellow-200 bg-clip-text text-transparent">
              PRO
            </span>
          </>
        ) : (
          <>
            <svg
              viewBox="0 0 24 24"
              className="w-3.5 h-3.5 text-amber-400/90 fill-none stroke-current"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 2l-2 2m-1.5 1.5L16 7l-1.5-1.5L16 4l2-2h3v3l-2 2z" />
              <circle cx="7.5" cy="16.5" r="5.5" />
              <path d="M11.5 12.5L18 6" />
            </svg>
            <span className="font-semibold text-slate-300">{t.license.pro}</span>
          </>
        )}
      </button>

      {/* Modal Dialog */}
      {isOpen &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fadeIn">
            {/* Backdrop click */}
            <div
              className="absolute inset-0"
              onClick={() => setIsOpen(false)}
              aria-hidden="true"
            />

            {/* Modal Card */}
            <div className="relative z-10 w-full max-w-lg bg-slate-900 dark:bg-[#0c1622] border border-slate-700/80 dark:border-slate-800 rounded-2xl shadow-2xl shadow-black/80 overflow-hidden text-slate-200">
              {/* Header */}
              <div className="flex items-start justify-between p-5 border-b border-slate-800/80 bg-slate-950/40">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-lg shadow-[0_0_15px_rgba(245,158,11,0.2)] shrink-0">
                    ★
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      {t.license.title}
                      {isPro && (
                        <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                          Pro Active
                        </span>
                      )}
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {t.license.subtitle}
                    </p>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-1">
                      <span>{t.license.authorLabel}</span>
                      <span className="font-semibold text-slate-200">{t.license.authorName}</span>
                      <span>•</span>
                      <a
                        href={`mailto:${t.license.authorEmail}`}
                        className="text-teal-400 hover:text-teal-300 hover:underline font-mono"
                      >
                        {t.license.authorEmail}
                      </a>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-none stroke-current" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
                {/* Active License Details */}
                {isPro && info ? (
                  <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-xl p-4 space-y-3 shadow-inner">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
                        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                          {t.license.statusActive}
                        </span>
                      </div>
                      <span className="text-xs font-mono font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-md">
                        {info.tier.toUpperCase()}
                      </span>
                    </div>

                    <div className="text-xs space-y-1.5 pt-1 text-slate-300">
                      <div className="flex justify-between border-b border-emerald-900/40 pb-1">
                        <span className="text-slate-400">{t.license.licensedTo}</span>
                        <span className="font-semibold text-white">{info.email}</span>
                      </div>
                      <div className="flex justify-between border-b border-emerald-900/40 pb-1">
                        <span className="text-slate-400">{t.license.issuedAt}</span>
                        <span>{formatDate(info.issued_at)}</span>
                      </div>
                      <div className="flex justify-between pb-0.5">
                        <span className="text-slate-400">{t.license.expiresAt}</span>
                        <span className="font-semibold text-emerald-300">
                          {formatDate(info.expires_at)}
                          {info.expires_at && (
                            <span className="text-[11px] text-amber-300 font-normal ml-1">
                              {getDaysLeftText(info.expires_at)}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={handleDeactivate}
                        className="text-xs text-rose-400 hover:text-rose-300 hover:underline transition-colors"
                      >
                        {t.license.deactivateBtn}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Free Version & Activation Form */
                  <div className="space-y-4">
                    <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-slate-500" />
                        <span className="text-slate-300 font-medium">{t.license.statusFree}</span>
                      </div>
                      <span className="text-slate-400 text-[11px]">v0.1.0</span>
                    </div>

                    <form onSubmit={handleActivate} className="space-y-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                          {t.license.upgradePro} (License Key)
                        </label>
                        <textarea
                          rows={3}
                          value={inputKey}
                          onChange={(e) => setInputKey(e.target.value)}
                          placeholder={t.license.keyPlaceholder}
                          className="w-full bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-xl p-2.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 outline-none transition-colors resize-none shadow-inner"
                        />
                      </div>

                      {feedback && (
                        <div
                          className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                            feedback.type === 'success'
                              ? 'bg-emerald-950/50 border border-emerald-500/50 text-emerald-300'
                              : 'bg-rose-950/50 border border-rose-500/50 text-rose-300'
                          }`}
                        >
                          <span>{feedback.type === 'success' ? '✓' : '⚠'}</span>
                          <span className="flex-1">{feedback.message}</span>
                        </div>
                      )}

                      {lastError && !feedback && (
                        <div className="p-2.5 rounded-xl text-xs bg-rose-950/50 border border-rose-500/50 text-rose-300 flex items-center gap-2">
                          <span>⚠</span>
                          <span className="flex-1">{lastError}</span>
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={isLoading || !inputKey.trim()}
                        className="w-full py-2 px-4 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 shadow-md shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                      >
                        {isLoading ? (
                          <>
                            <span className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                            <span>Đang xác thực...</span>
                          </>
                        ) : (
                          <>
                            <span>★</span>
                            <span>{t.license.activateBtn}</span>
                          </>
                        )}
                      </button>
                    </form>
                  </div>
                )}

                {/* Pro Features Showcase */}
                <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-3.5 space-y-2 text-xs">
                  <div className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <span className="text-amber-400">⚡</span>
                    <span>{t.license.featuresTitle}</span>
                  </div>
                  <ul className="space-y-1.5 text-slate-400 text-[11px]">
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-400">✓</span>
                      <span>{t.license.featureUnlimited}</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-400">✓</span>
                      <span>{t.license.featureExport}</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-400">✓</span>
                      <span>{t.license.featurePriority}</span>
                    </li>
                  </ul>
                </div>

                {/* Offline Guarantee & Dev Notice */}
                <div className="p-3 rounded-xl bg-slate-950/80 border border-teal-500/20 text-[11px] text-slate-400 flex items-start gap-2.5">
                  <svg
                    viewBox="0 0 24 24"
                    className="w-4 h-4 text-teal-400 shrink-0 mt-0.5 fill-none stroke-current"
                    strokeWidth="2"
                  >
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  <div className="space-y-1.5 flex-1">
                    <p className="text-slate-300 font-medium">{t.license.offlineNotice}</p>
                    <div className="flex items-center justify-between flex-wrap gap-1 text-[11px] pt-1 border-t border-slate-800/80">
                      <span className="text-slate-400">
                        {t.license.contactHint} <strong className="text-slate-200">{t.license.authorName}</strong>
                      </span>
                      <a
                        href={`mailto:${t.license.authorEmail}`}
                        className="text-teal-400 hover:text-teal-300 hover:underline font-mono"
                      >
                        {t.license.authorEmail}
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
