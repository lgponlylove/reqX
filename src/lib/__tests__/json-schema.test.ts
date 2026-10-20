import { describe, it, expect } from 'vitest';
import { validateJsonSchema, generateJsonSchema } from '../json-schema';
import { runTests } from '../scripts';
import type { ApiResponse } from '../../types/api';

describe('JSON Schema Validator & Generator', () => {
  it('validates primitive types correctly', () => {
    expect(validateJsonSchema('hello', { type: 'string' }).valid).toBe(true);
    expect(validateJsonSchema(123, { type: 'number' }).valid).toBe(true);
    expect(validateJsonSchema(123, { type: 'integer' }).valid).toBe(true);
    expect(validateJsonSchema(12.34, { type: 'integer' }).valid).toBe(false);
    expect(validateJsonSchema(true, { type: 'boolean' }).valid).toBe(true);
    expect(validateJsonSchema(null, { type: 'null' }).valid).toBe(true);
    expect(validateJsonSchema('123', { type: 'number' }).valid).toBe(false);
  });

  it('validates string formats (email, uuid, date-time)', () => {
    expect(validateJsonSchema('test@example.com', { type: 'string', format: 'email' }).valid).toBe(true);
    expect(validateJsonSchema('invalid-email', { type: 'string', format: 'email' }).valid).toBe(false);

    expect(
      validateJsonSchema('123e4567-e89b-12d3-a456-426614174000', { type: 'string', format: 'uuid' }).valid,
    ).toBe(true);
    expect(validateJsonSchema('not-a-uuid', { type: 'string', format: 'uuid' }).valid).toBe(false);

    expect(validateJsonSchema('2026-10-12T11:00:00Z', { type: 'string', format: 'date-time' }).valid).toBe(true);
  });

  it('validates object properties and required fields', () => {
    const schema = {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
        age: { type: 'number', minimum: 18 },
      },
      additionalProperties: false,
    };

    expect(validateJsonSchema({ id: 1, name: 'Alice', age: 25 }, schema).valid).toBe(true);
    expect(validateJsonSchema({ id: 1 }, schema).valid).toBe(false); // missing 'name'
    expect(validateJsonSchema({ id: '1', name: 'Alice' }, schema).valid).toBe(false); // wrong type id
    expect(validateJsonSchema({ id: 1, name: 'Alice', age: 15 }, schema).valid).toBe(false); // age < minimum
    expect(validateJsonSchema({ id: 1, name: 'Alice', extra: 'bad' }, schema).valid).toBe(false); // additionalProperties
  });

  it('validates array items and nested objects', () => {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        required: ['sku'],
        properties: {
          sku: { type: 'string' },
          price: { type: 'number' },
        },
      },
      minItems: 1,
    };

    expect(validateJsonSchema([{ sku: 'ABC', price: 99 }], schema).valid).toBe(true);
    expect(validateJsonSchema([], schema).valid).toBe(false);
    expect(validateJsonSchema([{ price: 99 }], schema).valid).toBe(false);
  });

  it('generates JSON schema from data and round-trips successfully', () => {
    const payload = {
      id: 101,
      username: 'tester',
      email: 'tester@test.com',
      isActive: true,
      roles: ['admin', 'qa'],
      meta: {
        loginCount: 5,
      },
    };

    const schema = generateJsonSchema(payload);
    expect(schema.type).toBe('object');
    expect(schema.properties.id.type).toBe('integer');
    expect(schema.properties.email.format).toBe('email');
    expect(schema.properties.roles.type).toBe('array');

    // Round-trip validation should pass
    const check = validateJsonSchema(payload, schema);
    expect(check.valid).toBe(true);
    expect(check.errors).toEqual([]);

    // By default, fields are not marked required, avoiding false positive schema fails on optional fields
    expect(schema.required).toBeUndefined();
    const partialPayload = { id: 101, username: 'tester' };
    expect(validateJsonSchema(partialPayload, schema).valid).toBe(true);

    // When markRequired is true, it marks required
    const strictSchema = generateJsonSchema(payload, true, true);
    expect(strictSchema.required).toBeDefined();
    expect(validateJsonSchema(partialPayload, strictSchema).valid).toBe(false);
  });

  it('integrates with pm.response.to.have.jsonSchema in runTests', async () => {
    const mockRes: ApiResponse = {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 0, message: 'Success', data: { userId: 42 } }),
      timeMs: 15,
      sizeBytes: 120,
    };

    const script = `
      pm.test("Status check", () => {
        pm.response.to.have.status(200);
      });
      pm.test("Validate response schema", () => {
        pm.response.to.have.jsonSchema({
          type: "object",
          required: ["code", "message", "data"],
          properties: {
            code: { type: "integer" },
            message: { type: "string" },
            data: {
              type: "object",
              required: ["userId"],
              properties: {
                userId: { type: "integer" }
              }
            }
          }
        });
      });
      pm.test("Match schema helper", () => {
        pm.expect(pm.response.json().data).to.matchSchema({
          type: "object",
          required: ["userId"]
        });
      });
    `;

    const outcome = await runTests(script, mockRes, {
      env: { get: () => undefined, set: () => {} },
      globals: { get: () => undefined, set: () => {} },
      merged: {},
    });

    expect(outcome.error).toBeUndefined();
    expect(outcome.results.length).toBe(3);
    expect(outcome.results.every((r) => r.passed)).toBe(true);
  });

  it('không stack-overflow với schema tự tham chiếu ($ref cycle)', () => {
    const schema: any = {
      type: 'object',
      properties: { node: { $ref: '#/definitions/Tree' } },
      definitions: {
        // Vòng lặp không giảm data: Tree -> allOf -> $ref Tree -> allOf ...
        Tree: { type: 'object', allOf: [{ $ref: '#/definitions/Tree' }] },
      },
    };
    const res = validateJsonSchema({ node: { a: 1 } }, schema);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('chấp nhận schema đệ quy với data hữu hạn', () => {
    const schema: any = {
      type: 'object',
      required: ['v'],
      properties: {
        v: { type: 'integer' },
        next: { $ref: '#' },
      },
    };
    expect(validateJsonSchema({ v: 1, next: { v: 2 } }, schema).valid).toBe(true);
    expect(validateJsonSchema({ v: 1, next: { v: 'x' } }, schema).valid).toBe(false);
  });

  it('fails test when response schema does not match', async () => {
    const mockRes: ApiResponse = {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'wrong-type-code' }),
      timeMs: 15,
      sizeBytes: 30,
    };

    const script = `
      pm.test("Validate Schema Fail", () => {
        pm.response.to.have.jsonSchema({
          type: "object",
          required: ["code"],
          properties: {
            code: { type: "integer" }
          }
        });
      });
    `;

    const outcome = await runTests(script, mockRes, {
      env: { get: () => undefined, set: () => {} },
      globals: { get: () => undefined, set: () => {} },
      merged: {},
    });

    expect(outcome.results.length).toBe(1);
    expect(outcome.results[0].passed).toBe(false);
    expect(outcome.results[0].error).toContain('JSON Schema assertion failed');
  });
});
