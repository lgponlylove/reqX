import { describe, expect, it } from 'vitest';
import {
  requestToYaml,
  yamlToRequest,
  exportCollectionToGitFiles,
  importCollectionFromGitFiles,
  exportCollectionToZip,
  importCollectionFromZip,
} from '../git-collection';
import type { ApiRequest, Collection } from '../../types/api';

describe('git-collection plain-text YAML & directory structure', () => {
  const req1: ApiRequest = {
    id: 'r1',
    name: 'Login User',
    method: 'POST',
    url: '{{baseUrl}}/api/login',
    params: [{ id: 'p1', key: 'ref', value: 'google', enabled: true }],
    headers: [{ id: 'h1', key: 'Content-Type', value: 'application/json', enabled: true }],
    bodyType: 'json',
    body: '{\n  "email": "test@example.com",\n  "password": "secret"\n}',
    auth: { type: 'bearer', token: '{{token}}' },
    preRequest: '// pre script\npm.environment.set("ts", Date.now());',
    tests: 'pm.test("Status 200", () => { pm.response.to.have.status(200); });',
    collectionId: 'c1',
    updatedAt: 1,
  };

  const col1: Collection = {
    id: 'c1',
    name: 'E-Commerce API',
    description: 'Production collection',
    auth: { type: 'none' },
    rootRequestIds: ['r1'],
    folders: [
      {
        id: 'f1',
        name: 'Orders',
        requestIds: ['r2'],
        folderIds: [],
      },
    ],
  };

  const req2: ApiRequest = {
    id: 'r2',
    name: 'Create Order',
    method: 'POST',
    url: '{{baseUrl}}/api/orders',
    params: [],
    headers: [{ id: 'h2', key: 'Content-Type', value: 'application/json', enabled: true }],
    bodyType: 'json',
    body: '{"item":"Book","amount":10}',
    auth: { type: 'none' },
    collectionId: 'c1',
    updatedAt: 1,
  };

  it('serializes ApiRequest to clean YAML and deserializes back faithfully', () => {
    const yamlStr = requestToYaml(req1);
    expect(yamlStr).toContain('name: Login User');
    expect(yamlStr).toContain('method: POST');
    expect(yamlStr).toContain("url: '{{baseUrl}}/api/login'");
    expect(yamlStr).toContain('type: json');
    expect(yamlStr).toContain('type: bearer');

    const deserialized = yamlToRequest(yamlStr, 'c1');
    expect(deserialized.name).toBe(req1.name);
    expect(deserialized.method).toBe('POST');
    expect(deserialized.url).toBe(req1.url);
    expect(deserialized.bodyType).toBe('json');
    expect(deserialized.auth.type).toBe('bearer');
    expect(deserialized.headers).toHaveLength(1);
    expect(deserialized.params).toHaveLength(1);
    expect(deserialized.preRequest).toContain('pm.environment.set');
    expect(deserialized.tests).toContain('pm.response.to.have.status(200)');
  });

  it('exports collection into a clean directory tree of virtual files', () => {
    const files = exportCollectionToGitFiles(col1, [req1, req2]);
    expect(files.some((f) => f.path === 'collection.yaml')).toBe(true);
    expect(files.some((f) => f.path === 'Login User.reqx.yaml')).toBe(true);
    expect(files.some((f) => f.path === '/Orders/Create Order.reqx.yaml')).toBe(true);
  });

  it('roundtrips a collection through ZIP export and ZIP import', async () => {
    const zipBlob = await exportCollectionToZip(col1, [req1, req2]);
    expect(zipBlob.size).toBeGreaterThan(0);

    const arrayBuffer = await zipBlob.arrayBuffer();
    const imported = await importCollectionFromZip(arrayBuffer);

    expect(imported.collection.name).toBe('E-Commerce API');
    expect(imported.collection.folders).toHaveLength(1);
    expect(imported.collection.folders[0].name).toBe('Orders');
    expect(imported.requests).toHaveLength(2);

    const loginReq = imported.requests.find((r) => r.name === 'Login User');
    const orderReq = imported.requests.find((r) => r.name === 'Create Order');

    expect(loginReq).toBeDefined();
    expect(orderReq).toBeDefined();
    expect(loginReq?.method).toBe('POST');
    expect(loginReq?.bodyType).toBe('json');
    expect(orderReq?.url).toBe('{{baseUrl}}/api/orders');
  });
});
