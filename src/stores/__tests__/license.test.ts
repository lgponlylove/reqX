import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';

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
  };
});

import { useLicenseStore } from '../license';

// Ed25519 Secret/Private Key & Public Key
const PRIVATE_KEY_HEX = '659f51dddd12659ec90109703e82cdd4d98847c2d4f8da3e3eb36787224544c6';

function generateTestKey(email: string, tier = 'pro', days: number | null = null) {
  const payloadObj = {
    email,
    tier,
    issued_at: Date.now(),
    expires_at: days ? Date.now() + days * 86400000 : null,
  };
  const payloadJson = JSON.stringify(payloadObj);
  const payloadBase64 = Buffer.from(payloadJson).toString('base64');

  const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  const privDer = Buffer.concat([pkcs8Prefix, Buffer.from(PRIVATE_KEY_HEX, 'hex')]);
  const privKey = crypto.createPrivateKey({ key: privDer, format: 'der', type: 'pkcs8' });

  const sig = crypto.sign(null, Buffer.from(payloadJson), privKey);
  const sigBase64 = sig.toString('base64');
  return `REQX-PRO.${payloadBase64}.${sigBase64}`;
}

describe('License Store', () => {
  beforeEach(() => {
    localStorage.clear();
    useLicenseStore.setState({
      isPro: false,
      info: null,
      isLoaded: false,
      isLoading: false,
      lastError: null,
    });
  });

  it('bắt đầu ở trạng thái miễn phí khi chưa kích hoạt', async () => {
    const store = useLicenseStore.getState();
    const res = await store.checkLicense();
    expect(res.valid).toBe(false);
    expect(res.is_pro).toBe(false);
    expect(useLicenseStore.getState().isPro).toBe(false);
  });

  it('kích hoạt thành công với License Key hợp lệ', async () => {
    const validKey = generateTestKey('customer@enterprise.com', 'pro', null);
    const store = useLicenseStore.getState();

    const res = await store.activateLicense(validKey);
    expect(res.valid).toBe(true);
    expect(res.is_pro).toBe(true);
    expect(res.info?.email).toBe('customer@enterprise.com');
    expect(res.info?.tier).toBe('pro');
    expect(res.info?.expires_at).toBeNull();

    const state = useLicenseStore.getState();
    expect(state.isPro).toBe(true);
    expect(state.info?.email).toBe('customer@enterprise.com');

    // Kiểm tra checkLicense sau khi reload
    const checkRes = await store.checkLicense();
    expect(checkRes.valid).toBe(true);
    expect(checkRes.is_pro).toBe(true);
  });

  it('từ chối mã bản quyền rỗng hoặc sai cấu trúc', async () => {
    const store = useLicenseStore.getState();
    const res = await store.activateLicense('   ');
    expect(res.valid).toBe(false);
    expect(res.is_pro).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('hủy kích hoạt thành công (deactivate)', async () => {
    const validKey = generateTestKey('user@domain.com');
    const store = useLicenseStore.getState();

    await store.activateLicense(validKey);
    expect(useLicenseStore.getState().isPro).toBe(true);

    await store.deactivateLicense();
    expect(useLicenseStore.getState().isPro).toBe(false);
    expect(useLicenseStore.getState().info).toBeNull();
  });
});
