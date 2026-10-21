import { validateJsonSchema, type JsonSchema } from './json-schema';
import { resolveRef, dereferenceSchema } from './openapi-import';

export interface ContractTestResult {
  tested: boolean;
  valid: boolean;
  operationName?: string;
  errors: string[];
}

/**
 * Chuẩn hóa path để so khớp: chuyển /api/users/:id hoặc /api/users/{id} thành regex
 */
function compilePathPattern(pattern: string): RegExp {
  // Thay thế {param} hoặc :param thành ([^/]+)
  const regexStr = '^' + pattern
    .replace(/\{[^}]+\}/g, '([^/]+)')
    .replace(/:[a-zA-Z0-9_]+/g, '([^/]+)') + '$';
  return new RegExp(regexStr);
}

/**
 * Tìm path trong spec khớp với request URL
 */
export function matchOpenApiPath(
  specPaths: Record<string, any>,
  urlStr: string
): { pathPattern: string; pathItem: any } | null {
  let pathname = urlStr;
  try {
    const u = new URL(urlStr, 'http://localhost');
    pathname = u.pathname;
  } catch {
    pathname = urlStr.split('?')[0];
  }

  // 1. Thử khớp chính xác
  if (specPaths[pathname]) {
    return { pathPattern: pathname, pathItem: specPaths[pathname] };
  }

  // 2. Thử khớp regex pattern với {id} hoặc :id
  for (const [pattern, item] of Object.entries(specPaths)) {
    const re = compilePathPattern(pattern);
    if (re.test(pathname)) {
      return { pathPattern: pattern, pathItem: item };
    }
  }

  // 3. Fallback: pathname có thể chứa base path mà spec không có (hoặc ngược lại)
  for (const [pattern, item] of Object.entries(specPaths)) {
    if (pathname.endsWith(pattern) || pattern.endsWith(pathname)) {
      return { pathPattern: pattern, pathItem: item };
    }
  }

  return null;
}

/**
 * Trích xuất JsonSchema được nhúng sẵn trong test script của request (do openapi-import tạo ra)
 */
export function extractEmbeddedSchema(testScript?: string): JsonSchema | null {
  if (!testScript) return null;
  const match = testScript.match(/pm\.response\.to\.have\.jsonSchema\(([\s\S]*?)\);/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Kiểm tra contract test của 1 response với OpenAPI spec hoặc schema nhúng sẵn
 */
export function validateResponseContract(
  spec: any | null | undefined,
  method: string,
  url: string,
  status: number,
  responseBody: string,
  embeddedSchema?: JsonSchema | null
): ContractTestResult {
  // 1. Nếu có schema nhúng sẵn (từ test script của OpenAPI import)
  if (embeddedSchema) {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(responseBody);
    } catch {
      return {
        tested: true,
        valid: false,
        operationName: `${method} ${url}`,
        errors: ['Response body không phải JSON hợp lệ để kiểm tra schema contract.'],
      };
    }
    const res = validateJsonSchema(parsedBody, embeddedSchema);
    return {
      tested: true,
      valid: res.valid,
      operationName: `${method} ${url} (Embedded Schema)`,
      errors: res.errors,
    };
  }

  // 2. Nếu có OpenAPI spec tổng thể
  if (!spec || typeof spec !== 'object' || !spec.paths) {
    return { tested: false, valid: true, errors: [] };
  }

  const matched = matchOpenApiPath(spec.paths, url);
  if (!matched) {
    return {
      tested: false,
      valid: true,
      errors: [`Không tìm thấy endpoint tương ứng trong OpenAPI spec: ${url}`],
    };
  }

  const op = matched.pathItem[method.toLowerCase()];
  if (!op) {
    return {
      tested: true,
      valid: false,
      operationName: `${method.toUpperCase()} ${matched.pathPattern}`,
      errors: [`Phương thức ${method.toUpperCase()} không được định nghĩa trong OpenAPI spec cho path ${matched.pathPattern}`],
    };
  }

  const opName = op.summary || op.operationId || `${method.toUpperCase()} ${matched.pathPattern}`;
  const responses = op.responses || {};

  // Tìm response definition theo statusCode
  const statusStr = String(status);
  let respObj = responses[statusStr] || responses[`${statusStr[0]}XX`] || responses['default'];

  if (!respObj) {
    return {
      tested: true,
      valid: false,
      operationName: opName,
      errors: [`Mã trạng thái HTTP ${status} không được khai báo trong responses của ${opName}`],
    };
  }

  if (respObj.$ref) {
    respObj = resolveRef(spec, respObj.$ref) || respObj;
  }

  const schemaRaw = respObj.content?.['application/json']?.schema || respObj.schema;
  if (!schemaRaw) {
    // Endpoint không yêu cầu schema JSON (ví dụ 204 No Content)
    return { tested: true, valid: true, operationName: opName, errors: [] };
  }

  const targetSchema = dereferenceSchema(schemaRaw, spec);
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(responseBody);
  } catch {
    return {
      tested: true,
      valid: false,
      operationName: opName,
      errors: ['Response body không phải JSON hợp lệ để kiểm tra OpenAPI schema.'],
    };
  }

  const res = validateJsonSchema(parsedBody, targetSchema);
  return {
    tested: true,
    valid: res.valid,
    operationName: opName,
    errors: res.errors,
  };
}
