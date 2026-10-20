/**
 * Tiện ích xử lý cú pháp GraphQL (Format/Prettify, đóng gói và bóc tách payload)
 */

export function prettifyGraphQL(query: string): string {
  if (!query || !query.trim()) return '';

  const lines = query.split('\n');
  let indent = 0;
  const result: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (result.length > 0 && result[result.length - 1] !== '') {
        result.push('');
      }
      continue;
    }

    // Nếu dòng bắt đầu bằng '}' hoặc ')' thì giảm indent trước khi in
    const startsWithClose = trimmed.startsWith('}') || trimmed.startsWith(')');
    const currentIndent = startsWithClose ? Math.max(0, indent - 1) : indent;
    result.push('  '.repeat(currentIndent) + trimmed);

    // Tính toán thay đổi thụt đầu dòng
    const openBraces = (trimmed.match(/[{]/g) || []).length;
    const closeBraces = (trimmed.match(/[}]/g) || []).length;
    indent += openBraces - closeBraces;
    if (indent < 0) indent = 0;
  }

  return result.join('\n').trim();
}

/**
 * Đóng gói query và variables thành JSON chuẩn gửi qua HTTP POST
 */
export function buildGraphQLBody(query: string, variables: string): string {
  let parsedVars: Record<string, unknown> = {};
  const trimmedVars = (variables || '').trim();
  if (trimmedVars) {
    try {
      parsedVars = JSON.parse(trimmedVars);
    } catch {
      // Nếu có biến template hoặc JSON chưa đóng ngoặc, cố gắng không làm crash
    }
  }

  return JSON.stringify(
    {
      query: (query || '').trim(),
      variables: parsedVars,
    },
    null,
    2
  );
}

/**
 * Bóc tách body JSON hiện tại thành { query, variables }
 */
export function parseGraphQLBody(body: string): { query: string; variables: string } {
  if (!body || !body.trim()) {
    return {
      query: 'query {\n  \n}',
      variables: '{\n  \n}',
    };
  }

  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object') {
      const q = typeof parsed.query === 'string' ? parsed.query : '';
      const v =
        typeof parsed.variables === 'string'
          ? parsed.variables
          : parsed.variables && typeof parsed.variables === 'object'
          ? JSON.stringify(parsed.variables, null, 2)
          : '';
      return {
        query: q,
        variables: v || '{\n  \n}',
      };
    }
  } catch {
    // Nếu body không phải JSON mà là chuỗi query thuần
  }

  return {
    query: body,
    variables: '{\n  \n}',
  };
}
