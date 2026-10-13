import type { ApiRequest, Collection, Folder, KeyValue } from '../types/api';
import { uid } from './variables';

export interface OpenApiImportResult {
  collection: Collection;
  requests: ApiRequest[];
  warnings: string[];
}

/** Check if an object appears to be an OpenAPI 3.x or Swagger 2.0 specification. */
export function isOpenApiSpec(spec: unknown): boolean {
  if (!spec || typeof spec !== 'object') return false;
  const s = spec as Record<string, unknown>;
  return (
    (typeof s.openapi === 'string' && s.openapi.startsWith('3.')) ||
    s.swagger === '2.0' ||
    (s.paths !== undefined && typeof s.paths === 'object')
  );
}

/**
 * Resolves a JSON Pointer reference (e.g. '#/components/schemas/Pet' or '#/definitions/Pet') within spec.
 */
export function resolveRef(spec: any, ref: string): any {
  if (!spec || !ref || typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let curr = spec;
  for (const part of parts) {
    if (curr == null || typeof curr !== 'object') return null;
    curr = curr[part];
  }
  return curr;
}

/**
 * Deeply dereferences a schema so that any $ref is resolved inline.
 * Handles circular references safely using a Set.
 */
export function dereferenceSchema(schema: any, rootSpec: any, seen = new Set<string>()): any {
  if (!schema || typeof schema !== 'object') return schema;

  if (typeof schema.$ref === 'string') {
    const refStr = schema.$ref;
    if (seen.has(refStr)) {
      return { type: 'object', description: `[Circular Reference: ${refStr}]` };
    }
    const resolved = resolveRef(rootSpec, refStr);
    if (resolved && typeof resolved === 'object') {
      const nextSeen = new Set(seen);
      nextSeen.add(refStr);
      const merged = { ...resolved, ...schema };
      delete merged.$ref;
      return dereferenceSchema(merged, rootSpec, nextSeen);
    }
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map((item) => dereferenceSchema(item, rootSpec, seen));
  }

  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(schema)) {
    out[k] = dereferenceSchema(v, rootSpec, seen);
  }
  return out;
}

/**
 * Generate a dummy sample value from a JSON/OpenAPI schema.
 */
export function sampleFromSchema(schema: any, rootSpec?: any, depth = 0): any {
  if (!schema || typeof schema !== 'object' || depth > 8) return 'value';

  if (schema.$ref && rootSpec) {
    const resolved = resolveRef(rootSpec, schema.$ref);
    if (resolved) return sampleFromSchema(resolved, rootSpec, depth + 1);
  }

  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  // Handle allOf
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const merged: Record<string, any> = {};
    for (const sub of schema.allOf) {
      const s = sampleFromSchema(sub, rootSpec, depth + 1);
      if (s && typeof s === 'object' && !Array.isArray(s)) {
        Object.assign(merged, s);
      }
    }
    return merged;
  }

  const type = schema.type;
  if (type === 'string') {
    if (schema.format === 'email') return 'user@example.com';
    if (schema.format === 'uuid') return '123e4567-e89b-12d3-a456-426614174000';
    if (schema.format === 'date-time') return new Date().toISOString();
    if (schema.format === 'date') return new Date().toISOString().split('T')[0];
    if (schema.format === 'uri' || schema.format === 'url') return 'https://example.com';
    return 'string';
  }
  if (type === 'integer' || type === 'number') {
    return typeof schema.minimum === 'number' ? schema.minimum : 0;
  }
  if (type === 'boolean') {
    return true;
  }
  if (type === 'array') {
    return schema.items ? [sampleFromSchema(schema.items, rootSpec, depth + 1)] : [];
  }
  if (type === 'object' || schema.properties) {
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(schema.properties || {})) {
      res[k] = sampleFromSchema(v, rootSpec, depth + 1);
    }
    return res;
  }
  return {};
}

/**
 * Lightweight, zero-dependency YAML to JS object parser.
 * Handles YAML subsets used in OpenAPI/Swagger specs.
 */
