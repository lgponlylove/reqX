/**
 * ReqX Diagnostic & Error Logger
 * Thu thập và quản lý log lỗi chi tiết (stack trace, component stack, system specs)
 * Tự động che giấu thông tin nhạy cảm (Bearer tokens, passwords) để đảm bảo an toàn.
 */

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'fatal';
  category: 'system' | 'react' | 'network' | 'script' | 'storage';
  message: string;
  stack?: string;
  componentStack?: string;
  data?: Record<string, unknown>;
}

export interface SystemSpecs {
  appVersion: string;
  userAgent: string;
  platform: string;
  language: string;
  screenSize: string;
  timezone: string;
  inTauri: boolean;
  memoryEstimate?: string;
}

const MAX_LOGS = 100;
const STORAGE_KEY = 'reqx_diagnostic_logs';
const LAST_CRASH_KEY = 'reqx_last_crash';

class DiagnosticLogger {
  private logs: LogEntry[] = [];
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadFromStorage();
    this.attachGlobalHandlers();
  }

  private attachGlobalHandlers() {
    if (typeof window === 'undefined') return;

    // Bắt uncaught JavaScript errors (lỗi runtime, cú pháp, undefined...)
    window.addEventListener('error', (event) => {
      this.log({
        level: 'fatal',
        category: 'system',
        message: event.message || 'Lỗi Uncaught Exception',
        stack: event.error?.stack || `${event.filename}:${event.lineno}:${event.colno}`,
      });
    });

    // Bắt unhandled Promise rejections (lỗi async không try/catch)
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      let message = 'Unhandled Promise Rejection';
      let stack: string | undefined;

      if (reason instanceof Error) {
        message = reason.message;
        stack = reason.stack;
      } else if (typeof reason === 'string') {
        message = reason;
      } else if (reason && typeof reason === 'object') {
        message = JSON.stringify(reason);
      }

      this.log({
        level: 'error',
        category: 'system',
        message,
        stack,
      });
    });
  }

  private sanitize(str?: string): string | undefined {
    if (!str) return str;
    // Che Authorization: Bearer xxxx, password, api_key
    return str
      .replace(/Bearer\s+([A-Za-z0-9_\-\.]+)/gi, 'Bearer [MASKED_TOKEN]')
      .replace(/("password"|"secret"|"apiKey"|"api_key"|"token")\s*:\s*"[^"]+"/gi, '$1:"[MASKED]"');
  }

  private loadFromStorage() {
    try {
      if (typeof window !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            this.logs = parsed.slice(-MAX_LOGS);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  private saveToStorage() {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.logs.slice(-50)));
      }
    } catch {
      // ignore
    }
  }

  public log(entry: Omit<LogEntry, 'id' | 'timestamp'>) {
    const item: LogEntry = {
      ...entry,
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      message: this.sanitize(entry.message) || '',
      stack: this.sanitize(entry.stack),
      componentStack: this.sanitize(entry.componentStack),
    };

    this.logs.push(item);
    if (this.logs.length > MAX_LOGS) {
      this.logs.shift();
    }

    if (item.level === 'fatal') {
      try {
        localStorage.setItem(LAST_CRASH_KEY, JSON.stringify(item));
      } catch {
        // ignore
      }
    }

    this.saveToStorage();
    this.notify();
  }

  public getLogs(): LogEntry[] {
    return [...this.logs];
  }

  public getSystemSpecs(): SystemSpecs {
    const isClient = typeof window !== 'undefined';
    let mem: string | undefined;
    if (isClient && typeof performance !== 'undefined') {
      const perf = performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } };
      if (perf && perf.memory) {
        mem = `${Math.round(perf.memory.usedJSHeapSize / (1024 * 1024))}MB / ${Math.round(perf.memory.totalJSHeapSize / (1024 * 1024))}MB`;
      }
    }

    return {
      appVersion: '0.1.2',
      userAgent: isClient ? navigator.userAgent : 'Unknown',
      platform: isClient ? navigator.platform : 'Unknown',
      language: isClient ? navigator.language : 'vi',
      screenSize: isClient ? `${window.screen.width}x${window.screen.height} (scale: ${window.devicePixelRatio || 1})` : 'Unknown',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown',
      inTauri: isClient && '__TAURI_INTERNALS__' in window,
      memoryEstimate: mem,
    };
  }

  public clearLogs() {
    this.logs = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LAST_CRASH_KEY);
    } catch {
      // ignore
    }
    this.notify();
  }

  public subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        // ignore
      }
    });
  }

  /**
   * Tạo bản báo cáo Markdown đầy đủ chi tiết để gửi cho tác giả (LGP)
   */
  public generateMarkdownReport(customNote?: string): string {
    const specs = this.getSystemSpecs();
    const recentLogs = this.logs.slice(-15);

    let md = `# 🐞 BÁO CÁO LỖI REQX API CLIENT\n\n`;
    md += `**Thời gian tạo báo cáo:** ${new Date().toLocaleString('vi-VN')}\n`;
    md += `**Gửi đến:** LGP (maillamtien@gmail.com)\n\n`;

    if (customNote) {
      md += `### 📝 Mô tả từ người dùng:\n${customNote}\n\n`;
    }

    md += `### 🖥️ Thông số môi trường:\n`;
    md += `- **Phiên bản ReqX:** \`v${specs.appVersion}\`\n`;
    md += `- **Môi trường chạy:** ${specs.inTauri ? 'App Desktop (Tauri Native)' : 'Trình duyệt Web'}\n`;
    md += `- **Hệ điều hành / Nền tảng:** \`${specs.platform}\`\n`;
    md += `- **Độ phân giải màn hình:** \`${specs.screenSize}\`\n`;
    md += `- **Múi giờ:** \`${specs.timezone}\`\n`;
    md += `- **Bộ nhớ sử dụng:** \`${specs.memoryEstimate || 'N/A'}\`\n`;
    md += `- **User Agent:** \`${specs.userAgent}\`\n\n`;

    md += `### 📜 Các sự kiện log gần nhất (${recentLogs.length}):\n`;
    if (recentLogs.length === 0) {
      md += `*(Không có log lỗi nào được ghi nhận gần đây)*\n`;
    } else {
      recentLogs.reverse().forEach((log, idx) => {
        md += `#### ${idx + 1}. [${log.level.toUpperCase()}] [${log.category}] ${log.timestamp}\n`;
        md += `**Nội dung lỗi:** \`${log.message}\`\n\n`;
        if (log.stack) {
          md += `**Chi tiết Stack Trace:**\n\`\`\`text\n${log.stack}\n\`\`\`\n\n`;
        }
        if (log.componentStack) {
          md += `**Component Stack (React):**\n\`\`\`text\n${log.componentStack}\n\`\`\`\n\n`;
        }
      });
    }

    md += `---\n*Báo cáo được tự động tạo bởi công cụ chẩn đoán ReqX Diagnostics.*\n`;
    return md;
  }

  /**
   * Tải tệp log JSON đầy đủ về máy
   */
  public downloadJsonReport() {
    const data = {
      systemSpecs: this.getSystemSpecs(),
      exportedAt: new Date().toISOString(),
      logs: this.logs,
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reqx-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /**
   * Mở trình soạn mail với nội dung lỗi điền sẵn
   */
  public composeSupportEmail(customNote?: string) {
    const recipient = 'maillamtien@gmail.com';
    const subject = encodeURIComponent(`[ReqX Bug Report] Báo cáo lỗi phiên bản 0.1.0`);
    const reportText = this.generateMarkdownReport(customNote);
    // Cắt ngắn nếu quá dài đối với mailto URL (chuẩn RFC khoảng 2000 ký tự cho URL)
    const truncatedBody = reportText.length > 1800 
      ? reportText.substring(0, 1800) + '\n\n...(Còn tiếp, vui lòng đính kèm tệp log json nếu có)'
      : reportText;

    const mailtoUrl = `mailto:${recipient}?subject=${subject}&body=${encodeURIComponent(truncatedBody)}`;
    window.open(mailtoUrl, '_blank');
  }
}

export const logger = new DiagnosticLogger();
