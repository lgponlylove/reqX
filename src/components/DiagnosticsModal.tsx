import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { logger, LogEntry } from '../lib/logger';
import { useTranslation } from '../stores/language';

export default function DiagnosticsModal() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'logs'>('summary');
  const [userNote, setUserNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>(() => logger.getLogs());
  const specs = logger.getSystemSpecs();

  useEffect(() => {
    const unsubscribe = logger.subscribe(() => {
      setLogs(logger.getLogs());
    });
    return unsubscribe;
  }, []);

  // Phím tắt Ctrl+Shift+L mở nhanh bảng chẩn đoán
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    const handleOpenEvent = () => setIsOpen(true);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('reqx:open-diagnostics', handleOpenEvent);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('reqx:open-diagnostics', handleOpenEvent);
    };
  }, [isOpen]);

  const handleCopyReport = () => {
    const report = logger.generateMarkdownReport(userNote.trim());
    navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownloadLog = () => {
    logger.downloadJsonReport();
  };

  const handleSendEmail = () => {
    logger.composeSupportEmail(userNote.trim());
  };

  const handleClearLogs = () => {
    if (window.confirm('Xóa sạch lịch sử log chẩn đoán?')) {
      logger.clearLogs();
    }
  };

  const errorCount = logs.filter((l) => l.level === 'error' || l.level === 'fatal').length;

  return (
    <>
      {/* Nút Chẩn đoán trên thanh Header */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title={`${t.diagnostics.button} (Ctrl+Shift+L)`}
        aria-label={t.diagnostics.button}
        className="relative p-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700/80 hover:border-cyan-500/50 text-slate-300 hover:text-cyan-300 transition-all shadow-sm flex items-center justify-center shrink-0"
      >
        <svg
          viewBox="0 0 24 24"
          className="w-4 h-4 fill-none stroke-current"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          <circle cx="12" cy="12" r="3" />
        </svg>

        {errorCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center animate-pulse">
            {errorCount > 9 ? '9+' : errorCount}
          </span>
        )}
      </button>

      {/* Modal Dialog */}
      {isOpen &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fadeIn">
            {/* Backdrop */}
            <div
              className="absolute inset-0"
              onClick={() => setIsOpen(false)}
              aria-hidden="true"
            />

            {/* Modal Box */}
            <div className="relative z-10 w-full max-w-2xl bg-slate-900 dark:bg-[#0c1624] border border-slate-700/80 dark:border-slate-800 rounded-2xl shadow-2xl shadow-black/80 overflow-hidden text-slate-200 flex flex-col max-h-[85vh]">
              {/* Header */}
              <div className="flex items-start justify-between p-5 border-b border-slate-800/80 bg-slate-950/40 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 text-lg shadow-[0_0_15px_rgba(6,182,212,0.2)] shrink-0">
                    🛠️
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      {t.diagnostics.title}
                      {errorCount > 0 && (
                        <span className="bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                          {errorCount} lỗi ghi nhận
                        </span>
                      )}
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {t.diagnostics.subtitle}
                    </p>
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

              {/* Tabs Switcher */}
              <div className="flex items-center border-b border-slate-800 bg-slate-950/20 px-5 pt-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveTab('summary')}
                  className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all ${
                    activeTab === 'summary'
                      ? 'border-cyan-400 text-cyan-300'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  📋 {t.diagnostics.tabSummary}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('logs')}
                  className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
                    activeTab === 'logs'
                      ? 'border-cyan-400 text-cyan-300'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  📜 {t.diagnostics.tabLogs}
                  <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px]">
                    {logs.length}
                  </span>
                </button>
              </div>

              {/* Body */}
              <div className="p-5 overflow-y-auto space-y-4 flex-1">
                {activeTab === 'summary' ? (
                  <div className="space-y-4">
                    {/* User note */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Mô tả thêm về lỗi bạn đang gặp phải:
                      </label>
                      <textarea
                        rows={3}
                        value={userNote}
                        onChange={(e) => setUserNote(e.target.value)}
                        placeholder={t.diagnostics.userNotePlaceholder}
                        className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-xl p-2.5 text-xs text-slate-200 placeholder:text-slate-600 outline-none transition-colors resize-none shadow-inner"
                      />
                    </div>

                    {/* Environment specs */}
                    <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs">
                      <div className="font-semibold text-slate-300 flex items-center justify-between">
                        <span>🖥️ {t.diagnostics.systemSpecs}</span>
                        <span className="text-[11px] font-mono text-cyan-400">
                          ReqX v{specs.appVersion} ({specs.inTauri ? 'Native' : 'Web'})
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 pt-1">
                        <div>
                          Hệ điều hành: <strong className="text-slate-200">{specs.platform}</strong>
                        </div>
                        <div>
                          Màn hình: <strong className="text-slate-200">{specs.screenSize}</strong>
                        </div>
                        <div>
                          Múi giờ: <strong className="text-slate-200">{specs.timezone}</strong>
                        </div>
                        <div>
                          Bộ nhớ: <strong className="text-slate-200">{specs.memoryEstimate || 'OK'}</strong>
                        </div>
                      </div>
                    </div>

                    {/* Export Actions */}
                    <div className="space-y-2 pt-2">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={handleCopyReport}
                          className="w-full py-2.5 px-3 rounded-xl text-xs font-bold bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-300 transition-all flex items-center justify-center gap-1.5 shadow-sm"
                        >
                          <span>{copied ? t.diagnostics.copied : `📋 ${t.diagnostics.copyReport}`}</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleDownloadLog}
                          className="w-full py-2.5 px-3 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-all flex items-center justify-center gap-1.5 shadow-sm"
                        >
                          <span>💾 {t.diagnostics.downloadJson}</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleSendEmail}
                          className="w-full py-2.5 px-3 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white transition-all flex items-center justify-center gap-1.5 shadow-md shadow-cyan-900/30"
                        >
                          <span>✉️ {t.diagnostics.sendEmail}</span>
                        </button>
                      </div>

                      <p className="text-[11px] text-slate-400 text-center pt-1">
                        Báo cáo chứa stack trace, vị trí tệp và dòng code bị lỗi (đã tự động che thông tin nhạy cảm).
                      </p>
                    </div>
                  </div>
                ) : (
                  /* Logs Tab */
                  <div className="space-y-3">
                    <div className="flex items-center justify-between pb-1">
                      <span className="text-xs text-slate-400">
                        {logs.length > 0
                          ? `Ghi nhận ${logs.length} sự kiện gần nhất:`
                          : t.diagnostics.noLogs}
                      </span>
                      {logs.length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearLogs}
                          className="text-[11px] text-rose-400 hover:text-rose-300 hover:underline"
                        >
                          {t.diagnostics.clearLogs}
                        </button>
                      )}
                    </div>

                    {logs.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-500 bg-slate-950/40 rounded-xl border border-dashed border-slate-800">
                        ✓ {t.diagnostics.noLogs}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {[...logs].reverse().map((log) => {
                          const isFatal = log.level === 'fatal';
                          const isError = log.level === 'error';
                          const isWarn = log.level === 'warn';
                          return (
                            <div
                              key={log.id}
                              className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                                isFatal
                                  ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                                  : isError
                                  ? 'bg-rose-950/25 border-rose-500/30 text-rose-300'
                                  : isWarn
                                  ? 'bg-amber-950/25 border-amber-500/30 text-amber-300'
                                  : 'bg-slate-950/50 border-slate-800 text-slate-300'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                                      isFatal || isError
                                        ? 'bg-rose-500/30 text-rose-300'
                                        : isWarn
                                        ? 'bg-amber-500/30 text-amber-300'
                                        : 'bg-slate-800 text-slate-400'
                                    }`}
                                  >
                                    {log.level}
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-mono">
                                    [{log.category}]
                                  </span>
                                </div>
                                <span className="text-[10px] text-slate-500 font-mono">
                                  {new Date(log.timestamp).toLocaleTimeString('vi-VN')}
                                </span>
                              </div>

                              <div className="font-semibold text-slate-100 break-words">
                                {log.message}
                              </div>

                              {log.stack && (
                                <details className="text-[11px] pt-1">
                                  <summary className="cursor-pointer text-slate-400 hover:text-slate-200 font-medium">
                                    Chi tiết Stack Trace & Tệp bị lỗi
                                  </summary>
                                  <pre className="mt-1.5 p-2 bg-black/60 rounded-lg border border-slate-800/80 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap text-slate-300 leading-relaxed">
                                    {log.stack}
                                  </pre>
                                </details>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-3 bg-slate-950/60 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between shrink-0">
                <span>{t.diagnostics.contactInfo}</span>
                <span className="text-slate-500">Phím tắt: Ctrl+Shift+L</span>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
