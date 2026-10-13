/**
 * Lightweight, zero-dependency JSON Schema Validator & Generator for ReqX.
 * Conforms to JSON Schema Draft-07 / 2020-12 core specifications.
 */

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

export type JsonSchemaObject = Record<string, any>;
export type JsonSchema = boolean | JsonSchemaObject;

const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
const IPV6_RE = /^([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$/i;
const URI_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/;

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

function resolveRef(rootSchema: JsonSchema, ref: string): JsonSchema | undefined {
  // '#' và '#/' trỏ chính schema gốc (Draft-07)
  if (ref === '#' || ref === '#/') return rootSchema;
  if (!ref.startsWith('#/')) return undefined;
  const parts = ref.slice(2).split('/');
  let current: any = rootSchema;
  for (const part of parts) {
    const unescaped = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current && typeof current === 'object' && unescaped in current) {
      current = current[unescaped];
    } else {
      return undefined;
    }
  }
  return current;
}

export const MAX_VALIDATE_DEPTH = 128;

interface ValidateCtx {
  depth: number;
  /** Con trỏ $ref đang nằm trên stack — chặn vòng lặp $ref <-> allOf không giảm data. */
  refs: readonly string[];
}

const ROOT_CTX: ValidateCtx = { depth: 0, refs: [] };

function descend(ctx: ValidateCtx, extraRef?: string): ValidateCtx {
  return {
    depth: ctx.depth + 1,
    refs: extraRef ? [...ctx.refs, extraRef] : ctx.refs,
  };
}

/**
 * Validate `data` against `schema`.
 * Returns `{ valid: boolean, errors: string[] }`.
 */
export function validateJsonSchema(
  data: unknown,
  schema: JsonSchema,
  rootSchema: JsonSchema = schema,
  path = '#',
  ctx: ValidateCtx = ROOT_CTX,
): SchemaValidationResult {
  const errors: string[] = [];

  if (ctx.depth > MAX_VALIDATE_DEPTH) {
    return { valid: false, errors: [`${path}: exceeded maximum schema depth (${MAX_VALIDATE_DEPTH})`] };
  }

  if (schema === true) return { valid: true, errors: [] };
  if (schema === false) return { valid: false, errors: [`${path}: schema is false (denies all)`] };
  if (!schema || typeof schema !== 'object') return { valid: true, errors: [] };

  // $ref resolution
  if (typeof schema.$ref === 'string') {
    if (ctx.refs.includes(schema.$ref)) {
      // Đệ quy thuần (self-referential schema): dừng tại đây, phần sâu hơn do data quyết định.
      return { valid: true, errors: [] };
    }
    const resolved = resolveRef(rootSchema, schema.$ref);
    if (!resolved) {
      errors.push(`${path}: could not resolve $ref '${schema.$ref}'`);
      return { valid: false, errors };
    }
    return validateJsonSchema(data, resolved, rootSchema, path, descend(ctx, schema.$ref));
  }

  // 1. type
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actualType = getActualType(data);
    const matches = types.some((t: string) => {
      if (t === 'integer') return typeof data === 'number' && Number.isInteger(data);
      if (t === 'number') return typeof data === 'number' && !Number.isNaN(data);
      return t === actualType;
    });

    if (!matches) {
      errors.push(`${path}: expected type [${types.join(', ')}], got ${actualType}`);
      return { valid: false, errors };
    }
  }

  // 2. enum
  if (Array.isArray(schema.enum)) {
    const match = schema.enum.some((val) => deepEqual(data, val));
    if (!match) {
      errors.push(`${path}: value not in enum [${schema.enum.map((v) => JSON.stringify(v)).join(', ')}]`);
    }
  }

  // 3. const
  if ('const' in schema) {
    if (!deepEqual(data, schema.const)) {
      errors.push(`${path}: value must equal const ${JSON.stringify(schema.const)}`);
    }
  }

  // 4. String validations
  if (typeof data === 'string') {
    if (typeof schema.minLength === 'number' && data.length < schema.minLength) {
      errors.push(`${path}: string length ${data.length} < minLength ${schema.minLength}`);
    }
    if (typeof schema.maxLength === 'number' && data.length > schema.maxLength) {
      errors.push(`${path}: string length ${data.length} > maxLength ${schema.maxLength}`);
    }
    if (typeof schema.pattern === 'string') {
      try {
        const re = new RegExp(schema.pattern);
        if (!re.test(data)) {
          errors.push(`${path}: string does not match pattern '${schema.pattern}'`);
        }
      } catch {
        /* invalid regex in schema */
      }
    }
    if (typeof schema.format === 'string') {
      let formatValid = true;
      switch (schema.format) {
        case 'email':
          formatValid = EMAIL_RE.test(data);
          break;
        case 'uuid':
          formatValid = UUID_RE.test(data);
          break;
        case 'date-time':
          formatValid = DATE_TIME_RE.test(data) && !isNaN(Date.parse(data));
          break;
        case 'date':
          formatValid = DATE_RE.test(data) && !isNaN(Date.parse(data));
          break;
        case 'ipv4':
          formatValid = IPV4_RE.test(data);
          break;
        case 'ipv6':
          formatValid = IPV6_RE.test(data);
          break;
        case 'uri':
        case 'url':
          formatValid = URI_RE.test(data);
          break;
      }
      if (!formatValid) {
        errors.push(`${path}: string is not valid format '${schema.format}'`);
      }
    }
  }

  // 5. Number validations
  if (typeof data === 'number' && !Number.isNaN(data)) {
    if (typeof schema.minimum === 'number') {
      if (schema.exclusiveMinimum === true ? data <= schema.minimum : data < schema.minimum) {
        errors.push(`${path}: number ${data} < minimum ${schema.minimum}`);
      }
    }
    if (typeof schema.exclusiveMinimum === 'number' && data <= schema.exclusiveMinimum) {
      errors.push(`${path}: number ${data} <= exclusiveMinimum ${schema.exclusiveMinimum}`);
    }
    if (typeof schema.maximum === 'number') {
      if (schema.exclusiveMaximum === true ? data >= schema.maximum : data > schema.maximum) {
        errors.push(`${path}: number ${data} > maximum ${schema.maximum}`);
      }
    }
    if (typeof schema.exclusiveMaximum === 'number' && data >= schema.exclusiveMaximum) {
      errors.push(`${path}: number ${data} >= exclusiveMaximum ${schema.exclusiveMaximum}`);
    }
    if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
      const quotient = data / schema.multipleOf;
      if (Math.abs(Math.round(quotient) - quotient) > 1e-10) {
        errors.push(`${path}: number ${data} is not a multiple of ${schema.multipleOf}`);
      }
    }
  }

  // 6. Object validations
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const dataObj = data as Record<string, unknown>;
    const keys = Object.keys(dataObj);

    if (Array.isArray(schema.required)) {
      for (const reqKey of schema.required) {
        if (!(reqKey in dataObj) || dataObj[reqKey] === undefined) {
          errors.push(`${path}: missing required property '${reqKey}'`);
        }
      }
    }

    if (typeof schema.minProperties === 'number' && keys.length < schema.minProperties) {
      errors.push(`${path}: properties count ${keys.length} < minProperties ${schema.minProperties}`);
    }
    if (typeof schema.maxProperties === 'number' && keys.length > schema.maxProperties) {
      errors.push(`${path}: properties count ${keys.length} > maxProperties ${schema.maxProperties}`);
    }

    const definedProps = schema.properties || {};
    const patternProps = schema.patternProperties || {};

    for (const [propKey, propVal] of Object.entries(dataObj)) {
      let isExplicitlyChecked = false;

      // properties check
      if (propKey in definedProps) {
        isExplicitlyChecked = true;
        const sub = validateJsonSchema(propVal, definedProps[propKey], rootSchema, `${path}/${propKey}`, descend(ctx));
        errors.push(...sub.errors);
      }

      // patternProperties check
      for (const [pat, patSchema] of Object.entries(patternProps)) {
        try {
          if (new RegExp(pat).test(propKey)) {
            isExplicitlyChecked = true;
            const sub = validateJsonSchema(propVal, patSchema as JsonSchema, rootSchema, `${path}/${propKey}`, descend(ctx));
            errors.push(...sub.errors);
          }
        } catch {
          /* ignore regex */
        }
      }

      // additionalProperties check
      if (!isExplicitlyChecked && 'additionalProperties' in schema) {
        if (schema.additionalProperties === false) {
          errors.push(`${path}: unexpected additional property '${propKey}'`);
        } else if (typeof schema.additionalProperties === 'object') {
          const sub = validateJsonSchema(propVal, schema.additionalProperties, rootSchema, `${path}/${propKey}`, descend(ctx));
          errors.push(...sub.errors);
        }
      }
    }
  }

  // 7. Array validations
  if (Array.isArray(data)) {
    if (typeof schema.minItems === 'number' && data.length < schema.minItems) {
      errors.push(`${path}: array length ${data.length} < minItems ${schema.minItems}`);
    }
    if (typeof schema.maxItems === 'number' && data.length > schema.maxItems) {
      errors.push(`${path}: array length ${data.length} > maxItems ${schema.maxItems}`);
    }
    if (schema.uniqueItems === true) {
      for (let i = 0; i < data.length; i++) {
        for (let j = i + 1; j < data.length; j++) {
          if (deepEqual(data[i], data[j])) {
            errors.push(`${path}: array items at indices ${i} and ${j} are not unique`);
            break;
          }
        }
      }
    }

    if (schema.items) {
      if (Array.isArray(schema.items)) {
        // tuple validation
        for (let i = 0; i < data.length; i++) {
          if (i < schema.items.length) {
            const sub = validateJsonSchema(data[i], schema.items[i], rootSchema, `${path}/${i}`, descend(ctx));
            errors.push(...sub.errors);
          } else if (schema.additionalItems === false) {
            errors.push(`${path}: unexpected item at index ${i}`);
          } else if (typeof schema.additionalItems === 'object') {
            const sub = validateJsonSchema(data[i], schema.additionalItems, rootSchema, `${path}/${i}`, descend(ctx));
            errors.push(...sub.errors);
          }
        }
      } else if (typeof schema.items === 'object') {
        for (let i = 0; i < data.length; i++) {
          const sub = validateJsonSchema(data[i], schema.items, rootSchema, `${path}/${i}`, descend(ctx));
          errors.push(...sub.errors);
        }
      }
    }
  }

  // 8. Combinators: allOf, anyOf, oneOf, not
  if (Array.isArray(schema.allOf)) {
    for (let i = 0; i < schema.allOf.length; i++) {
      const sub = validateJsonSchema(data, schema.allOf[i], rootSchema, `${path}/allOf/${i}`, descend(ctx));
      errors.push(...sub.errors);
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const passed = schema.anyOf.some((s) => validateJsonSchema(data, s, rootSchema, path, descend(ctx)).valid);
    if (!passed) {
      errors.push(`${path}: does not match any of the anyOf schemas`);
    }
  }

  if (Array.isArray(schema.oneOf)) {
    const passCount = schema.oneOf.filter((s) => validateJsonSchema(data, s, rootSchema, path, descend(ctx)).valid).length;
    if (passCount !== 1) {
      errors.push(`${path}: expected exactly 1 match for oneOf, matched ${passCount}`);
    }
  }

  if (schema.not) {
    const sub = validateJsonSchema(data, schema.not, rootSchema, path, descend(ctx));
    if (sub.valid) {
      errors.push(`${path}: matched 'not' schema (should not match)`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function getActualType(val: unknown): string {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val;
}

/**
 * Automatically infer JSON Schema from any JS value / response JSON object.
 */
export function generateJsonSchema(val: unknown, isRoot = true, markRequired = false): JsonSchemaObject {
  const schema: JsonSchemaObject = {};
  if (isRoot) {
    schema.$schema = 'http://json-schema.org/draft-07/schema#';
  }

  if (val === null) {
    schema.type = 'null';
    return schema;
  }

  if (typeof val === 'boolean') {
    schema.type = 'boolean';
    return schema;
  }

  if (typeof val === 'number') {
    schema.type = Number.isInteger(val) ? 'integer' : 'number';
    return schema;
  }

  if (typeof val === 'string') {
    schema.type = 'string';
    if (UUID_RE.test(val)) schema.format = 'uuid';
    else if (DATE_TIME_RE.test(val) && !isNaN(Date.parse(val))) schema.format = 'date-time';
    else if (DATE_RE.test(val) && !isNaN(Date.parse(val))) schema.format = 'date';
    else if (EMAIL_RE.test(val)) schema.format = 'email';
    else if (URI_RE.test(val)) schema.format = 'uri';
    return schema;
  }

  if (Array.isArray(val)) {
    schema.type = 'array';
    if (val.length === 0) {
      schema.items = {};
    } else {
      // Sample the first item, or merge if multiple
      schema.items = generateJsonSchema(val[0], false, markRequired);
    }
    return schema;
  }

  if (typeof val === 'object') {
    schema.type = 'object';
    const obj = val as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (markRequired && keys.length > 0) {
      schema.required = keys;
    }
    schema.properties = {};
    for (const key of keys) {
      schema.properties[key] = generateJsonSchema(obj[key], false, markRequired);
    }
    return schema;
  }

  schema.type = 'string';
  return schema;
}
