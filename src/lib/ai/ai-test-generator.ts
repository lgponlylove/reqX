import type { ApiRequest, ApiResponse } from '../../types/api';
import { useAppStore } from '../../stores/app';
import { orderChain, providerDef, entryTier, buildBaseURL } from './ai-providers';
import { generateContent } from './gemini';
import { openaiChat } from './openai-chat';
import { anthropicChat } from './anthropic-chat';

/**
 * Sinh test assertion thông minh dựa theo luật (Heuristic) — chạy offline 0s, không cần API key
 */
export function generateHeuristicTests(req: ApiRequest, res: ApiResponse): string {
  const lines: string[] = [];

  lines.push('// ==============================================');
  lines.push(`// Kịch bản kiểm thử tự động cho: ${req.name || req.url}`);
  lines.push(`// Sinh tự động từ Response (${res.status} • ${res.timeMs}ms)`);
  lines.push('// ==============================================\n');

  // 1. Kiểm tra HTTP Status
  lines.push(`pm.test("Status code is ${res.status}", function () {`);
  lines.push(`  pm.response.to.have.status(${res.status});`);
  lines.push('});\n');

  // 2. Kiểm tra thời gian phản hồi
  const threshold = Math.max(Math.round(res.timeMs * 2.5), 1500);
  lines.push(`pm.test("Response time is under ${threshold}ms", function () {`);
  lines.push(`  pm.expect(pm.response.responseTime).to.be.below(${threshold});`);
  lines.push('});\n');

  // 3. Kiểm tra Header
  const ct = Object.entries(res.headers).find(([k]) => k.toLowerCase() === 'content-type');
  if (ct) {
    const isJson = ct[1].toLowerCase().includes('application/json');
    lines.push('pm.test("Content-Type header is valid", function () {');
    lines.push(`  pm.expect(pm.response.headers.get("${ct[0]}")).to.include("${isJson ? 'application/json' : ct[1].split(';')[0].trim()}");`);
    lines.push('});\n');
  }

  // 4. Kiểm tra cấu trúc Body (nếu là JSON)
  if (res.bodyKind !== 'binary' && res.body.trim()) {
    try {
      const parsed = JSON.parse(res.body);
      if (Array.isArray(parsed)) {
        lines.push('pm.test("Response body is a JSON array", function () {');
        lines.push('  const data = pm.response.json();');
        lines.push('  pm.expect(data).to.be.an("array");');
        if (parsed.length > 0) {
          lines.push(`  pm.expect(data.length).to.be.at.least(${parsed.length > 5 ? 1 : parsed.length});`);
        }
        lines.push('});\n');

        // Kiểm tra item đầu tiên của mảng
        if (parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
          const first = parsed[0];
          lines.push('pm.test("Array item contains expected fields", function () {');
          lines.push('  const data = pm.response.json();');
          lines.push('  const item = data[0];');
          lines.push('  pm.expect(item).to.be.an("object");');
          for (const [k, v] of Object.entries(first).slice(0, 8)) {
            const valType = typeof v;
            if (v === null) {
              lines.push(`  pm.expect(item).to.have.property("${k}");`);
            } else if (Array.isArray(v)) {
              lines.push(`  pm.expect(item.${k}).to.be.an("array");`);
            } else {
              lines.push(`  pm.expect(typeof item.${k}).to.equal("${valType}");`);
            }
          }
          lines.push('});\n');
        }
      } else if (parsed && typeof parsed === 'object') {
        lines.push('pm.test("Response body has valid JSON structure", function () {');
        lines.push('  const data = pm.response.json();');
        lines.push('  pm.expect(data).to.be.an("object");');

        for (const [k, v] of Object.entries(parsed).slice(0, 10)) {
          const valType = typeof v;
          if (v === null) {
            lines.push(`  pm.expect(data).to.have.property("${k}");`);
          } else if (Array.isArray(v)) {
            lines.push(`  pm.expect(data.${k}).to.be.an("array");`);
          } else if (valType === 'boolean') {
            lines.push(`  pm.expect(data.${k}).to.equal(${v});`);
          } else if (valType === 'number') {
            lines.push(`  pm.expect(data.${k}).to.exist;`);
            lines.push(`  pm.expect(typeof data.${k}).to.equal("number");`);
          } else if (valType === 'string') {
            lines.push(`  pm.expect(data.${k}).to.exist;`);
            lines.push(`  pm.expect(typeof data.${k}).to.equal("string");`);
          } else {
            lines.push(`  pm.expect(data.${k}).to.exist;`);
          }
        }
        lines.push('});\n');
      }
    } catch {
      // Body không phải JSON (vd: Plain text, HTML)
      lines.push('pm.test("Response body is non-empty", function () {');
      lines.push('  pm.expect(pm.response.text()).to.have.length.above(0);');
      lines.push('});\n');
    }
  }

  return lines.join('\n').trim();
}

/**
 * Gọi AI sinh test case chuyên sâu hoặc fallback sang heuristic nếu AI không sẵn sàng
 */