export function parseYamlOrJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }

  // Basic YAML Parser for OpenAPI
  const lines = text.split(/\r?\n/);
  const root: any = {};
  const stack: { indent: number; obj: any; key?: string }[] = [{ indent: -1, obj: root }];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const rawLine = lines[lineIndex];
    // Strip comments
    const commentIdx = rawLine.indexOf('#');
    const line = (commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine).replace(/\s+$/, '');
    if (!line.trim()) continue;

    const indent = line.search(/\S/);
    const content = line.trim();

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const currentContainer = stack[stack.length - 1].obj;

    // List item: - item or - key: value
    if (content.startsWith('-')) {
      const itemContent = content.slice(1).trim();
      let parentArr = currentContainer;
      if (!Array.isArray(parentArr)) {
        const lastKey = stack[stack.length - 1].key;
        if (lastKey && !Array.isArray(parentArr[lastKey])) {
          parentArr[lastKey] = [];
          stack.push({ indent, obj: parentArr[lastKey] });
          parentArr = parentArr[lastKey];
        }
      }

      if (itemContent.includes(':')) {
        const colon = itemContent.indexOf(':');
        const k = itemContent.slice(0, colon).trim().replace(/^['"]|['"]$/g, '');
        const v = itemContent.slice(colon + 1).trim();
        const newObj: any = { [k]: parseYamlValue(v) };
        if (Array.isArray(parentArr)) parentArr.push(newObj);
        stack.push({ indent: indent + 2, obj: newObj });
      } else {
        if (Array.isArray(parentArr)) {
          parentArr.push(parseYamlValue(itemContent));
        }
      }
      continue;
    }

    // Key-value pair: key: value or key:
    const colonIdx = content.indexOf(':');
    if (colonIdx > 0) {
      const k = content.slice(0, colonIdx).trim().replace(/^['"]|['"]$/g, '');
      const v = content.slice(colonIdx + 1).trim();

      // Block scalar: |, |-, |+, >, >-, >+ → chuỗi nhiều dòng (description, example text)
      const block = /^([|>])([+-]?)[0-9]*$/.exec(v);
      if (block) {
        const blockLines: string[] = [];
        let blockIndent = -1;
        while (lineIndex + 1 < lines.length) {
          const next = lines[lineIndex + 1];
          if (!next.trim()) {
            blockLines.push('');
            lineIndex++;
            continue;
          }
          const ni = next.search(/\S/);
          if (ni <= indent) break;
          if (blockIndent < 0) blockIndent = ni;
          blockLines.push(next);
          lineIndex++;
        }
        const dedented = blockIndent < 0
          ? []
          : blockLines.map((l) => (l.length > blockIndent ? l.slice(blockIndent) : ''));
        let text: string;
        if (block[1] === '|') {
          text = dedented.join('\n');
        } else {
          // folded '>': dòng liền kề nối bằng dấu cách, dòng trống vẫn xuống dòng
          text = dedented.reduce((acc, cur) => {
            if (!acc) return cur;
            if (!cur) return `${acc}\n`;
            if (acc.endsWith('\n') || /^\s/.test(cur)) return `${acc}\n${cur}`;
            return `${acc} ${cur}`;
          }, '');
        }
        if (block[2] !== '+') text = text.replace(/\s+$/, '');
        if (Array.isArray(currentContainer)) {
          currentContainer.push({ [k]: text });
        } else {
          currentContainer[k] = text;
        }
        continue;
      }

      if (v === '') {
        const newObj: any = {};
        if (Array.isArray(currentContainer)) {
          currentContainer.push(newObj);
        } else {
          currentContainer[k] = newObj;
        }
        stack.push({ indent, obj: newObj, key: k });
      } else {
        const val = parseYamlValue(v);
        if (Array.isArray(currentContainer)) {
          currentContainer.push({ [k]: val });
        } else {
          currentContainer[k] = val;
        }
      }
    }
  }

  return root;
}

function parseYamlValue(v: string): any {
  if (v === 'true' || v === 'True') return true;
  if (v === 'false' || v === 'False') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  // Remove wrapping quotes
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Parse an OpenAPI 3.x or Swagger 2.0 object into ReqX Collection and ApiRequests.
 */
export function importOpenApiSpec(spec: any, fallbackName = 'OpenAPI Collection'): OpenApiImportResult {
  const rawWarnings: string[] = [];
  const seenWarnings = new Set<string>();
  const warn = (msg: string) => {
    if (seenWarnings.has(msg)) return;
    seenWarnings.add(msg);
    rawWarnings.push(msg);
  };
  const title = spec.info?.title || fallbackName;
  const description = spec.info?.description || '';

  // Determine Base URL
  let baseUrl = '';
  if (Array.isArray(spec.servers) && spec.servers.length > 0) {
    // OpenAPI 3.x
    const srv = spec.servers[0];
    baseUrl = srv.url || '';
    baseUrl = baseUrl.replace(/\{([^}]+)\}/g, (m, name) => {
      const def = srv.variables?.[name]?.default;
      return def !== undefined ? String(def) : m;
    });
    if (/\{[^}]+\}/.test(baseUrl)) warn(`Server URL còn biến chưa có default: ${baseUrl} — điền base URL thủ công.`);
    if (spec.servers.length > 1) warn(`Spec khai báo ${spec.servers.length} server — chỉ dùng server đầu tiên (${baseUrl}).`);
  } else if (spec.host) {
    // Swagger 2.0
    const scheme = Array.isArray(spec.schemes) && spec.schemes.length > 0 ? spec.schemes[0] : 'https';
    baseUrl = `${scheme}://${spec.host}${spec.basePath || ''}`;
  } else {
    warn('Spec không có servers/host — URL tạo ra chỉ là đường dẫn, phải tự điền base URL.');
  }

  if (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }

  const collectionId = uid('col');
  const collection: Collection = {
    id: collectionId,
    name: title,
    folders: [],
    rootRequestIds: [],
  };

  const requests: ApiRequest[] = [];
  const folderMap = new Map<string, Folder>();
  let needsAuthCount = 0;

  const paths = spec.paths || {};
  const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'] as const;

  for (const [pathStr, pathItem] of Object.entries<any>(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    if (!httpMethods.some((m) => pathItem[m] && typeof pathItem[m] === 'object')) {
      warn(`Đường dẫn ${pathStr} không có operation HTTP nào — bỏ qua.`);
      continue;
    }

    // Common parameters at path level
    const commonParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const method of httpMethods) {
      const op = pathItem[method];
      if (!op || typeof op !== 'object') continue;

      const allParams = [...commonParams, ...(Array.isArray(op.parameters) ? op.parameters : [])];

      // Request name
      const reqName = op.summary || op.operationId || `${method.toUpperCase()} ${pathStr}`;
      const reqDesc = op.description || op.summary || '';

      // URL parameters and headers
      const queryParams: KeyValue[] = [];
      const headers: KeyValue[] = [];
      /** in:'path' — tên và giá trị mẫu để thay vào URL */
      const pathParams = new Map<string, string>();

      for (let p of allParams) {
        if (!p || typeof p !== 'object') continue;
        if (p.$ref && typeof p.$ref === 'string') {
          const derefed = resolveRef(spec, p.$ref);
          if (!derefed) warn(`${reqName}: không phân giải được $ref "${p.$ref}" của parameter — bỏ qua tham số.`);
          p = derefed || p;
        }
        const paramName = p.name || '';
        const paramVal =
          p.example !== undefined ? String(p.example)
          : p.schema?.example !== undefined ? String(p.schema.example)
          : p.schema?.default !== undefined ? String(p.schema.default)
          : p.defaultValue !== undefined ? String(p.defaultValue)
          : '';

        if (p.in === 'query') {
          queryParams.push({
            id: uid('kv'),
            key: paramName,
            value: paramVal,
            enabled: p.required === true,
          });
        } else if (p.in === 'header') {
          headers.push({
            id: uid('kv'),
            key: paramName,
            value: paramVal,
            enabled: p.required === true,
          });
        } else if (p.in === 'path') {
          pathParams.set(paramName, paramVal);
          if (!paramVal && p.schema?.enum?.length) pathParams.set(paramName, String(p.schema.enum[0]));
        } else if (p.in === 'cookie') {
          warn(`${reqName}: tham số cookie "${paramName}" không import được — gửi request rồi trình duyệt tự quản cookie.`);
        } else if (p.in === 'formData') {
          warn(`${reqName}: tham số formData "${paramName}" (Swagger 2.0) — chuyển sang tự điền body form-urlencoded.`);
        }
      }

      const missingPathVars = [...pathParams.entries()].filter(([, v]) => !v).map(([k]) => k);
      const placeholderVars = (pathStr.match(/\{([^}]+)\}/g) || [])
        .map((s) => s.slice(1, -1))
        .filter((n) => !pathParams.has(n));
      if (placeholderVars.length) {
        warn(`${reqName}: URL có {${placeholderVars.join(', ')}} nhưng spec không khai báo parameter tương ứng.`);
      }

      // Request body
      let bodyStr = '';
      let bodyKind: ApiRequest['bodyType'] = 'none';

      // OpenAPI 3.x requestBody
      if (op.requestBody && typeof op.requestBody === 'object') {
        let reqBodyObj = op.requestBody;
        if (reqBodyObj.$ref) {
          const derefed = resolveRef(spec, reqBodyObj.$ref);
          if (!derefed) warn(`${reqName}: không phân giải được $ref "${reqBodyObj.$ref}" của requestBody — body trống.`);
          reqBodyObj = derefed || reqBodyObj;
        }
        const content = reqBodyObj.content || {};
        const contentKeys = Object.keys(content);
        const jsonKey = contentKeys.find((k) => k === 'application/json' || k.endsWith('+json'));
        if (jsonKey) {
          bodyKind = 'raw';
          let jsonSchema = content[jsonKey].schema;
          if (jsonSchema) {
            if (jsonSchema.oneOf || jsonSchema.anyOf) {
              warn(`${reqName}: schema body dùng oneOf/anyOf — body mẫu chỉ đúng một nhánh, kiểm tra lại trước khi gửi.`);
            }
            jsonSchema = dereferenceSchema(jsonSchema, spec);
          }
          const example = content[jsonKey].example ?? reqBodyObj.example;
          if (example !== undefined) {
            bodyStr = typeof example === 'string' ? example : JSON.stringify(example, null, 2);
          } else if (jsonSchema) {
            bodyStr = JSON.stringify(sampleFromSchema(jsonSchema, spec), null, 2);
          }
          if (!headers.some((h) => h.key.toLowerCase() === 'content-type')) {
            headers.push({ id: uid('kv'), key: 'Content-Type', value: jsonKey, enabled: true });
          }
        } else if (contentKeys.length) {
          warn(`${reqName}: requestBody chỉ có loại ${contentKeys.join(', ')} — chưa import body, hãy tự điền.`);
        }
      }
      // Swagger 2.0 body parameter
      else {
        let bodyParam = allParams.find((p: any) => p.in === 'body');
        if (bodyParam) {
          if (bodyParam.$ref) {
            bodyParam = resolveRef(spec, bodyParam.$ref) || bodyParam;
          }
          bodyKind = 'raw';
          let jsonSchema = bodyParam.schema;
          if (jsonSchema) {
            jsonSchema = dereferenceSchema(jsonSchema, spec);
          }
          if (bodyParam.example !== undefined) {
            bodyStr = typeof bodyParam.example === 'string' ? bodyParam.example : JSON.stringify(bodyParam.example, null, 2);
          } else if (jsonSchema) {
            bodyStr = JSON.stringify(sampleFromSchema(jsonSchema, spec), null, 2);
          }
          if (!headers.some((h) => h.key.toLowerCase() === 'content-type')) {
            headers.push({ id: uid('kv'), key: 'Content-Type', value: 'application/json', enabled: true });
          }
        }
      }

      // Build initial tests with response code and schema assertion
      const testSnippets: string[] = [];
      const responses = op.responses || {};
      const successCode = Object.keys(responses).find((code) => code.startsWith('2')) || '200';

      testSnippets.push(`pm.test("Status code is ${successCode}", () => {\n  pm.response.to.have.status(${parseInt(successCode, 10) || 200});\n});`);

      // If response schema is provided in 200/201/2xx response, embed schema assertion
      let respObj = responses[successCode] || responses['default'];
      if (respObj?.$ref) {
        const derefed = resolveRef(spec, respObj.$ref);
        if (!derefed) warn(`${reqName}: không phân giải được $ref "${respObj.$ref}" của response — bỏ assertion schema.`);
        respObj = derefed || respObj;
      }
      let respSchema = respObj?.content?.['application/json']?.schema || respObj?.schema;
      if (respSchema) {
        const resolvedSchema = dereferenceSchema(respSchema, spec);
        testSnippets.push(
          `pm.test("Kiểm tra Response khớp chuẩn OpenAPI", () => {\n  pm.response.to.have.jsonSchema(${JSON.stringify(resolvedSchema, null, 2)});\n});`,
        );
      } else if (!Object.keys(responses).length) {
        warn(`${reqName}: spec không khai báo responses — test chỉ kiểm tra status 200.`);
      }

      if (op.security || spec.security) needsAuthCount++;

      const reqId = uid('req');
      // {petId} -> giá trị mẫu thật (nếu spec có example/default), ngược lại giữ :petId kiểu Postman
      const fullUrl = `${baseUrl}${pathStr.replace(/\{([^}]+)\}/g, (m, name) => {
        const v = pathParams.get(name);
        return v ? encodeURIComponent(v) : `:${name}`;
      })}`;
      if (missingPathVars.length) {
        warn(`${reqName}: path param ${missingPathVars.join(', ')} không có example/default — URL đang để :${missingPathVars.join(' /:')}, thay giá trị thật trước khi gửi.`);
      }

      const apiReq: ApiRequest = {
        id: reqId,
        name: reqName,
        method: method.toUpperCase() as ApiRequest['method'],
        url: fullUrl,
        params: queryParams,
        headers,
        body: bodyStr,
        bodyType: bodyKind,
        auth: { type: 'none' },
        description: reqDesc,
        tests: testSnippets.join('\n\n'),
        origin: 'imported',
        updatedAt: Date.now(),
      };

      requests.push(apiReq);

      // Grouping by Tag (Postman style)
      const tags = Array.isArray(op.tags) && op.tags.length > 0 ? op.tags : [];
      const primaryTag = tags[0];

      if (primaryTag) {
        let folder = folderMap.get(primaryTag);
        if (!folder) {
          folder = {
            id: uid('fld'),
            name: primaryTag,
            requestIds: [],
            folderIds: [],
          };
          folderMap.set(primaryTag, folder);
          collection.folders.push(folder);
        }
        folder.requestIds.push(reqId);
      } else {
        collection.rootRequestIds.push(reqId);
      }
    }
  }

  if (needsAuthCount > 0) {
    warn(`${needsAuthCount} request yêu cầu authentication theo spec — chưa tự áp, chọn Auth thủ công (Bearer/API Key/OAuth2) cho từng request.`);
  }
  const schemes = Object.entries<any>(spec.components?.securitySchemes || {});
  const weird = schemes.filter(([, v]) => !['http', 'apiKey', 'oauth2'].includes(v?.type)).map(([k]) => k);
  if (weird.length) warn(`Security scheme lạ (${weird.join(', ')}): ${schemes.map(([k, v]) => `${k}=${v?.type}`).join(', ')} — ReqX chưa hỗ trợ loại này.`);
  if (!requests.length) warn('Spec không có operation nào import được — kiểm tra lại file (paths / method).');

  const MAX_WARNINGS = 40;
  const warnings = rawWarnings.length > MAX_WARNINGS
    ? [...rawWarnings.slice(0, MAX_WARNINGS), `… còn ${rawWarnings.length - MAX_WARNINGS} cảnh báo nữa (đã ẩn để đỡ rối).`]
    : rawWarnings;

  return { collection, requests, warnings };
}
