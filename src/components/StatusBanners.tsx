import { useEffect, useState } from 'react';
import { useLicenseStore } from '../stores/license';
import { checkForUpdate, dismissUpdate, installNativeUpdate, type UpdateInfo } from '../lib/update-check';
import { useTranslation } from '../stores/language';

/**
 * Dải banner mỏng dưới header:
 * - Trial: còn N ngày / đã hết 60 ngày (chỉ khi chưa kích hoạt Pro)
 * - Update: có bản mới trên GitHub (tự động cập nhật qua Tauri Native Updater hoặc tải web)
 */
export default function StatusBanners() {
  const { isPro, isLoaded, trialDaysLeft, trialExpired } = useLicenseStore();
  const { t, lang } = useTranslation();
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    checkForUpdate().then((info) => {
      if (alive) setUpdate(info);
    });
    return () => {
      alive = false;
    };
  }, []);

  const handleAutoInstall = async () => {
    if (!update) return;
    try {
      setInstalling(true);
      setInstallError(null);
      setProgress(0);
      await installNativeUpdate((pct) => {
        setProgress(pct);
      });
    } catch (err: unknown) {
      setInstalling(false);
      const msg = err instanceof Error ? err.message : String(err);
      setInstallError(msg);
    }
  };

  const trialLeftText = (t.license.trialLeft as string).replace('{n}', String(trialDaysLeft));

  return (
    <div className="flex flex-col gap-1.5 shrink-0">
      {!isPro && isLoaded && !trialExpired && trialDaysLeft <= 14 && (
        <div className="px-3 py-1 rounded-xl text-[11px] bg-sky-950/60 border border-sky-500/30 text-sky-300 flex items-center gap-2">
          <span>⏳</span>
          <span className="flex-1">{trialLeftText} — {t.license.trialHint}</span>
        </div>
      )}
      {!isPro && isLoaded && trialExpired && (
        <div className="px-3 py-1 rounded-xl text-[11px] bg-amber-950/60 border border-amber-500/40 text-amber-300 flex items-center gap-2">
          <span>⚠</span>
          <span className="flex-1">{t.license.trialExpired}</span>
        </div>
      )}
      {update && (
        <div className="px-3 py-1 rounded-xl text-[11px] bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 flex items-center gap-2 flex-wrap">
          <span>⬆</span>
          <span className="flex-1">
            {(t.license.updateAvailable as string).replace('{v}', update.latest)}
            {update.notes ? ` — ${update.notes}` : ''}
            {installing && (
              <span className="ml-2 font-bold text-amber-300 animate-pulse">
                {progress !== null && progress < 100
                  ? `[${progress}%] Đang tải bản cập nhật...`
                  : 'Đang cài đặt & khởi động lại...'}
              </span>
            )}
            {installError && (
              <span className="ml-2 text-rose-300">
                (Lỗi: {installError})
              </span>
            )}
          </span>

          {update.isNative && !installing && (
            <button
              type="button"
              onClick={handleAutoInstall}
              className="px-2.5 py-0.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[11px] shadow-sm transition-colors whitespace-nowrap flex items-center gap-1"
            >
              <span>⚡</span>
              <span>{lang === 'vi' ? 'Tự động cập nhật' : 'Auto Update'}</span>
            </button>
          )}

          {(!update.isNative || installError) && (
            <a
              href={update.downloadUrl || update.url}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-0.5 rounded-lg bg-emerald-500/20 border border-emerald-500/50 hover:bg-emerald-500/30 font-semibold whitespace-nowrap"
            >
              {t.license.updateDownload}
            </a>
          )}

          <a
            href={update.url}
            target="_blank"
            rel="noreferrer"
            title={lang === 'vi' ? 'Mở trang release' : 'Open release page'}
            className="text-emerald-400/70 hover:text-emerald-200 whitespace-nowrap underline underline-offset-2"
          >
            {lang === 'vi' ? 'Chi tiết' : 'Details'}
          </a>

          {!installing && (
            <button
              type="button"
              onClick={() => {
                dismissUpdate(update.latest);
                setUpdate(null);
              }}
              className="text-emerald-400/70 hover:text-emerald-200 whitespace-nowrap ml-1"
            >
              {t.license.updateLater}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
