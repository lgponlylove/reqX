import { useEffect, useState } from 'react';
import { useLicenseStore } from '../stores/license';
import { checkForUpdate, dismissUpdate, type UpdateInfo } from '../lib/update-check';
import { useTranslation } from '../stores/language';

/**
 * Dải banner mỏng dưới header:
 * - Trial: còn N ngày / đã hết 60 ngày (chỉ khi chưa kích hoạt Pro)
 * - Update: có bản mới trên GitHub (check 1 lần/ngày, lỗi mạng thì im)
 */
export default function StatusBanners() {
  const { isPro, isLoaded, trialDaysLeft, trialExpired } = useLicenseStore();
  const { t, lang } = useTranslation();
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    let alive = true;
    checkForUpdate().then((info) => {
      if (alive) setUpdate(info);
    });
    return () => {
      alive = false;
    };
  }, []);

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
        <div className="px-3 py-1 rounded-xl text-[11px] bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 flex items-center gap-2">
          <span>⬆</span>
          <span className="flex-1">
            {(t.license.updateAvailable as string).replace('{v}', update.latest)}
            {update.notes ? ` — ${update.notes}` : ''}
            {lang === 'vi' ? ' Tải về rồi chép đè folder portable cũ (giữ lại file reqx.lic).' : ' Download and overwrite the old portable folder (keep reqx.lic).'}
          </span>
          <a
            href={update.downloadUrl || update.url}
            target="_blank"
            rel="noreferrer"
            className="px-2 py-0.5 rounded-lg bg-emerald-500/20 border border-emerald-500/50 hover:bg-emerald-500/30 font-semibold whitespace-nowrap"
          >
            {t.license.updateDownload}
          </a>
          <a
            href={update.url}
            target="_blank"
            rel="noreferrer"
            title={lang === 'vi' ? 'Mở trang release (đủ file mọi hệ điều hành)' : 'Open the release page (all OS files)'}
            className="text-emerald-400/70 hover:text-emerald-200 whitespace-nowrap underline underline-offset-2"
          >
            {lang === 'vi' ? 'File khác' : 'Other files'}
          </a>
          <button
            type="button"
            onClick={() => {
              dismissUpdate(update.latest);
              setUpdate(null);
            }}
            className="text-emerald-400/70 hover:text-emerald-200 whitespace-nowrap"
          >
            {t.license.updateLater}
          </button>
        </div>
      )}
    </div>
  );
}
