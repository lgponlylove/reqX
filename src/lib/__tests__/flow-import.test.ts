import { describe, expect, it } from 'vitest';
import { mergeReqxImport, parseFlowObject, type ReqxFlowImport } from '../flow';
import type { ApiRequest } from '../../types/api';

const kv = (key: string, value: string) => ({ id: `kv-${key}`, key, value, enabled: true });

function existingReq(over: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'req-old', name: 'Old', method: 'GET', url: 'https://x.test/users',
    params: [], headers: [], bodyType: 'none', body: '',
    auth: { type: 'none' }, preRequest: '', tests: '',
    collectionId: 'col-1', updatedAt: 1, ...over,
  };
}

function fileReq(over: Partial<ReqxFlowImport['requests'][number]> = {}): ReqxFlowImport['requests'][number] {
  return {
    name: 'Users', method: 'GET', url: 'https://x.test/users',
    params: [], headers: [], bodyType: 'none', body: '',
    auth: { type: 'none' }, ...over,
  };
}

const fileOf = (reqs: ReqxFlowImport['requests']): ReqxFlowImport => ({
  name: 'F', requests: reqs, steps: reqs.map((_, i) => ({ request: i, extract: [] })),
});

describe('mergeReqxImport', () => {
  it('trùng method+url+body → dùng lại, không tạo collection mới', () => {
    const m = mergeReqxImport(fileOf([fileReq()]), { 'req-old': existingReq() });
    expect(m.reused).toHaveLength(1);
    expect(m.added).toHaveLength(0);
    expect(m.collection).toBeNull();
    expect(m.flowData.steps[0].requestId).toBe('req-old');
  });

  it('cùng URL nhưng khác body → tạo mới (không dùng lại sai)', () => {
    const m = mergeReqxImport(
      fileOf([fileReq({ method: 'POST', bodyType: 'json', body: '{"a":1}' })]),
      { 'req-old': existingReq({ method: 'POST', url: 'https://x.test/users', bodyType: 'json', body: '{"a":2}' }) },
    );
    expect(m.reused).toHaveLength(0);
    expect(m.added).toHaveLength(1);
    expect(m.collection).not.toBeNull();
  });

  it('cùng URL nhưng khác header → tạo mới', () => {
    const m = mergeReqxImport(
      fileOf([fileReq({ headers: [kv('X-V', '1')] })]),
      { 'req-old': existingReq({ headers: [kv('X-V', '2')] }) },
    );
    expect(m.added).toHaveLength(1);
  });

  it('request mới đánh dấu origin imported', () => {
    const m = mergeReqxImport(fileOf([fileReq({ url: 'https://x.test/new' })]), {});
    expect(m.requests[0].origin).toBe('imported');
  });
});

describe('parseFlowObject', () => {
  it('nhận object trực tiếp, không cần stringify', () => {
    const reqs = { 'r1': existingReq({ id: 'r1' }) };
    const { data, error } = parseFlowObject({ name: 'F', steps: [{ requestId: 'r1', extract: [] }] }, reqs);
    expect(error).toBeUndefined();
    expect(data?.steps).toHaveLength(1);
  });

  it('requestId lạ → warning + error khi hết step', () => {
    const { error, warnings } = parseFlowObject({ name: 'F', steps: [{ requestId: 'nope', extract: [] }] }, {});
    expect(error).toBeTruthy();
    expect(warnings.length).toBeGreaterThan(0);
  });
});
