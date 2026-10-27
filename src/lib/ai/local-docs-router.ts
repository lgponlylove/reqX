import type { ApiRequest, Collection, Flow } from '../../types/api';
import { toCurl } from '../codegen';
import { DOC_TOPICS, getDocTopic, searchDocs } from '../docs/app-guide';

export interface LocalDocsMatch {
  matched: boolean;
  /** Tiêu đề ngắn gọn của câu trả lời */
  title?: string;
  /** Nội dung Markdown trả lời trực tiếp < 10ms */
  content?: string;
  /** Request ID liên quan để lưu ngữ cảnh hoặc mở tab */
  requestId?: string;
  /** Gợi ý action nhanh */
  action?: {
    type: 'open_request' | 'copy_curl';
    label: string;
    payload?: string;
  };
}

/**
 * Các mẫu từ khóa kích hoạt tư duy lập trình / sáng tạo / phân tích logic sâu
 * -> KHÔNG được trả lời Local, BẮT BUỘC để Server LLM xử lý.
 */
const LLM_REQUIRED_PATTERNS = [
  /viết\s+(script|code|test|hàm|pre[- ]?request|kiểm thử)/i,
  /tạo\s+(script|test|mock\s+data|dữ liệu\s+giả)/i,
  /(hướng dẫn|cách)\s+viết/i,
  /(so sánh|phân tích|đánh giá|tại sao|vì sao|nguyên nhân|giải thích\s+code)/i,
  /(check|kiểm tra|validate)\s+(access_?token|jwt|hmac|signature)/i,
  /gợi ý\s+(case|test|kịch bản)/i,
  /sửa\s+(script|lỗi|code)/i,
];

/**
 * Kiểm tra xem người dùng có đang hỏi về cẩm nang / hướng dẫn tính năng của ReqX hay không.
 * Ví dụ: "chức năng của flow", "flow làm gì", "tính năng runner", "mock server là gì", "phím tắt"
 */
function matchAppFeatureGuide(query: string): LocalDocsMatch | null {
  const q = query.trim().toLowerCase();

  // Nhận diện mẫu câu hỏi cẩm nang tính năng
  const isFeatureQuery =
    /(chức năng|tính năng|hướng dẫn|cách dùng|là gì|làm gì|để làm gì|sử dụng thế nào|phím tắt|shortcuts?|giới thiệu|app làm được gì|reqx làm được gì)/i.test(q) ||
    /^(flow|flows|runner|mock|mock[- ]?server|environment|môi trường|cli|cyberdock|builder|websocket|grpc)\b/i.test(q);

  if (!isFeatureQuery) return null;

  // Thử khớp theo các topic cụ thể
  let matchedTopic = undefined;

  // Nếu là câu hỏi tổng quan giới thiệu app
  if (/(giới thiệu|app làm được gì|tổng quan|tất cả tính năng|các chức năng|reqx là gì)/i.test(q) && !/(cụ thể|chi tiết)/i.test(q)) {
    matchedTopic = getDocTopic('overview');
  } else if (/\b(flow|flows|luồng|workflow|canvas)\b/i.test(q)) {
    matchedTopic = getDocTopic('flows');
  } else if (/\b(runner|chạy tự động|bulk|data file|csv runner)\b/i.test(q)) {
    matchedTopic = getDocTopic('runner-and-data');
  } else if (/\b(mock|giả lập|mock server)\b/i.test(q)) {
    matchedTopic = getDocTopic('mock-server');
  } else if (/\b(phím tắt|shortcut|hotkey|bàn phím)\b/i.test(q)) {
    matchedTopic = getDocTopic('shortcuts');
  } else if (/\b(cli|command line|dòng lệnh|terminal|newman)\b/i.test(q)) {
    matchedTopic = getDocTopic('cli');
  } else if (/\b(cây|tree|thư mục|directory|git workspace|microservices)\b/i.test(q)) {
    matchedTopic = getDocTopic('tree-and-git-workspace');
  } else if (/\b(tài liệu|export|xuất docs|html|markdown|response ví dụ|example)\b/i.test(q)) {
    matchedTopic = getDocTopic('api-docs-and-examples');
  } else if (/\b(stress|tải|hiệu năng|scheduler|định kỳ|cron)\b/i.test(q)) {
    matchedTopic = getDocTopic('stress-test-and-scheduler');
  } else if (/\b(môi trường|environment|biến môi trường|env)\b/i.test(q)) {
    matchedTopic = getDocTopic('environments');
  } else if (/\b(script|sandbox|pre[- ]?request|tests|pm\.)\b/i.test(q)) {
    matchedTopic = getDocTopic('scripts-sandbox');
  } else if (/\b(websocket|grpc|protocol|giao thức|sse)\b/i.test(q)) {
    matchedTopic = getDocTopic('protocols');
  } else if (/\b(ai|postbot|trợ lý|trợ lý ai)\b/i.test(q)) {
    matchedTopic = getDocTopic('ai-assistant');
  } else if (/\b(builder|gửi request|soạn thảo api)\b/i.test(q)) {
    matchedTopic = getDocTopic('builder-requests');
  } else if (/\b(giao diện|cyberdock|overview|tổng quan)\b/i.test(q)) {
    matchedTopic = getDocTopic('overview');
  } else {
    // Nếu hỏi chung chung chi tiết các chức năng -> Trả về danh mục tổng thể
    if (/(chi tiết các chức năng|tất cả chức năng|toàn bộ tính năng)/i.test(q)) {
      matchedTopic = getDocTopic('overview');
    } else {
      // Tìm kiếm mờ trong toàn bộ cẩm nang
      const searchRes = searchDocs(q.replace(/(chức năng|tính năng|hướng dẫn|cách dùng|là gì|làm gì|của|ở đâu|hơn|giúp tôi|chi tiết)/gi, '').trim());
      if (searchRes.length > 0) {
        matchedTopic = searchRes[0];
      }
    }
  }

  if (matchedTopic) {
    return {
      matched: true,
      title: matchedTopic.title,
      content: `⚡ **Tài liệu hướng dẫn ReqX (0ms • 0 token)** — **${matchedTopic.title}**\n\n${matchedTopic.content}`,
    };
  }

  return null;
}

