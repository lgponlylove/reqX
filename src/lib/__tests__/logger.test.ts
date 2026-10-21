import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  const store: Record<string, string> = {};
  const localStorageMock = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k in store) delete store[k]; },
    length: 0,
    key: () => null,
  } as Storage;
  const g = globalThis as { localStorage?: Storage; window?: unknown };
  g.localStorage = localStorageMock;
  g.window = {
    localStorage: localStorageMock,
    screen: { width: 1920, height: 1080 },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
});

import { logger } from '../logger';

describe('DiagnosticLogger', () => {
  beforeEach(() => {
    logger.clearLogs();
  });

  it('ghi nhận log lỗi chi tiết kèm stack trace', () => {
    logger.log({
      level: 'error',
      category: 'network',
      message: 'Không thể kết nối tới server 500',
      stack: 'Error at sendNativeRequest (tauri-http.ts:42:15)',
    });

    const logs = logger.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe('Không thể kết nối tới server 500');
    expect(logs[0].stack).toContain('tauri-http.ts:42:15');
    expect(logs[0].level).toBe('error');
    expect(logs[0].category).toBe('network');
  });

  it('tự động che giấu Bearer Token và password nhạy cảm', () => {
    logger.log({
      level: 'fatal',
      category: 'system',
      message: 'Lỗi xác thực: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz123',
      stack: '{"password": "secret_password_123", "token": "abc_xyz"}',
    });

    const logs = logger.getLogs();
    expect(logs[0].message).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(logs[0].message).toContain('Bearer [MASKED_TOKEN]');
    expect(logs[0].stack).toContain('[MASKED]');
    expect(logs[0].stack).not.toContain('secret_password_123');
  });

  it('tạo báo cáo Markdown hoàn chỉnh kèm thông số hệ thống', () => {
    logger.log({
      level: 'error',
      category: 'react',
      message: 'Cannot read properties of undefined (reading "id")',
      stack: 'TypeError: Cannot read properties of undefined\n    at RequestBar.tsx:88:12',
    });

    const report = logger.generateMarkdownReport('Tôi bị lỗi khi bấm Send');
    expect(report).toContain('# 🐞 BÁO CÁO LỖI REQX API CLIENT');
    expect(report).toContain('LGP (maillamtien@gmail.com)');
    expect(report).toContain('Tôi bị lỗi khi bấm Send');
    expect(report).toContain('RequestBar.tsx:88:12');
    expect(report).toContain('Cannot read properties of undefined');
  });

  it('hỗ trợ callback đăng ký sự kiện khi có log mới', () => {
    let triggered = false;
    const unsub = logger.subscribe(() => {
      triggered = true;
    });

    logger.log({
      level: 'info',
      category: 'system',
      message: 'Test notification',
    });

    expect(triggered).toBe(true);
    unsub();
  });
});