export async function generateAiTests(
  req: ApiRequest,
  res: ApiResponse
): Promise<{ tests: string; isAiGenerated: boolean; note?: string }> {
  const st = useAppStore.getState();
  const chain = orderChain(st.aiChain, st.aiRrIndex, st.aiStrategy);

  if (chain.length === 0) {
    return {
      tests: generateHeuristicTests(req, res),
      isAiGenerated: false,
      note: 'Đã sinh test theo quy tắc cấu trúc (chưa cài đặt AI API Key).',
    };
  }

  const enabledHeaders = (req.headers ?? []).filter((h) => h.enabled && h.key.trim());
  const headerLines = enabledHeaders.map((h) => `${h.key}: ${h.value}`).join('\n');

  let reqBodySummary = '';
  if (req.bodyType === 'graphql' && req.graphql) {
    reqBodySummary = `Query: ${req.graphql.query || ''}\nVariables: ${req.graphql.variables || ''}`;
  } else if (req.bodyType !== 'none' && req.body) {
    reqBodySummary = req.body.slice(0, 3000);
  }

  const prompt = `Bạn là chuyên gia QA Automation API cho app ReqX (tương thích Postman Sandbox).
Dựa vào Request và Response thực tế dưới đây, hãy viết một bộ test script assertions hoàn chỉnh bằng JavaScript:

[REQUEST]
Name: ${req.name}
Method: ${req.method}
URL: ${req.url}
Headers:
${headerLines || '(không có header tùy chỉnh)'}
Body Type: ${req.bodyType}
Body:
${reqBodySummary || '(không có body)'}

[RESPONSE]
Status: ${res.status} ${res.statusText}
Response Time: ${res.timeMs}ms
Headers: ${JSON.stringify(res.headers)}
Body (mẫu):
${res.body.slice(0, 4000)}

[YÊU CẦU BẮT BUỘC]:
1. Sử dụng cú pháp pm.test("mô tả", function() { pm.expect(...); }) chuẩn Postman/ReqX Sandbox.
2. Kiểm tra status code, response time hợp lý, Content-Type header và cấu trúc JSON body.
3. QUAN TRỌNG VỀ ĐỐI CHIẾU DỮ LIỆU VÀ GIÁ TRỊ ĐỘNG:
   - Nếu Request có gửi dữ liệu (ví dụ POST/PUT/PATCH với body JSON/Form), hãy assert xem Response có phản ánh chính xác các trường dữ liệu tĩnh đó không (ví dụ: title, email, name, role...).
   - TUYỆT ĐỐI KHÔNG assert cứng (hardcode) các giá trị động được sinh ra phía server như: ID, UUID, timestamp, createdAt, updatedAt, token, jwt, hash, session_id. Đối với các trường này, chỉ kiểm tra sự tồn tại (to.exist / to.not.be.undefined), kiểu dữ liệu (to.be.a('string') / to.be.a('number')), hoặc regex định dạng (ví dụ regex UUID, regex ISO 8601 date).
   - Kiểm tra mảng/danh sách: kiểm tra là mảng (to.be.an('array')), độ dài tối thiểu, và kiểm tra schema của phần tử đầu tiên thay vì hardcode giá trị cụ thể của từng phần tử.
4. CHỈ TRẢ VỀ DUY NHẤT MÃ JAVASCRIPT nằm trong cặp ba dấu \`\`\`javascript ... \`\`\`. KHÔNG viết thêm bất kỳ lời chào hay giải thích nào bên ngoài mã.`;

  for (const entry of chain) {
    const def = providerDef(entry.providerId);
    if (!def) continue;

    try {
      let rawText = '';
      if (def.style === 'gemini') {
        const apiKey = entry.key.trim();
        const model = entry.model.trim() || def.defaultModel;
        const result = await generateContent(
          apiKey,
          model,
          'Bạn là chuyên gia QA automation cho ReqX (Postman Sandbox).',
          [{ role: 'user', parts: [{ text: prompt }] }],
          []
        );
        const textPart = result.parts.find((p) => p.text);
        rawText = textPart?.text || '';
      } else if (def.style === 'anthropic') {
        const apiKey = entry.key.trim();
        const model = entry.model.trim() || def.defaultModel;
        const result = await anthropicChat({
          baseURL: entry.customBaseURL || def.baseURL,
          key: apiKey,
          model,
          system: 'Bạn là chuyên gia QA automation cho ReqX (Postman Sandbox).',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [],
        });
        const textPart = result.parts.find((p) => p.text);
        rawText = textPart?.text || '';
      } else {
        const apiKey = entry.key.trim();
        const model = entry.model.trim() || def.defaultModel;
        const baseURL = buildBaseURL(def, entry.accountId, entry.customBaseURL);
        const result = await openaiChat({
          baseURL,
          key: apiKey,
          model,
          system: 'Bạn là chuyên gia QA automation cho ReqX (Postman Sandbox).',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [],
        });
        const textPart = result.parts.find((p) => p.text);
        rawText = textPart?.text || '';
      }

      if (rawText) {
        // Tách code trong block ```javascript hoặc ```js
        const match = rawText.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
        const cleanCode = match ? match[1].trim() : rawText.trim();
        if (cleanCode.includes('pm.test')) {
          return {
            tests: cleanCode,
            isAiGenerated: true,
            note: `Đã sinh test thông minh bằng mô hình ${entry.model || def.defaultModel}.`,
          };
        }
      }
    } catch {
      // Thử provider tiếp theo trong chain
    }
  }

  // Fallback sang heuristic nếu tất cả AI bị lỗi hoặc hết quota
  return {
    tests: generateHeuristicTests(req, res),
    isAiGenerated: false,
    note: 'AI bận/hết quota — đã sinh test theo bộ quy tắc cấu trúc tự động.',
  };
}