/**
 * Nhận diện ý định tra cứu tài liệu Local:
 * 1. Cẩm nang tính năng ReqX (Flows, Runner, Mock, CLI, Phím tắt...)
 * 2. Tra cứu cURL
 * 3. Tra cứu mã lỗi / response ví dụ
 * 4. Tra cứu Body / Params / Headers
 * 5. Tra cứu danh sách API hoặc thông tin tổng quan của 1 API
 */
export function matchLocalDocsQuery(
  rawQuery: string,
  requests: Record<string, ApiRequest>,
  collections: Collection[],
  lastContextRequestId?: string,
  flows?: Flow[],
): LocalDocsMatch {
  const query = rawQuery.trim();
  if (!query || query.length < 3) return { matched: false };

  // 1. Kiểm tra nếu câu hỏi yêu cầu LLM tư duy sâu -> Fallback ngay
  for (const pattern of LLM_REQUIRED_PATTERNS) {
    if (pattern.test(query)) {
      return { matched: false };
    }
  }

  const lowerQuery = query.toLowerCase();

  // 2. Tra cứu danh sách Flow thực tế trong ứng dụng (0ms, 0 token)
  const isListFlowQuery = /(danh sách|liệt kê|có những|các|tìm)\s+(flow|luồng|workflow)/i.test(lowerQuery);
  if (isListFlowQuery) {
    const flowList = flows || [];
    if (flowList.length === 0) {
      return {
        matched: true,
        title: 'Danh sách Flow',
        content: `⚡ **Local Docs Inspector (0ms)** — Hiện tại ứng dụng chưa có Flow nào được tạo.\n\nBạn có thể vào tab **Flow** trên thanh header hoặc nhờ AI: *"Tạo flow từ request Đăng nhập và Lấy thông tin"* để bắt đầu!`,
      };
    }
    const lines = [
      `⚡ **Local Docs Inspector (0ms)** — Danh sách các Flow hiện có trong Workspace (${flowList.length} flow):`,
      '',
      ...flowList.map((f, i) => `${i + 1}. **${f.name}** — ${f.steps.length} bước (steps)`),
      '',
      `_Bạn có thể bảo AI chạy flow: "Chạy flow ${flowList[0].name}" hoặc chuyển sang tab Flow để xem chi tiết._`,
    ];
    return {
      matched: true,
      title: 'Danh sách Flow',
      content: lines.join('\n'),
    };
  }

  // 3. Tra cứu Cẩm nang hướng dẫn tính năng ReqX (Không phụ thuộc requests list)
  const guideMatch = matchAppFeatureGuide(query);
  if (guideMatch) {
    return guideMatch;
  }

  const reqList = Object.values(requests);
  if (reqList.length === 0) return { matched: false };

  // Helper tìm request phù hợp nhất với câu hỏi
  let targetReq: ApiRequest | undefined;

  // 2. Kiểm tra nếu câu hỏi dùng đại từ ("nó", "request này", "thằng này", "api vừa rồi")
  const isPronoun = /(?:^|\s)(nó|thằng này|request này|api này|thằng vừa rồi|api vừa rồi|cái này)(?:$|\s|[?.!])/i.test(lowerQuery);
  if (isPronoun && lastContextRequestId && requests[lastContextRequestId]) {
    targetReq = requests[lastContextRequestId];
  }

  // 3. Nếu chưa có targetReq, tìm theo tên hoặc URL path trong câu hỏi
  if (!targetReq) {
    // Sắp xếp các request theo độ dài tên giảm dần để match tên cụ thể nhất trước
    const candidates = [...reqList].sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));
    for (const req of candidates) {
      const name = (req.name || '').trim().toLowerCase();
      const url = (req.url || '').trim().toLowerCase();
      // Match tên request
      if (name && name.length >= 2 && lowerQuery.includes(name)) {
        targetReq = req;
        break;
      }
      // Match pathname của URL (ví dụ /auth/login hoặc /users)
      try {
        const pathPart = url.replace(/^(https?:\/\/[^/]+)/i, '').split('?')[0];
        if (pathPart && pathPart.length >= 3 && lowerQuery.includes(pathPart)) {
          targetReq = req;
          break;
        }
      } catch {
        /* bỏ qua url parse lỗi */
      }
    }
  }

  // 4. Nếu vẫn không thấy targetReq cụ thể, thử kiểm tra xem có phải câu hỏi liệt kê danh sách API không
  if (!targetReq) {
    const isListQuery = /(danh sách|liệt kê|có những|các api|các request|tìm api|tìm request)/i.test(query);
    if (isListQuery) {
      // Tìm xem có nhắc tên folder hoặc collection nào không
      let matchedCol = collections.find((c) => lowerQuery.includes(c.name.toLowerCase()));
      if (matchedCol) {
        const colReqs = reqList.filter((r) => r.collectionId === matchedCol!.id);
        if (colReqs.length > 0) {
          const lines = [
            `⚡ **Local Docs Inspector (0ms)** — Danh sách API trong Collection **${matchedCol.name}**:`,
            '',
            ...colReqs.map((r, i) => `${i + 1}. \`${r.method}\` **${r.name || r.url}** — \`${r.url}\``),
            '',
            `_Tìm thấy ${colReqs.length} request. Bạn có thể hỏi chi tiết body, header hoặc mã lỗi của từng API._`,
          ];
          return {
            matched: true,
            title: `Danh sách API: ${matchedCol.name}`,
            content: lines.join('\n'),
            requestId: colReqs[0]?.id,
          };
        }
      }

      // Tìm từ khóa chung trong tên hoặc URL của tất cả request
      const searchTerms = lowerQuery.replace(/(danh sách|liệt kê|các|api|request|tìm|trong)/gi, '').trim().split(/\s+/).filter((w) => w.length >= 2);
      if (searchTerms.length > 0) {
        const matches = reqList.filter((r) => {
          const txt = `${r.name} ${r.url} ${r.method}`.toLowerCase();
          return searchTerms.some((term) => txt.includes(term));
        });
        if (matches.length > 0 && matches.length <= 10) {
          const lines = [
            `⚡ **Local Docs Inspector (0ms)** — Kết quả tìm kiếm theo từ khóa:`,
            '',
            ...matches.map((r, i) => `${i + 1}. \`${r.method}\` **${r.name || r.url}** (\`${r.url}\`)`),
            '',
            `_Gõ tên API hoặc hỏi "body của ${matches[0].name}" để xem chi tiết._`,
          ];
          return {
            matched: true,
            title: 'Kết quả tìm kiếm API',
            content: lines.join('\n'),
            requestId: matches[0]?.id,
          };
        }
      }
    }

    // Không tìm được request nào khớp -> Nhường cho LLM
    return { matched: false };
  }

  // === ĐÃ XÁC ĐỊNH ĐƯỢC TARGET REQUEST ===

  // Kịch bản A: Hỏi cURL
  if (/(curl|lệnh curl|câu lệnh curl|bash)/i.test(query)) {
    const curl = toCurl(targetReq, {}, {}, collections);
    return {
      matched: true,
      title: `cURL của ${targetReq.name}`,
      content: [
        `⚡ **Local Docs Inspector (0ms)** — Lệnh cURL cho request **${targetReq.name}**:`,
        '',
        '```bash',
        curl,
        '```',
      ].join('\n'),
      requestId: targetReq.id,
      action: {
        type: 'copy_curl',
        label: '📋 Sao chép cURL',
        payload: curl,
      },
    };
  }

  // Kịch bản B: Hỏi Mã lỗi / Phản hồi (Response status, error codes, examples)
  if (/(mã lỗi|lỗi|error|status|phản hồi|response|trả về cái gì|trả về gì|kết quả mẫu)/i.test(query)) {
    const examples = targetReq.examples ?? [];
    const lines = [
      `⚡ **Local Docs Inspector (0ms)** — Các phản hồi đã ghi nhận cho **${targetReq.name}** (\`${targetReq.method} ${targetReq.url}\`):`,
      '',
    ];

    if (examples.length === 0) {
      lines.push('_Chưa có ví dụ response nào được lưu tự động cho request này. Hãy bấm **Send** một lần để ReqX tự động ghi nhận!_');
    } else {
      for (const exp of examples) {
        const isOk = exp.status >= 200 && exp.status < 300;
        const icon = isOk ? '✅' : '⚠️';
        lines.push(`### ${icon} Mã ${exp.status}${exp.statusText ? ` (${exp.statusText})` : ''}`);
        if (exp.timeMs) lines.push(`_Thời gian: ${exp.timeMs}ms_`);
        lines.push('```json', exp.body || '(body trống)', '```', '');
      }
    }

    return {
      matched: true,
      title: `Phản hồi mẫu của ${targetReq.name}`,
      content: lines.join('\n'),
      requestId: targetReq.id,
    };
  }

  // Kịch bản C: Hỏi Body / Payload
  if (/(body|payload|tham số body|truyền gì|gửi gì|json|dữ liệu gửi lên)/i.test(query)) {
    const lines = [
      `⚡ **Local Docs Inspector (0ms)** — Cấu hình Body của **${targetReq.name}**:`,
      '',
      `- **Method:** \`${targetReq.method}\``,
      `- **URL:** \`${targetReq.url}\``,
      `- **Body Type:** \`${targetReq.bodyType}\``,
      '',
    ];

    if (!targetReq.body || targetReq.body.trim() === '' || targetReq.bodyType === 'none') {
      lines.push('_Request này không có body (hoặc body trống)._');
    } else {
      lines.push('```json', targetReq.body, '```');
    }

    return {
      matched: true,
      title: `Body của ${targetReq.name}`,
      content: lines.join('\n'),
      requestId: targetReq.id,
    };
  }

  // Kịch bản D: Hỏi Headers hoặc Params
  if (/(header|tiêu đề|tham số|param|query|query param|auth|token)/i.test(query)) {
    const lines = [
      `⚡ **Local Docs Inspector (0ms)** — Headers & Params của **${targetReq.name}**:`,
      '',
      `**URL:** \`${targetReq.method} ${targetReq.url}\``,
      '',
    ];

    const headers = (targetReq.headers ?? []).filter((h) => h.enabled && h.key.trim());
    lines.push('**Headers:**');
    if (headers.length === 0) {
      lines.push('_Không có headers tùy chỉnh._', '');
    } else {
      lines.push(...headers.map((h) => `- \`${h.key}\`: \`${h.value}\``), '');
    }

    const params = (targetReq.params ?? []).filter((p) => p.enabled && p.key.trim());
    if (params.length > 0) {
      lines.push('**Query Parameters:**');
      lines.push(...params.map((p) => `- \`${p.key}\`: \`${p.value}\``), '');
    }

    return {
      matched: true,
      title: `Headers/Params của ${targetReq.name}`,
      content: lines.join('\n'),
      requestId: targetReq.id,
    };
  }

  // Kịch bản E: Hỏi thông tin tổng quan của Request (hỏi tên API hoặc thông tin API)
  if (/(thông tin|chi tiết|tổng quan|là gì|làm gì|cách dùng)/i.test(query) || lowerQuery.includes(targetReq.name.toLowerCase())) {
    const lines = [
      `⚡ **Local Docs Inspector (0ms)** — Chi tiết API **${targetReq.name}**:`,
      '',
      `- **Method & URL:** \`${targetReq.method} ${targetReq.url}\``,
      targetReq.description ? `- **Mô tả:** ${targetReq.description}` : '',
      `- **Auth Type:** \`${targetReq.auth?.type || 'none'}\``,
      `- **Body Type:** \`${targetReq.bodyType}\``,
      `- **Số lượng phản hồi mẫu đã lưu:** ${(targetReq.examples ?? []).length} mẫu`,
      '',
    ].filter(Boolean);

    if (targetReq.body && targetReq.body.trim()) {
      lines.push('**Body mẫu:**', '```json', targetReq.body, '```', '');
    }

    lines.push('_Hỏi thêm: "mã lỗi", "headers", "curl" hoặc "viết script test cho api này"._');

    return {
      matched: true,
      title: `Chi tiết ${targetReq.name}`,
      content: lines.join('\n'),
      requestId: targetReq.id,
    };
  }

  // Các trường hợp khác -> Để LLM xử lý
  return { matched: false };
}
