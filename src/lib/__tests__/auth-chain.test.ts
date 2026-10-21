import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ApiRequest, Collection } from '../../types/api';
import { applyResolvedAuth, describeAuth, parentAuthOf, resolveRequestAuth } from '../auth-chain';
import { stripRequestSecrets } from '../secrets';
import { toCurl } from '../codegen';

function req(auth: ApiRequest['auth'], collectionId = 'c1'): ApiRequest {
  return {
    id: 'r1',
    name: 'Login',
    method: 'GET',
    url: 'https://api.test/login',
    params: [],
    headers: [],
    bodyType: 'none',
    body: '',
    auth,
    collectionId,
    updatedAt: 1,
  };
}

function col(auth?: Collection['auth'], ids = ['r1']): Collection {
  return { id: 'c1', name: 'SSO', folders: [], rootRequestIds: ids, ...(auth ? { auth } : {}) };
}

describe('auth kế thừa từ collection', () => {
  const bearer = { type: 'bearer', token: 'TOK' } as const;

  it('request "inherit" lấy auth của collection chứa nó', () => {
    const r = req({ type: 'inherit' });
    expect(resolveRequestAuth([col(bearer)], r)).toEqual({ type: 'bearer', token: 'TOK' });
    expect(parentAuthOf([col(bearer)], r)?.collection.name).toBe('SSO');
  });

  it('request tự đặt auth thì request thắng, không bị collection ghi đè', () => {
    const r = req({ type: 'apikey', apiKey: 'KEY', apiKeyName: 'X-API-Key' });
    expect(resolveRequestAuth([col(bearer)], r).type).toBe('apikey');
  });

  it('request "No Auth" KHÔNG bao giờ bị biến thành auth của collection', () => {
    // Đây là lý do chọn 'inherit' tường minh thay vì hiểu ngầm 'none':
    // tự ý gắn Authorization có thể lộ token của collection sang host khác.
    expect(resolveRequestAuth([col(bearer)], req({ type: 'none' })).type).toBe('none');
  });

  it('collection chưa đặt auth (hoặc đặt No Auth) → coi như No Auth', () => {
    const r = req({ type: 'inherit' });
    expect(resolveRequestAuth([col()], r).type).toBe('none');
    expect(resolveRequestAuth([col({ type: 'none' })], r).type).toBe('none');
    expect(resolveRequestAuth([], r).type).toBe('none');
  });

  it('request nằm trong folder vẫn tìm được collection cha', () => {
    const withFolder: Collection = {
      id: 'c1',
      name: 'SSO',
      folders: [{ id: 'f1', name: 'Token', requestIds: ['r1'], folderIds: [] }],
      rootRequestIds: [],
      auth: bearer,
    };
    expect(resolveRequestAuth([withFolder], req({ type: 'inherit' })).type).toBe('bearer');
  });

  it('applyResolvedAuth trả về bản copy, bản lưu trong store không đổi', () => {
    const r = req({ type: 'inherit' });
    const eff = applyResolvedAuth([col(bearer)], r);
    expect(eff.auth).toEqual({ type: 'bearer', token: 'TOK' });
    expect(r.auth.type).toBe('inherit');
    expect(eff).not.toBe(r);
  });

  it('stripAuth giữ ý định "inherit", còn bearer thì chỉ xóa giá trị token', () => {
    expect(stripRequestSecrets(req(bearer as ApiRequest['auth'])).auth).toEqual({ type: 'bearer', token: '' });
    expect(stripRequestSecrets(req({ type: 'inherit' })).auth.type).toBe('inherit');
  });

  it('describeAuth chỉ nêu kiểu + username, không in token hay mật khẩu', () => {
    expect(describeAuth(bearer)).toBe('Bearer Token');
    expect(describeAuth({ type: 'basic', username: 'qa', password: 'MatKhau' } as ApiRequest['auth'])).toBe('Basic (username: qa)');
    expect(describeAuth({ type: 'inherit' })).toBe('Kế thừa collection');
  });

  it('codegen sinh đúng header kế thừa (khớp thứ thực sự gửi đi)', () => {
    const r = req({ type: 'inherit' });
    expect(toCurl(r, {}, {}, [col(bearer)])).toContain('Authorization: Bearer TOK');
    // không truyền collections thì giữ nguyên hành vi cũ: không có Authorization
    expect(toCurl(r, {}, {})).not.toContain('Authorization');
  });
});

describe('auth kế thừa chạy thật khi gửi (runner)', () => {
  let sent: Record<string, string>[] = [];

  beforeEach(() => {
    sent = [];
    vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
        sent.push(init?.headers ?? {});
        return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('request "inherit" gửi đi kèm Authorization Basic của collection', async () => {
    const { runOneRequest } = await import('../runner');
    const hooks = {
      getVars: () => ({ envVars: { user: 'qa', pass: 'Ma1' }, globals: {} }),
      setEnv: () => {},
      setGlobal: () => {},
    };
    const collection = col({ type: 'basic', username: '{{user}}', password: '{{pass}}' });
    const out = await runOneRequest(
      req({ type: 'inherit' }),
      hooks,
      5000,
      undefined,
      undefined,
      [collection],
    );
    expect(out.status).toBe(200);
    const basic = Buffer.from('qa:Ma1').toString('base64');
    expect(sent[0].Authorization).toBe(`Basic ${basic}`);
  });

  it('runner không ghi auth giải được ngược vào request', async () => {
    const r = req({ type: 'inherit' });
    const { runOneRequest } = await import('../runner');
    await runOneRequest(r, { getVars: () => ({ envVars: {}, globals: {} }), setEnv: () => {}, setGlobal: () => {} }, 5000, undefined, undefined, [col({ type: 'bearer', token: 'X' })]);
    expect(r.auth.type).toBe('inherit');
    expect(sent[0].Authorization).toBe('Bearer X');
  });
});
