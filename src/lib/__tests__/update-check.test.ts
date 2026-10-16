import { describe, it, expect } from 'vitest';
import { isNewer, detectOs, pickAsset } from '../update-check';

describe('isNewer', () => {
  it('bản mới hơn thì true', () => {
    expect(isNewer('0.2.0', '0.1.2')).toBe(true);
    expect(isNewer('0.1.3', '0.1.2')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
  });

  it('bằng hoặc cũ hơn thì false', () => {
    expect(isNewer('0.1.2', '0.1.2')).toBe(false);
    expect(isNewer('0.1.1', '0.1.2')).toBe(false);
    expect(isNewer('0.1.10', '0.1.9')).toBe(true);
  });
});

describe('detectOs / pickAsset', () => {
  const UA_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
  const UA_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';
  const UA_LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
  const assets = {
    win_nsis: 'ReqX_0.2.0_x64-setup.exe',
    win_msi: 'ReqX_0.2.0_x64_en-US.msi',
    mac_arm: 'ReqX_0.2.0_aarch64.dmg',
    mac_intel: 'ReqX_0.2.0_x64.dmg',
    linux_appimage: 'reqx_0.2.0_amd64.AppImage',
    linux_deb: 'reqx_0.2.0_amd64.deb',
  };

  it('Windows → file NSIS exe', () => {
    expect(detectOs(UA_WIN)).toBe('win');
    expect(pickAsset('win', assets)).toBe('ReqX_0.2.0_x64-setup.exe');
  });

  it('macOS: chip ARM theo architecture, mặc định Intel khi không rõ', () => {
    expect(detectOs(UA_MAC, 'arm')).toBe('mac-arm');
    expect(detectOs(UA_MAC)).toBe('mac-intel');
    expect(pickAsset('mac-arm', assets)).toBe('ReqX_0.2.0_aarch64.dmg');
    expect(pickAsset('mac-intel', assets)).toBe('ReqX_0.2.0_x64.dmg');
  });

  it('Linux → AppImage', () => {
    expect(detectOs(UA_LINUX)).toBe('linux');
    expect(pickAsset('linux', assets)).toBe('reqx_0.2.0_amd64.AppImage');
  });

  it('không dò được → null (banner dùng link trang release)', () => {
    expect(detectOs('SomeBot/1.0')).toBe('unknown');
    expect(pickAsset('unknown', assets)).toBeNull();
  });
});
