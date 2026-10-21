import React, { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '../lib/logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    logger.log({
      level: 'fatal',
      category: 'react',
      message: error.message || 'React Crash',
      stack: error.stack,
      componentStack: errorInfo.componentStack || undefined,
    });
  }

  handleCopyReport = () => {
    const report = logger.generateMarkdownReport('Sự cố Crash giao diện (React ErrorBoundary)');
    navigator.clipboard.writeText(report).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  handleDownloadLog = () => {
    logger.downloadJsonReport();
  };

  handleSendEmail = () => {
    logger.composeSupportEmail('Ứng dụng gặp lỗi giao diện không mong muốn.');
  };

  render() {
    if (this.state.hasError) {
      const { error, errorInfo, copied } = this.state;
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950 text-slate-100 font-sans select-text">
          <div className="max-w-xl w-full bg-[#0c1320] border border-rose-500/30 rounded-2xl shadow-2xl p-6 space-y-5 shadow-rose-950/40">
            {/* Header */}
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 text-2xl shrink-0">
                ⚠️
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">Rất tiếc! ReqX vừa gặp sự cố không mong muốn</h1>
                <p className="text-xs text-slate-400 mt-1">
                  Đã ghi nhận toàn bộ chi tiết lỗi. Bạn có thể sao chép hoặc gửi trực tiếp cho tác giả <strong>LGP</strong> để được hỗ trợ sửa chữa.
                </p>
              </div>
            </div>

            {/* Error Message Box */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2">
              <div className="text-xs font-semibold text-rose-400">
                {error?.name || 'Error'}: {error?.message}
              </div>
              {error?.stack && (
                <div className="max-h-40 overflow-y-auto text-[11px] font-mono text-slate-400 bg-black/40 p-2.5 rounded-lg border border-slate-800/80 leading-relaxed whitespace-pre-wrap">
                  {error.stack}
                </div>
              )}
              {errorInfo?.componentStack && (
                <details className="text-[11px] text-slate-400 pt-1">
                  <summary className="cursor-pointer text-slate-300 hover:text-white font-medium">
                    Xem Component Stack
                  </summary>
                  <pre className="mt-1.5 p-2 bg-black/40 rounded border border-slate-800 text-[10px] overflow-x-auto whitespace-pre-wrap text-slate-400">
                    {errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={this.handleCopyReport}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-300 transition-all flex items-center gap-1.5"
              >
                <span>{copied ? '✓ Đã chép vào clipboard!' : '📋 Sao chép báo cáo lỗi'}</span>
              </button>

              <button
                type="button"
                onClick={this.handleDownloadLog}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 transition-all flex items-center gap-1.5"
              >
                <span>💾 Tải tệp Log (.json)</span>
              </button>

              <button
                type="button"
                onClick={this.handleSendEmail}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 transition-all flex items-center gap-1.5"
              >
                <span>✉️ Gửi mail cho LGP</span>
              </button>

              <button
                type="button"
                onClick={this.handleReload}
                className="ml-auto px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 hover:brightness-110 transition-all"
              >
                🔄 Tải lại ứng dụng
              </button>
            </div>

            {/* Author Footer */}
            <div className="text-[11px] text-slate-500 text-center pt-2 border-t border-slate-800/80">
              Tác giả: <strong>LGP</strong> • Email hỗ trợ: <a href="mailto:maillamtien@gmail.com" className="text-cyan-400 hover:underline">maillamtien@gmail.com</a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
