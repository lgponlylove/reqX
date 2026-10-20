import { describe, it, expect } from 'vitest';
import { importOpenApiSpec, isOpenApiSpec, parseYamlOrJson } from '../openapi-import';

describe('Swagger / OpenAPI Import Engine', () => {
  it('detects OpenAPI and Swagger specs correctly', () => {
    expect(isOpenApiSpec({ openapi: '3.0.1', paths: {} })).toBe(true);
    expect(isOpenApiSpec({ swagger: '2.0', paths: {} })).toBe(true);
    expect(isOpenApiSpec({ paths: { '/users': {} } })).toBe(true);
    expect(isOpenApiSpec({ info: { title: 'Not OpenAPI' } })).toBe(false);
  });

  it('parses OpenAPI 3.0 spec with servers, tags, parameters, and requestBody', () => {
    const spec = {
      openapi: '3.0.0',
      info: {
        title: 'Customer API',
        version: '1.0.0',
        description: 'Customer management service',
      },
      servers: [{ url: 'https://api.example.com/v1' }],
      paths: {
        '/customers': {
          get: {
            summary: 'List customers',
            tags: ['Customers'],
            parameters: [
              { name: 'limit', in: 'query', required: false, schema: { default: 20 } },
              { name: 'Authorization', in: 'header', required: true },
            ],
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
                    },
                  },
                },
              },
            },
          },
          post: {
            summary: 'Create customer',
            tags: ['Customers'],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['name', 'email'],
                    properties: {
                      name: { type: 'string', example: 'Bob' },
                      email: { type: 'string', format: 'email' },
                    },
                  },
                },
              },
            },
            responses: {
              '201': { description: 'Created' },
            },
          },
        },
      },
    };

    const result = importOpenApiSpec(spec);
    expect(result.collection.name).toBe('Customer API');
    expect(result.collection.folders.length).toBe(1);
    expect(result.collection.folders[0].name).toBe('Customers');
    expect(result.requests.length).toBe(2);

    const getReq = result.requests.find((r) => r.method === 'GET');
    expect(getReq).toBeDefined();
    expect(getReq!.url).toBe('https://api.example.com/v1/customers');
    expect(getReq!.params.some((p) => p.key === 'limit')).toBe(true);
    expect(getReq!.headers.some((h) => h.key === 'Authorization')).toBe(true);
    expect(getReq!.tests).toContain('pm.response.to.have.jsonSchema');

    const postReq = result.requests.find((r) => r.method === 'POST');
    expect(postReq).toBeDefined();
    expect(postReq!.bodyType).toBe('raw');
    expect(postReq!.body).toContain('"name"');
    expect(postReq!.tests).toContain('Status code is 201');
  });

  it('parses Swagger 2.0 spec with host, basePath, and body parameters', () => {
    const swagger = {
      swagger: '2.0',
      info: { title: 'Legacy Petstore', version: '2.0' },
      host: 'petstore.swagger.io',
      basePath: '/v2',
      schemes: ['https'],
      paths: {
        '/pet/{petId}': {
          get: {
            summary: 'Find pet by ID',
            tags: ['pet'],
            parameters: [{ name: 'petId', in: 'path', required: true }],
            responses: {
              '200': { description: 'successful operation' },
            },
          },
        },
      },
    };

    const result = importOpenApiSpec(swagger);
    expect(result.collection.name).toBe('Legacy Petstore');
    expect(result.requests.length).toBe(1);
    expect(result.requests[0].url).toBe('https://petstore.swagger.io/v2/pet/:petId');
    expect(result.collection.folders[0].name).toBe('pet');
  });

  it('parses YAML text to JSON structure', () => {
    const yaml = `
openapi: 3.0.0
info:
  title: Test YAML API
  version: 1.0.0
paths:
  /ping:
    get:
      summary: Health check
`;

    const parsed: any = parseYamlOrJson(yaml);
    expect(parsed.openapi).toBe('3.0.0');
    expect(parsed.info?.title).toBe('Test YAML API');
    expect(parsed.paths?.['/ping']?.get?.summary).toBe('Health check');

    const result = importOpenApiSpec(parsed);
    expect(result.collection.name).toBe('Test YAML API');
    expect(result.requests[0].name).toBe('Health check');
  });

  it('resolves $ref in requestBody and response schema, and leaves optional params disabled', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Ref API', version: '1.0' },
      paths: {
        '/users': {
          post: {
            summary: 'Create User',
            parameters: [
              { name: 'notify', in: 'query', required: false },
              { name: 'X-App-Id', in: 'header', required: true },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/UserCreate' },
                },
              },
            },
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/UserResponse' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          UserCreate: {
            type: 'object',
            properties: {
              username: { type: 'string', example: 'alex' },
              email: { type: 'string', format: 'email' },
            },
          },
          UserResponse: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              username: { type: 'string' },
            },
          },
        },
      },
    };

    const res = importOpenApiSpec(spec);
    const req = res.requests[0];
    expect(req).toBeDefined();

    // Verify parameter enabled logic: optional is false, required is true
    const notifyParam = req.params.find((p) => p.key === 'notify');
    expect(notifyParam?.enabled).toBe(false);

    const appIdHeader = req.headers.find((h) => h.key === 'X-App-Id');
    expect(appIdHeader?.enabled).toBe(true);

    // Verify requestBody $ref resolution: not empty {}
    expect(req.body).toContain('"username": "alex"');
    expect(req.body).toContain('"email"');

    // Verify response schema $ref resolution: dereferenced in test
    expect(req.tests).toContain('"type": "object"');
    expect(req.tests).toContain('"id"');
    expect(req.tests).not.toContain('#/components/schemas/UserResponse');
  });

  it('điền giá trị path param có example/default, giữ :param khi thiếu và cảnh báo', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Pets', version: '1' },
      servers: [{ url: 'https://api.pets.dev/v1' }],
      paths: {
        '/pet/{petId}/photo/{tag}': {
          get: {
            summary: 'Photo',
            parameters: [
              { name: 'petId', in: 'path', required: true, example: '42' },
              { name: 'tag', in: 'path', required: true, schema: { default: 'cover' } },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
        '/owner/{oid}': {
          get: {
            summary: 'Owner',
            parameters: [{ name: 'oid', in: 'path', required: true }],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    };

    const res = importOpenApiSpec(spec);
    expect(res.requests.find((r) => r.name === 'Photo')?.url).toBe('https://api.pets.dev/v1/pet/42/photo/cover');
    expect(res.requests.find((r) => r.name === 'Owner')?.url).toBe('https://api.pets.dev/v1/owner/:oid');
    expect(res.warnings.some((w) => w.includes('oid'))).toBe(true);
    expect(res.requests.every((r) => r.origin === 'imported')).toBe(true);
  });

  it('cảnh báo khi body không phải JSON và spec không có base URL', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Forms', version: '1' },
      paths: {
        '/upload': {
          post: {
            summary: 'Upload',
            requestBody: { content: { 'multipart/form-data': { schema: { type: 'object' } } } },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    };
    const res = importOpenApiSpec(spec);
    expect(res.requests[0].bodyType).toBe('none');
    expect(res.warnings.some((w) => w.includes('multipart/form-data'))).toBe(true);
    expect(res.warnings.some((w) => w.includes('servers'))).toBe(true);
  });

  it('parse block scalar | và > trong YAML', () => {
    const yaml = `
openapi: 3.0.0
info:
  title: Block API
  description: |
    Dòng 1
    Dòng 2
paths:
  /x:
    get:
      summary: Folded
      description: >
        alpha
        beta
`;
    const parsed: any = parseYamlOrJson(yaml);
    expect(parsed.info.description).toBe('Dòng 1\nDòng 2');
    expect(parsed.paths['/x'].get.description).toBe('alpha beta');
    expect(parsed.paths['/x'].get.summary).toBe('Folded');
  });
});
