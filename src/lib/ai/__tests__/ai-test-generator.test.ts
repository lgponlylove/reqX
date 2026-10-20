import { describe, expect, it } from 'vitest';
import { generateHeuristicTests, generateAiTests } from '../ai-test-generator';
import type { ApiRequest, ApiResponse } from '../../../types/api';

describe('ai-test-generator', () => {
  const sampleReq: ApiRequest = {
    id: 'req1',
    name: 'Get User Detail',
    method: 'GET',
    url: 'https://api.example.com/users/42',
    params: [],
    headers: [],
    bodyType: 'none',
    body: '',
    auth: { type: 'none' },
    collectionId: '',
    updatedAt: 1,
  };

  it('generates heuristic test script for standard JSON response', () => {
    const sampleRes: ApiResponse = {
      status: 200,
      statusText: 'OK',
      timeMs: 120,
      sizeBytes: 150,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'server': 'nginx',
      },
      body: JSON.stringify({
        id: 42,
        name: 'Nguyen Van A',
        active: true,
        roles: ['admin', 'user'],
      }),
    };

    const code = generateHeuristicTests(sampleReq, sampleRes);
    expect(code).toContain('pm.test("Status code is 200"');
    expect(code).toContain('pm.response.to.have.status(200)');
    expect(code).toContain('pm.response.responseTime');
    expect(code).toContain('pm.test("Content-Type header is valid"');
    expect(code).toContain('pm.expect(data).to.be.an("object")');
    expect(code).toContain('pm.expect(data.id).to.exist');
    expect(code).toContain('pm.expect(typeof data.id).to.equal("number")');
    expect(code).toContain('pm.expect(data.active).to.equal(true)');
    expect(code).toContain('pm.expect(data.roles).to.be.an("array")');
  });

  it('generates heuristic test script for JSON array response', () => {
    const sampleRes: ApiResponse = {
      status: 200,
      statusText: 'OK',
      timeMs: 250,
      sizeBytes: 300,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        { id: 1, title: 'Item 1' },
        { id: 2, title: 'Item 2' },
      ]),
    };

    const code = generateHeuristicTests(sampleReq, sampleRes);
    expect(code).toContain('pm.test("Response body is a JSON array"');
    expect(code).toContain('pm.expect(data).to.be.an("array")');
    expect(code).toContain('pm.test("Array item contains expected fields"');
  });

  it('falls back gracefully in generateAiTests when chain is empty', async () => {
    const sampleRes: ApiResponse = {
      status: 201,
      statusText: 'Created',
      timeMs: 180,
      sizeBytes: 50,
      headers: {},
      body: '{"created":true}',
    };

    const result = await generateAiTests(sampleReq, sampleRes);
    expect(result.isAiGenerated).toBe(false);
    expect(result.tests).toContain('pm.response.to.have.status(201)');
  });
});
