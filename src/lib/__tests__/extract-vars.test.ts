import { describe, it, expect } from 'vitest';
import { collectCandidates, applyExtraction, collectVarUsages } from '../extract-vars';
import type { ApiRequest } from '../../types/api';

function req(partial: Partial<ApiRequest> & { id: string }): ApiRequest {
  return {
    name: partial.id,
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    bodyType: 'none',
    body: '',
    auth: { type: 'none' },
    updatedAt: 0,
    ...partial,
  } as ApiRequest;
}

const kv = (id: string, key: string, value: string) => ({ id, key, value, enabled: true });

describe('collectCandidates', () => {
  it('gom giá trị header lặp lại thành 1 ứng viên, tên suy ra từ key header', () => {
    const list = collectCandidates([
      req({ id: 'r1', url: 'https://api.x.com/a', headers: [kv('h1', 'X-Tenant-Id', 'ACME')] }),
      req({ id: 'r2', url: 'https://api.x.com/b', headers: [kv('h2', 'X-Tenant-Id', 'ACME')] }),
    ]);
    const c = list.find((x) => x.value === 'ACME');
    expect(c).toBeTruthy();
    expect(c!.occurrences).toHaveLength(2);
    expect(c!.requestCount).toBe(2);
    expect(c!.name).toBe('x_tenant_id');
  });

  it('luôn gợi ý base_url cho host, dù chỉ 1 request', () => {
    const list = collectCandidates([req({ id: 'r1', url: 'https://api.x.com/orders' })]);
    const origin = list.find((x) => x.value === 'https://api.x.com');
    expect(origin).toBeTruthy();
    expect(origin!.origin).toBe(true);
    expect(origin!.name).toBe('base_url');
  });

  it('bỏ qua giá trị đã có {{biến}}', () => {
    const list = collectCandidates([
      req({ id: 'r1', url: '{{base_url}}/orders', headers: [kv('h', 'X-Id', '{{order_id}}')] }),
    ]);
    expect(list.some((c) => c.value.includes('{{'))).toBe(false);
  });

  it('tách lá JSON body theo key của nó', () => {
    const list = collectCandidates([
      req({ id: 'r1', url: 'https://api.x.com/a', bodyType: 'json', body: JSON.stringify({ data: { order_id: 'ORD0001' } }) }),
      req({ id: 'r2', url: 'https://api.x.com/b', bodyType: 'json', body: JSON.stringify({ order_id: 'ORD0001' }) }),
    ]);
    const c = list.find((x) => x.value === 'ORD0001');
    expect(c).toBeTruthy();
    expect(c!.name).toBe('order_id');
    expect(c!.occurrences[0].field).toBe('body');
  });

  it('đánh dấu secret với JWT ở header Authorization', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const list = collectCandidates([req({ id: 'r1', url: 'https://api.x.com/a', headers: [kv('h', 'Authorization', jwt)] })]);
    expect(list.find((c) => c.value === jwt)?.looksSecret).toBe(true);
  });

  it('tên biến không trùng nhau khi nhiều header giống key', () => {
    const list = collectCandidates([
      req({ id: 'r1', url: 'https://api.x.com/a', headers: [kv('h1', 'X-Id', 'AAA'), kv('h2', 'X-Id', 'BBB')] }),
      req({ id: 'r2', url: 'https://api.x.com/b', headers: [kv('h3', 'X-Id', 'AAA'), kv('h4', 'X-Id', 'BBB')] }),
    ]);
    const names = list.filter((c) => ['AAA', 'BBB'].includes(c.value)).map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('applyExtraction', () => {
  const all = {
    r1: req({
      id: 'r1',
      url: 'https://api.x.com/orders',
      params: [kv('p1', 'tenant', 'ACME')],
      headers: [kv('h1', 'Authorization', 'Bearer tok123456')],
      auth: { type: 'apikey', apiKey: 'KEY777' },
    }),
    r2: req({ id: 'r2', url: 'https://api.x.com/items' }),
    outside: req({ id: 'outside', url: 'https://api.x.com/orders' }),
  };

  it('thay base URL trước URL đầy đủ để không lồng nhau sai', () => {
    const res = applyExtraction(all, ['r1', 'r2'], [
      { name: 'base_url', value: 'https://api.x.com' },
      { name: 'orders_url', value: 'https://api.x.com/orders' },
    ]);
    expect(res.requests.r1.url).toBe('{{orders_url}}');
    expect(res.requests.r2.url).toBe('{{base_url}}/items');
  });

  it('thay ở params, headers và auth', () => {
    const res = applyExtraction(all, ['r1'], [
      { name: 'tenant', value: 'ACME' },
      { name: 'auth_token', value: 'Bearer tok123456' },
      { name: 'api_key', value: 'KEY777' },
    ]);
    expect(res.requests.r1.params[0].value).toBe('{{tenant}}');
    expect(res.requests.r1.headers[0].value).toBe('{{auth_token}}');
    expect(res.requests.r1.auth.apiKey).toBe('{{api_key}}');
    expect(res.positions).toBe(3);
  });

  it('chỉ đụng tới request trong phạm vi và giữ nguyên object nếu không thay gì', () => {
    const res = applyExtraction(all, ['r1', 'r2'], [{ name: 'api_key', value: 'KEY777' }]);
    expect(res.touched).toBe(1);
    expect(res.requests.r2).toBe(all.r2);
    expect(res.requests.outside).toBe(all.outside);
    expect(res.requests.outside.url).toBe('https://api.x.com/orders');
  });
});

describe('collectVarUsages', () => {
  it('liệt kê biến đang dùng trong request (kể cả sau khi đã tách biến)', () => {
    const usages = collectVarUsages([
      req({
        id: 'r1',
        url: '{{base_url}}/orders/{{order_id}}',
        headers: [kv('h1', 'Authorization', 'Bearer {{token}}')],
        auth: { type: 'apikey', apiKey: '{{api_key}}' },
      }),
      req({ id: 'r2', url: '{{base_url}}/items' }),
    ]);
    expect(usages.find((u) => u.name === 'base_url')).toMatchObject({ occurrences: 2, requestCount: 2 });
    expect(usages.find((u) => u.name === 'order_id')?.requestCount).toBe(1);
    expect(usages.map((u) => u.name)).toEqual(expect.arrayContaining(['token', 'api_key']));
  });

  it('bắt cả biến nằm trong script pre-request/tests', () => {
    const usages = collectVarUsages([
      req({ id: 'r1', url: 'https://api.x.com/a', preRequest: "pm.variables.set('x', '{{seed}}')" }),
    ]);
    expect(usages.find((u) => u.name === 'seed')).toBeTruthy();
  });
});
