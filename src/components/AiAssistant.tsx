import { useEffect, useRef, useState } from 'react';
import { useAppStore, type AiChatMsg } from '../stores/app';
import { useFlowStore } from '../stores/flow';
import { useRequestStore } from '../stores/request';
import { generateContent, isQuotaError, sanitizeContents, GEMINI_DEFAULT_MODEL, type GeminiContent, type GeminiFunctionDecl } from '../lib/ai/gemini';
import { AI_PROVIDERS, providerDef, buildBaseURL, orderChain, entryTier, entryRpm, TierBucket, adaptiveInit, adaptOnSuccess, adaptOnRateLimit, type AdaptiveState, type AiChainEntry, type AiRateLimit, type AiUsage } from '../lib/ai/ai-providers';
import { openaiChat, fetchProviderModels } from '../lib/ai/openai-chat';
import { anthropicChat } from '../lib/ai/anthropic-chat';
import { storeHooks } from '../lib/runner-hooks';
import { runOneRequest, runRequestList, runCollectionWithData, collectRequests, type RunnerHooks, type RunItemResult } from '../lib/runner';
import { toCurl } from '../lib/codegen';
import { runFlow, collectRequestVars } from '../lib/flow';
import { confirmUntrustedScripts } from '../lib/scripts';
import { PM_SANDBOX_DOC, SCRIPT_SNIPPETS, snippetById, snippetsFor } from '../lib/script-snippets';
import { scriptChainFor } from '../lib/script-chain';
import { importAnyJson, summarizeImport } from '../lib/import-any';
import { getBody, saveBodies, pruneBodies } from '../lib/bodyStore';
import { summarize } from '../lib/scheduleEngine';
import { recordManualFlowRun } from '../lib/flow-runs';
import { uid, resolveVariables } from '../lib/variables';
import { saveExportBesideApp, saveDocExport } from '../lib/response-file';
import { parseDataFile } from '../lib/datafile';
import { generateCases, runTestCases, casesToCsv, csvFileName, GROUP_LABEL, type TestCase, type CaseRunResult } from '../lib/test-cases';
import { useTestCaseStore } from '../stores/testcases';
import { useMockStore } from '../stores/mock';
import { renderCollectionDocs, docsFileName } from '../lib/api-docs';
import { renderDocsHtml } from '../lib/docs-html';
import { collectDocsExtras } from '../lib/docs-input';
import { useScheduleStore } from '../stores/schedule';
import { engineRunning } from '../lib/scheduleEngine';
import { getDocTopic, listDocTopics, searchDocs } from '../lib/docs/app-guide';
import { useTranslation } from '../stores/language';
import { MarkdownMessage } from './MarkdownMessage';
import type { ApiRequest, ApiResponse, HttpMethod, KeyValue } from '../types/api';

/** Mục lục mẫu script — nhét vào prompt để model biết đường gọi get_script_snippet, không phải copy cả code. */
const SNIPPET_INDEX = SCRIPT_SNIPPETS.map(
  (s) => `- ${s.id} (${s.kind === 'pre' ? 'Pre-request' : 'Tests'}): ${s.label.vi} — ${s.hint.vi}`,
).join('\n');

const SYSTEM = `Bạn là trợ lý trong app ReqX (test API kiểu Postman). Trả lời NGẮN GỌN bằng Tiếng Việt.
Quy tắc định dạng:
- Trình bày mạch lạc, sạch đẹp, dễ nhìn.
- HẠN CHẾ lạm dụng dấu in đậm **...**. Không bọc **...** liên tục vào mọi từ, URL, method hoặc tên trường. Chỉ in đậm tiêu đề mục hoặc từ khóa trọng tâm.
- URL, method, tên biến, status code hoặc mã code ngắn hãy đặt trong dấu backtick \`...\` (ví dụ: \`POST\`, \`http://...\`, \`Authorization\`, \`200 OK\`, \`401 Unauthorized\`).
- Sử dụng danh sách gạch đầu dòng (-) hoặc số (1. 2.) rõ ràng, súc tích.

Bạn có tools để xem và điều khiển app. Quy tắc:
- Khi người dùng hỏi về tính năng của reqX, cách sử dụng, phím tắt, cấu hình, CLI, script, runner, flow, mock, environment: BẮT BUỘC gọi tool get_feature_guide để tra cứu tài liệu chính thống của app rồi giải thích chi tiết, kèm ví dụ cụ thể.
- Khi người dùng nhắc tên (collection/request/flow/env): gọi tool list tương ứng trước để kiểm tra. Nếu KHÔNG có tên khớp chính xác 100% (hoặc có nhiều tên gần giống, VD người dùng bảo 'order/get' nhưng chỉ có 'order/print by id' hoặc 'order/get by id'): BẮT BUỘC liệt kê các request tìm được và HỎI LẠI người dùng để xác nhận, TUYỆT ĐỐI KHÔNG tự ý chọn bừa request khác để sửa hay chèn script.
- Được phép gửi request / chạy flow / đổi biến NGAY, không cần xin phép thêm (app đã hỏi riêng khi gặp script lạ).
- Tóm tắt kết quả gọn: status, thời gian, tests pass/fail, biến trích được. Không dán cả body dài.
- Không bịa tên — chỉ dùng tên/id do tool trả về.
- Muốn nhập collection/flow: nhờ người dùng dán nguyên văn JSON vào chat, rồi gọi import_json (không tự bịa JSON).
- Muốn TẠO flow mới từ request có sẵn: gọi list_requests lấy tên đúng trước, rồi gọi create_flow (extract dạng "tenBien=duongDan"). Xong thì tóm tắt các bước + hỏi có chạy thử không.
- Muốn CHẠY collection: gọi run_collection (kết quả tự lưu lịch sử tab Runner). Tóm tắt gọn từng request, không dán body dài.
- Muốn CHẠY BULK nhiều data: hỏi data (người dùng dán CSV/JSON, dòng đầu là tên cột = tên biến) HOẶC tự sinh N dòng test từ cấu trúc body (xem {{bien}} bằng get_request, sinh đủ case: khác nhau/giống nhau/dấu tiếng Việt/bỏ trống) → gọi run_collection_data → gọi export_last_run xuất file CSV (giờ chạy, curl, response).
- Sau khi gọi tool xong (NHẤT LÀ khi có tool lỗi): LUÔN nhắn tóm tắt tiếng Việt — đã làm gì, tool nào lỗi + nguyên nhân + cách sửa cụ thể (VD data thiếu dòng tiêu đề thì viết lại data đúng cho người dùng copy), rồi hỏi tiếp. Không bao giờ chỉ gọi tool rồi im.
- Muốn SỬA request có sẵn hoặc CHÈN SCRIPT (Pre-request/Tests): gọi update_request. TRỰC TIẾP truyền code JS vào biến pre_request hoặc tests để chèn thẳng vào DB. KHÔNG bảo người dùng copy thủ công.
- VIẾT SCRIPT: CHỈ dùng đúng những hàm liệt kê ở mục "SANDBOX ReqX" cuối prompt. KHÔNG bịa API của Postman — mấy thứ sau KHÔNG tồn tại ở ReqX: 'pm.request' trong script Tests, chuỗi '.to.not.*' (Chai), 'formdata' trong pm.sendRequest, 'pm.expect(...).to.throw()', hàm async truyền vào pm.test, require/import, gọi fetch trực tiếp.
- Trước khi tự viết script lấy token / ký chữ ký / kiểm field: gọi get_script_snippet để lấy nguyên văn MẪU ĐÃ CHẠY THẬT rồi chỉ sửa các chỗ đánh "// SỬA". Chỉ tự viết khi không mẫu nào phù hợp.
- KHI CẦN TOKEN / THIẾU AUTH (HTTP 401): Tra cứu xem trong collection có request đăng nhập hoặc biến môi trường chưa (gọi list_requests, list_envs). TUYỆT ĐỐI KHÔNG tự bịa URL/endpoint giả lập (như auth.example.com, /api/login, localhost/auth...) để chèn script lấy token khi chưa biết endpoint thật. Nếu không thấy request đăng nhập nào trong collection, BẮT BUỘC DỪNG VÀ HỎI NGƯỜI DÙNG: endpoint API lấy token là gì, hoặc nhờ người dùng cung cấp token / biến môi trường.
- SAU KHI ghi script, kết quả tool sẽ có field "tu_kiem_chung": với update_request / update_current_request / create_request thì app ĐÃ tự gửi thử 1 lần để kiểm chứng; với set_scope_scripts thì field này chỉ báo "skipped" ⇒ phải tự gọi send_request trên 1 request AN TOÀN (không phải request ghi/xóa) trong phạm vi. Nếu "tu_kiem_chung.scriptError" có nội dung ⇒ được phép sửa script tối đa 2 lần. NẾU LỖI LÀ HTTP 404 (endpoint không tồn tại) HOẶC 401/403 (sai credential): DỪNG NGAY LẬP TỨC, KHÔNG retry đoán mò URL khác; báo rõ cho người dùng để họ cung cấp URL hoặc token đúng. CẤM nói "đã xong/đã chèn script" khi "tu_kiem_chung" đang báo lỗi.
- Muốn đọc body response của step: gọi get_step_body (có phân trang offset/limit, đừng đoán nội dung body).
- Khi người dùng hỏi "tại sao request fail / lỗi", "giải thích kết quả/response vừa nhận", "tại sao API trả về...", hoặc cần viết test/assertion dựa trên response thực tế: BẮT BUỘC gọi get_last_response để đọc status, headers và body response (đừng đoán). Nếu body quá dài thì đọc tiếp bằng offset/limit.
- Khi người dùng bảo "lên key test / lập bộ test / test API này tự động": gọi generate_test_cases (request_ref để trống = request đang mở) → bảng duyệt sẽ mở. KHÔNG tự bịa bộ case trong tin nhắn. Muốn đổi mong đợi theo nghiệp vụ (VD "thiếu invoiceno phải 400") thì gọi refine_test_case. Sau đó run_test_cases rồi export_test_cases để ra file Excel; tóm tắt bao nhiêu case ✅/❌ và case nào ❌ đáng chú ý.
- Muốn TẠO hoặc QUẢN LÝ Mock Server / API giả lập: gọi list_mock_rules, create_mock_rule, toggle_mock_server (bật/tắt server, tạo endpoint mock trả về JSON/text giả lập theo yêu cầu).
- Muốn XUẤT TÀI LIỆU API (API Docs) của Collection / Folder: gọi export_api_docs (hỗ trợ định dạng HTML tra cứu trực quan hoặc Markdown chuẩn để commit Git).

${PM_SANDBOX_DOC}

MẪU SCRIPT ĐÃ CHẠY THẬT (vitest chứng minh từng mẫu — gọi get_script_snippet(id) để lấy nguyên văn code):
${SNIPPET_INDEX}`;

const TOOLS: GeminiFunctionDecl[] = [
  { name: 'list_collections', description: 'Liệt kê collections (id, tên, số request).', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'list_requests', description: 'Liệt kê request trong 1 collection.', parameters: { type: 'OBJECT', properties: { collection_ref: { type: 'STRING', description: 'id hoặc tên collection' } }, required: ['collection_ref'] } },
  { name: 'get_request', description: 'Xem chi tiết 1 request (method, url, headers, body rút gọn).', parameters: { type: 'OBJECT', properties: { request_ref: { type: 'STRING', description: 'id hoặc tên request' } }, required: ['request_ref'] } },
  { name: 'open_request', description: 'Mở request lên Builder để người dùng xem/sửa.', parameters: { type: 'OBJECT', properties: { request_ref: { type: 'STRING', description: 'id hoặc tên request' } }, required: ['request_ref'] } },
  { name: 'send_request', description: 'Gửi 1 request (chạy pre-request → gửi → tests) và trả kết quả.', parameters: { type: 'OBJECT', properties: { request_ref: { type: 'STRING', description: 'id hoặc tên request' } }, required: ['request_ref'] } },
  { name: 'list_flows', description: 'Liệt kê flows (id, tên, số step).', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'run_flow', description: 'Chạy 1 flow (nối nhiều request), kết quả tự lưu vào lịch sử chạy của flow. Muốn đọc body response từng step thì gọi tiếp get_step_body.', parameters: { type: 'OBJECT', properties: { flow_ref: { type: 'STRING', description: 'id hoặc tên flow' } }, required: ['flow_ref'] } },
  { name: 'get_step_body', description: 'Đọc response body của 1 step trong lần chạy flow gần nhất (kể cả lần chạy từ tab Flow). Body dài thì đọc từng đoạn bằng offset/limit.', parameters: { type: 'OBJECT', properties: { flow_ref: { type: 'STRING', description: 'id hoặc tên flow' }, step: { type: 'STRING', description: 'số thứ tự step (0, 1, 2...) hoặc tên step' }, offset: { type: 'NUMBER', description: 'vị trí bắt đầu (mặc định 0)' }, limit: { type: 'NUMBER', description: 'số ký tự tối đa (mặc định 4000, tối đa 20000)' } }, required: ['flow_ref', 'step'] } },
  { name: 'get_last_response', description: 'Đọc chi tiết kết quả response (status, headers, body, thời gian) của request đang mở trong Builder hoặc từ lịch sử gửi gần đây. Dùng khi người dùng hỏi "tại sao request này fail?", "giải thích response vừa nhận", "viết test dựa trên response vừa chạy", v.v. Hỗ trợ phân trang offset/limit cho body dài.', parameters: { type: 'OBJECT', properties: { request_ref: { type: 'STRING', description: 'id, tên hoặc url của request cần xem response. Để trống = lấy response của tab hiện tại hoặc lần gửi gần nhất.' }, offset: { type: 'NUMBER', description: 'Vị trí bắt đầu cắt body (mặc định 0).' }, limit: { type: 'NUMBER', description: 'Số ký tự tối đa của body (mặc định 4000, tối đa 20000).' } } } },
  { name: 'list_envs', description: 'Liệt kê environments (id, tên, env đang active, biến thường + TÊN biến secret trong secretVars/globalSecrets — chỉ tên, không có giá trị).', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'set_active_env', description: 'Đổi environment đang dùng.', parameters: { type: 'OBJECT', properties: { env_ref: { type: 'STRING', description: 'id hoặc tên env' } }, required: ['env_ref'] } },
  { name: 'set_variable', description: 'Gán biến (env = env đang active, global = dùng chung).', parameters: { type: 'OBJECT', properties: { scope: { type: 'STRING', enum: ['env', 'global'] }, key: { type: 'STRING' }, value: { type: 'STRING' } }, required: ['scope', 'key', 'value'] } },
  { name: 'create_request', description: 'Tạo request mới trong collection.', parameters: { type: 'OBJECT', properties: { collection_ref: { type: 'STRING', description: 'id/tên collection (trống = đầu tiên)' }, name: { type: 'STRING' }, method: { type: 'STRING', description: 'GET POST PUT PATCH DELETE HEAD OPTIONS' }, url: { type: 'STRING' }, body: { type: 'STRING', description: 'body raw (nếu có)' }, headers: { type: 'STRING', description: 'JSON mảng ["Key: value", ...] (nếu có)' }, auth: { type: 'STRING', description: '"none" | "bearer TOKEN" (TOKEN chứa {{bien}} được) | "header Tên-Header: giá-trị" — VD "bearer {{access_token}}"' }, pre_request: { type: 'STRING', description: 'Mã JS chạy trước khi gửi (gán biến, tạo token)' }, tests: { type: 'STRING', description: 'Mã JS chạy sau khi gửi (kiểm tra response)' } }, required: ['name', 'method', 'url'] } },
  { name: 'import_json', description: 'Nhập collection/flow từ JSON do người dùng dán vào chat (Postman v2.1, flow ReqX, file gộp, backup).', parameters: { type: 'OBJECT', properties: { content: { type: 'STRING', description: 'Nguyên văn JSON cần nhập (dưới ~200KB)' } }, required: ['content'] } },
  { name: 'create_flow', description: 'Tạo flow mới từ các request có sẵn (nối nhiều bước, trích biến bước trước cho bước sau). Mỗi step: request_ref (id/tên request) + extract (mảng "tenBien=duongDan", VD "token=access_token"). Luôn gọi list_requests trước để lấy tên request đúng, không bịa request.', parameters: { type: 'OBJECT', properties: { name: { type: 'STRING', description: 'Tên flow' }, steps: { type: 'STRING', description: 'JSON mảng step: [{"request":"tên/id request","extract":["token=access_token"]}]' } }, required: ['name', 'steps'] } },
  { name: 'run_collection', description: 'Chạy Runner cho 1 collection/folder (tuần tự từng request kèm pre-request + tests). Collection dài quá 20 request thì chỉ chạy 20 cái đầu. Kết quả tự lưu vào lịch sử chạy của collection.', parameters: { type: 'OBJECT', properties: { collection_ref: { type: 'STRING', description: 'id hoặc tên collection' }, folder_ref: { type: 'STRING', description: 'id/tên folder, hoặc "root", trống = tất cả' } }, required: ['collection_ref'] } },
  { name: 'run_collection_data', description: 'Chạy BULK: mỗi dòng data = 1 iteration chạy hết collection/folder (kiểu Postman data file). Data do người dùng dán vào chat HOẶC do bạn tự sinh N dòng test từ cấu trúc body (dùng get_request xem {{bien}} trước). Tối đa 50 dòng/lần. Chạy xong gọi export_last_run để xuất file CSV.', parameters: { type: 'OBJECT', properties: { collection_ref: { type: 'STRING', description: 'id hoặc tên collection' }, folder_ref: { type: 'STRING', description: 'id/tên folder, hoặc "root", trống = tất cả' }, data: { type: 'STRING', description: 'Nguyên văn CSV (dòng đầu là tên cột = tên biến) hoặc JSON mảng object' }, max_rows: { type: 'NUMBER', description: 'Số dòng tối đa (mặc định 20, tối đa 50)' } }, required: ['collection_ref', 'data'] } },
  { name: 'export_last_run', description: 'Xuất file CSV kết quả của lần chạy bulk gần nhất (giờ chạy, iteration, request, curl đã resolve, status, thời gian, tests, lỗi, response rút gọn). File lưu cạnh app bản exe (bản web thì tải về Downloads).', parameters: { type: 'OBJECT', properties: { format: { type: 'STRING', description: '"csv" (mặc định) hoặc "markdown"' } } } },
  { name: 'update_request', description: 'Sửa request có sẵn (đổi URL/method/thêm header/auth/body/script mà không cần tạo mới). headers là JSON mảng ["Key: value"] — gộp theo tên (có rồi thì đè, chưa có thì thêm). auth như create_request. Chỉ truyền field cần đổi.', parameters: { type: 'OBJECT', properties: { request_ref: { type: 'STRING', description: 'id hoặc tên request' }, name: { type: 'STRING' }, method: { type: 'STRING', description: 'GET POST PUT PATCH DELETE HEAD OPTIONS' }, url: { type: 'STRING' }, headers: { type: 'STRING', description: 'JSON mảng ["Key: value", ...] — gộp vào headers cũ' }, body: { type: 'STRING' }, auth: { type: 'STRING', description: '"none" | "bearer TOKEN" | "header Tên: giá-trị"' }, pre_request: { type: 'STRING', description: 'Mã JS chạy trước khi gửi (gán biến, tạo token)' }, tests: { type: 'STRING', description: 'Mã JS chạy sau khi gửi (kiểm tra response)' } }, required: ['request_ref'] } },
  { name: 'export_git_workspace', description: 'Xuất toàn bộ Workspace hiện tại thành các file JSON lưu vào thư mục reqx_workspace để chuẩn bị commit Git.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'import_git_workspace', description: 'Đọc thư mục reqx_workspace trên ổ cứng (vd khi đồng nghiệp vừa push code về) và nạp đè vào App.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'list_schedules', description: 'Liệt kê schedules chạy tự động (id, tên, loại, interval, enabled, giờ chạy kế).', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'create_schedule', description: 'Tạo schedule mới cho collection/flow chạy định kỳ. intervalMin (phút), folder_ref ("root" hoặc id folder, trống = tất cả), flow_ref (id/tên flow, chỉ dùng khi kind="flow").', parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' }, kind: { type: 'STRING', enum: ['collection', 'flow'] }, collection_ref: { type: 'STRING', description: 'id/tên collection (khi kind="collection")' }, folder_ref: { type: 'STRING', description: 'id/tên folder hoặc "root", trống = tất cả' }, flow_ref: { type: 'STRING', description: 'id/tên flow (khi kind="flow")' }, intervalMin: { type: 'NUMBER', description: 'Số phút giữa các lần chạy (mặc định 60)' }, notify: { type: 'BOOLEAN', description: 'Bật thông báo desktop (mặc định true)' } }, required: ['name', 'kind'] } },
  { name: 'delete_schedule', description: 'Xóa schedule theo id/tên.', parameters: { type: 'OBJECT', properties: { schedule_ref: { type: 'STRING', description: 'id hoặc tên schedule' } }, required: ['schedule_ref'] } },
  { name: 'toggle_schedule', description: 'Bật/tắt schedule theo id/tên.', parameters: { type: 'OBJECT', properties: { schedule_ref: { type: 'STRING', description: 'id hoặc tên schedule' }, enabled: { type: 'BOOLEAN', description: 'true = bật, false = tắt' } }, required: ['schedule_ref', 'enabled'] } },
  { name: 'get_run_history', description: 'Xem lịch sử chạy của collection/flow/request (20 lần gần nhất). Trả về status, thời gian, tests pass/fail.', parameters: { type: 'OBJECT', properties: { ref_type: { type: 'STRING', enum: ['collection', 'flow', 'request'] }, ref_id: { type: 'STRING', description: 'id của collection/flow/request' }, limit: { type: 'NUMBER', description: 'Số entry tối đa (mặc định 20, tối đa 50)' } }, required: ['ref_type', 'ref_id'] } },
  { name: 'get_current_tab_request', description: 'Lấy request đang mở trong tab Builder hiện tại (để AI biết ngữ cảnh khi user hỏi "sửa header này").', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'update_current_request', description: 'Sửa request đang mở trong tab Builder (không cần tìm theo id/name). headers là JSON mảng ["Key: value"] — gộp vào headers cũ. auth như create_request. Chỉ truyền field cần đổi.', parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' }, method: { type: 'STRING', description: 'GET POST PUT PATCH DELETE HEAD OPTIONS' }, url: { type: 'STRING' }, headers: { type: 'STRING', description: 'JSON mảng ["Key: value", ...] — gộp vào headers cũ' }, body: { type: 'STRING' }, auth: { type: 'STRING', description: '"none" | "bearer TOKEN" | "header Tên: giá-trị"' }, pre_request: { type: 'STRING', description: 'Mã JS chạy trước khi gửi (gán biến, tạo token)' }, tests: { type: 'STRING', description: 'Mã JS chạy sau khi gửi (kiểm tra response)' } } } },
  { name: 'import_postman_files', description: 'Import hàng loạt file/collection từ Postman export. Nhận JSON array chứa nội dung các file .postman_collection.json (user paste hoặc AI đọc từ folder). Tối đa 50 file/lần.', parameters: { type: 'OBJECT', properties: { files: { type: 'STRING', description: 'JSON array chứa nội dung các file Postman collection (mỗi phần tử là object JSON của 1 file)' } }, required: ['files'] } },
  { name: 'set_scope_scripts', description: 'Đọc hoặc sửa script ở mức collection/folder (pre-request + tests). Script này chạy cho MỌI request trong phạm vi, kế thừa xuống folder con lẫn request con.', parameters: { type: 'OBJECT', properties: { collection_ref: { type: 'STRING', description: 'id hoặc tên collection' }, folder_ref: { type: 'STRING', description: 'id/tên folder — trống = mức collection' }, pre_request: { type: 'STRING', description: 'Nội dung pre-request mới; không truyền = chỉ đọc' }, tests: { type: 'STRING', description: 'Nội dung tests mới; không truyền = chỉ đọc' } }, required: ['collection_ref'] } },
  { name: 'get_script_snippet', description: 'Lấy nguyên văn 1 MẪU SCRIPT ĐÃ CHẠY THẬT trong sandbox ReqX (đã kiểm chứng bằng vitest): lấy token client_credentials, đăng nhập JSON lấy token, ký HMAC, gắn header từ biến, test status/time, test field bắt buộc, test JSON Schema, test có token. Ưu tiên dùng mẫu này thay vì tự viết, rồi chỉ sửa chỗ đánh "// SỬA". Để trống id = trả danh sách mẫu kèm hint.', parameters: { type: 'OBJECT', properties: { id: { type: 'STRING', description: 'id mẫu (VD token-client-credentials) — trống = liệt kê hết' }, kind: { type: 'STRING', enum: ['pre', 'tests'], description: 'chỉ lấy mẫu loại này (khi không truyền id)' } } } },
  { name: 'generate_test_cases', description: 'LÊN KEY TEST tự động cho 1 request: đọc field trong body JSON (kể cả mảng/object lồng nhau), query, header rồi sinh bộ case cực đoan. Nhóm null/rỗng luôn sinh đầu tiên cho MỌI field: thiếu key, null, chuỗi "", chỉ khoảng trắng, mảng rỗng [], object rỗng {}, body = {}, bỏ hẳn body. Field nghi bắt buộc (id/no/code/amount/date/action/type/name) mong đợi 4xx; field optional mong đợi "any". Ngoài ra: sai kiểu, số âm/0/rất lớn, ngày sai định dạng, chuỗi dài, ký tự Việt & đặc biệt, token sai, quét giá trị action. Mở bảng duyệt để người dùng sửa tên/data/mong đợi từng case, rồi chạy.', parameters: { type: 'OBJECT', properties: { request_ref: { type: 'STRING', description: 'id hoặc tên request — trống = request đang mở trong Builder' }, max_cases: { type: 'NUMBER', description: 'Số case tối đa (mặc định 40)' }, expect_hint: { type: 'STRING', description: 'Gợi ý kết quả đúng, VD "400 khi thiếu invoiceno" — sẽ ghi vào note' } }, required: [] } },
  { name: 'refine_test_case', description: 'Sửa 1 case trong bảng key test đang mở (đổi tên/nhóm/data/mong đợi status/mong đợi body chứa) theo nghiệp vụ, VD đổi case "null cho totalamount" từ any sang 400. Dùng số thứ tự hoặc case_id.', parameters: { type: 'OBJECT', properties: { case: { type: 'STRING', description: 'case_id hoặc số thứ tự case (1 = đầu tiên)' }, name: { type: 'STRING' }, data: { type: 'STRING', description: 'JSON object {"ten field":"gia tri"}; "<<xóa field>>" = bỏ hẳn key, "<<null>>" = gửi null, "" = chuỗi rỗng; key "body" (không có dấu :) thay cả body, VD {"body":"{}"}' }, expect_status: { type: 'STRING', description: '2xx | 4xx | 401 | 200 | !=200 | >=400 | any' }, expect_contains: { type: 'STRING', description: 'Chuỗi phải có trong response body (rỗng = không kiểm)' } }, required: ['case'] } },
  { name: 'run_test_cases', description: 'Chạy bộ key test đang mở (từng case = 1 lần gửi request với dữ liệu case, kèm pre-request + tests). Kết quả ✅/❌ so với mong đợi từng case hiện ngay ở bảng. Sau đó gọi export_test_cases để xuất file Excel.', parameters: { type: 'OBJECT', properties: { limit: { type: 'NUMBER', description: 'Số case tối đa để chạy (mặc định 25, tối đa 60)' } }, required: [] } },
  { name: 'export_test_cases', description: 'Xuất bộ key test + kết quả vừa chạy ra file CSV có BOM (mở trực tiếp bằng Excel, tiếng Việt không lỗi font): 1 dòng = 1 case với dữ liệu, mong đợi, status, kết luận, lý do, thời gian, response tóm tắt, curl đã che secret. File lưu cạnh app (bản web tải về Downloads).', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'get_feature_guide', description: 'Tra cứu tài liệu hướng dẫn sử dụng tính năng của ReqX (overview, builder-requests, environments, scripts-sandbox, runner-and-data, flows, mock-server, protocols, cli, ai-assistant, shortcuts). Để trống topic hoặc truyền "list" để lấy mục lục tất cả tính năng.', parameters: { type: 'OBJECT', properties: { topic: { type: 'STRING', description: 'Tên topic hoặc từ khóa cần tra cứu: "overview", "builder-requests", "environments", "scripts-sandbox", "runner-and-data", "flows", "mock-server", "protocols", "cli", "ai-assistant", "shortcuts", hoặc từ khóa tự do (VD: "token", "csv", "git", "pre-request", "tab", "oauth2")' } } } },
  { name: 'list_mock_rules', description: 'Liệt kê các quy tắc giả lập (mock rules) hiện có trong Mock Server của ReqX, trạng thái bật/tắt server và cổng port.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'create_mock_rule', description: 'Tạo quy tắc phản hồi giả lập mới (Mock endpoint) trên ReqX Mock Server: chỉ định HTTP method, đường dẫn path (vd /api/users, /api/auth/login), mã trạng thái status_code (200, 201, 404...), độ trễ delay_ms, headers và nội dung response_body (JSON hoặc text).', parameters: { type: 'OBJECT', properties: { name: { type: 'STRING', description: 'Tên gợi nhớ của mock rule (VD "Mock Danh sách User")' }, method: { type: 'STRING', description: 'GET, POST, PUT, DELETE, PATCH hoặc ALL' }, path: { type: 'STRING', description: 'Đường dẫn endpoint (VD /api/v1/orders hoặc /api/users/:id)' }, status_code: { type: 'NUMBER', description: 'Mã HTTP status trả về (mặc định 200)' }, response_body: { type: 'STRING', description: 'Nội dung phản hồi (JSON string hoặc text)' }, delay_ms: { type: 'NUMBER', description: 'Độ trễ giả lập (ms, mặc định 0)' }, headers: { type: 'STRING', description: 'JSON mảng ["Key: value"] hoặc JSON object các header trả về' } }, required: ['name', 'method', 'path'] } },
  { name: 'toggle_mock_server', description: 'Bật hoặc tắt Mock Server cục bộ của ReqX, hoặc đổi cổng port (mặc định 3001).', parameters: { type: 'OBJECT', properties: { running: { type: 'BOOLEAN', description: 'true = bật server, false = tắt server. Để trống = đảo trạng thái.' }, port: { type: 'NUMBER', description: 'Cổng port chạy Mock Server (từ 1024 đến 65535, mặc định 3001)' } } } },
  { name: 'export_api_docs', description: 'Xuất toàn bộ tài liệu API của 1 Collection hoặc Folder ra file HTML đẹp mắt (mở bằng trình duyệt, có ô tìm kiếm, badge method màu) hoặc Markdown (để commit Git). File lưu cạnh app.', parameters: { type: 'OBJECT', properties: { collection_ref: { type: 'STRING', description: 'id hoặc tên collection cần xuất tài liệu' }, folder_ref: { type: 'STRING', description: 'id hoặc tên folder con (để trống = xuất cả collection)' }, format: { type: 'STRING', enum: ['html', 'md'], description: '"html" (mặc định, giao diện web tra cứu) hoặc "md" (file Markdown chuẩn)' } }, required: ['collection_ref'] } },
];

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function matchByRef<T>(list: T[], ref: string, get: (t: T) => { id: string; name: string }): T | null {
  const t = ref.trim().toLowerCase();
  if (!t) return null;
  return list.find((x) => get(x).id === ref)
    // Tên khớp tuyệt đối trước (tránh "flow 1" chạy nhầm sang flow khác tên gần giống)
    ?? list.find((x) => get(x).name.trim().toLowerCase() === t)
    ?? list.find((x) => get(x).name.toLowerCase().includes(t)) ?? null;
}

/** "Key: value" → {key, value} (cắt ở dấu : đầu tiên). */
function splitHeadLine(line: string): { key: string; value: string } | null {
  const i = line.indexOf(':');
  if (i <= 0) return null;
  const key = line.slice(0, i).trim();
  const value = line.slice(i + 1).trim();
  return key ? { key, value } : null;
}

/** Parse headers do AI đưa: JSON mảng ["K: v"] / object / mỗi dòng "K: v". */
function parseHeaderSpec(raw: string): { key: string; value: string }[] {
  const t = (raw ?? '').trim();
  if (!t) return [];
  try {
    const j = JSON.parse(t);
    if (Array.isArray(j)) {
      return j.map((x) => splitHeadLine(String(x ?? ''))).filter((x): x is { key: string; value: string } => !!x);
    }
    if (j && typeof j === 'object') {
      return Object.entries(j as Record<string, unknown>)
        .filter(([k]) => k.trim() !== '')
        .map(([key, value]) => ({ key: key.trim(), value: String(value ?? '') }));
    }
  } catch { /* rớt xuống parse từng dòng */ }
  return t.split('\n').map((l) => splitHeadLine(l.trim())).filter((x): x is { key: string; value: string } => !!x);
}

/**
 * Parse auth do AI đưa: "none" | "bearer TOKEN" | "header Tên: giá-trị".
 * Header tùy ý đi qua dạng apikey-in-header (http-client/codegen đã hỗ trợ).
 * Trả null khi sai cú pháp (tool báo lỗi + hướng dẫn lại).
 */
function parseAuthSpec(raw: string): ApiRequest['auth'] | null {
  const t = (raw ?? '').trim();
  if (!t || t.toLowerCase() === 'none') return { type: 'none' };
  let m = /^bearer\s+(.+)$/is.exec(t);
  if (m) return { type: 'bearer', token: m[1].trim() };
  m = /^header\s+([^:]+):\s*(.+)$/is.exec(t);
  if (m) return { type: 'apikey', apiKeyIn: 'header', apiKeyName: m[1].trim(), apiKey: m[2].trim() };
  return null;
}

function aiHooks(): RunnerHooks {
  return storeHooks();
}

/**
 * AI vừa ghi script (pre_request/tests) thì app **tự gửi thử 1 lần** và nhét kết quả vào
 * chính tool response — model nhìn thấy lỗi là phải sửa, không cần tin nó "tự giác".
 * Tắt được bằng công tắc "Tự chạy thử script" (store: aiAutoVerify).
 */
async function selfVerifyScript(req: ApiRequest): Promise<Record<string, unknown>> {
  const app = useAppStore.getState();
  if (!app.aiAutoVerify) return { skipped: 'người dùng tắt công tắc "Tự chạy thử script" trong panel AI' };
  if (!confirmUntrustedScripts([req], `AI tự chạy thử “${req.name}” để kiểm chứng script vừa ghi`, app.collections)) {
    return { skipped: 'người dùng từ chối chạy thử script lạ' };
  }
  const r = await runOneRequest(req, aiHooks(), 30000, undefined, undefined, app.collections);
  return {
    da_gui_thu: true,
    ok: r.ok,
    status: r.status,
    timeMs: r.timeMs,
    tests: `${r.testsPassed}/${r.testsTotal}`,
    scriptError: r.error,
    logs: r.logs.slice(-8),
    huong_dan: r.error
      ? 'Script vừa ghi chạy lỗi — đối chiếu mục "SANDBOX ReqX", gọi get_script_snippet lấy mẫu đúng, sửa rồi gọi lại update_request (tối đa 3 vòng), sau đó mới báo cáo.'
      : 'Script chạy sạch, không cần làm gì thêm.',
  };
}

/** Tool trả về: có ghi script thì gắn thêm phần tự kiểm chứng. */
async function withSelfCheck(
  base: Record<string, unknown>,
  args: Record<string, unknown>,
  req: ApiRequest | null,
): Promise<Record<string, unknown>> {
  const wroteScript =
    (typeof args.pre_request === 'string' && args.pre_request.trim() !== '') ||
    (typeof args.tests === 'string' && args.tests.trim() !== '');
  if (!wroteScript || !req) return base;
  return { ...base, tu_kiem_chung: await selfVerifyScript(req) };
}

/** Kết quả bulk gần nhất do AI chạy (để export_last_run xuất file). */
interface BulkRow {
  rowIndex: number;
  row: Record<string, string>;
  requestId: string;
  name: string;
  method: string;
  url: string;
  curl: string;
  ok: boolean;
  status?: number;
  timeMs?: number;
  tests: string;
  error?: string;
  response: string;
}
let lastAiBulkRun: { at: number; refName: string; rows: BulkRow[] } | null = null;

type AppState = ReturnType<typeof useAppStore.getState>;

/** Tìm collection + folder theo tên/id (dùng chung cho run_collection/run_collection_data). */
function resolveScope(app: AppState, colRef: string, folderRef: string):
  | { error: string }
  | { col: AppState['collections'][number]; folderId: string; scopeName: string } {
  const col = matchByRef(app.collections, colRef, (c) => c);
  if (!col) return { error: 'Không tìm thấy collection.' };
  const fref = folderRef.trim().toLowerCase();
  let folderId = 'all';
  let scopeName = 'Tất cả';
  if (fref === 'root') {
    folderId = 'root';
    scopeName = 'Ngoài thư mục';
  } else if (fref) {
    const f = col.folders.find((x) => x.id === folderRef || x.name.toLowerCase().includes(fref));
    if (!f) return { error: `Không thấy folder “${folderRef}” (có: ${col.folders.map((x) => x.name).join(', ') || 'không có folder'}).` };
    folderId = f.id;
    scopeName = `📁 ${f.name}`;
  }
  return { col, folderId, scopeName };
}

/** Lưu lịch sử chạy collection như bấm ở tab Runner. */
async function saveCollectionRun(refId: string, refName: string, at: number, collected: RunItemResult[], elapsedMs: number) {
  const { steps, bodies } = summarize(`manual-col:${refId}`, at, collected);
  await saveBodies(bodies);
  useFlowStore.getState().pushRun({
    kind: 'collection', refId, refName, at,
    ok: collected.filter((r) => r.ok).length,
    total: collected.length,
    timeMs: Math.round(elapsedMs),
    steps,
  });
  void pruneBodies(
    `manual-col:${refId}`,
    new Set(useFlowStore.getState().runs.filter((r) => r.kind === 'collection' && r.refId === refId).map((r) => r.at)),
  );
}

export default function AiAssistant({
  onGoBuilder,
  onClose,
}: {
  onGoBuilder?: () => void;
  onClose?: () => void;
}) {
  const { t, lang } = useTranslation();
  const { aiChain, setAiChain, bumpAiRr, aiStrategy, setAiStrategy, aiAutoVerify, setAiAutoVerify, aiStats, recordAiUsage, clearAiStats, aiChat, pushAiChat, aiContents, setAiContents, clearAiChat } = useAppStore();
  // Khung chain xếp gọn được — có provider dùng được thì mặc định gọn để chat chiếm hết chỗ
  const [showKeys, setShowKeys] = useState(() => orderChain(useAppStore.getState().aiChain, 0, useAppStore.getState().aiStrategy).length === 0);
  // Seed 1 lần từ key Gemini cũ (aiKey/aiKeyBackup) sang chain mới để không mất cấu hình
  useEffect(() => {
    const s = useAppStore.getState();
    if (s.aiChain.length === 0 && (s.aiKey || s.aiKeyBackup)) {
      const mk = (key: string): AiChainEntry | null =>
        key.trim() ? { id: uid('aich'), providerId: 'gemini', model: s.aiModel || GEMINI_DEFAULT_MODEL, key: key.trim(), enabled: true } : null;
      s.setAiChain([mk(s.aiKey), mk(s.aiKeyBackup)].filter((e): e is AiChainEntry => !!e));
    }
  }, []);
  const updEntry = (id: string, patch: Partial<AiChainEntry>) =>
    setAiChain(aiChain.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const moveEntry = (id: string, dir: -1 | 1) => {
    const i = aiChain.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= aiChain.length) return;
    const n = [...aiChain];
    [n[i], n[j]] = [n[j], n[i]];
    setAiChain(n);
  };
  const delEntry = (id: string) => setAiChain(aiChain.filter((e) => e.id !== id));
  const addEntry = () => {
    const d = AI_PROVIDERS[0];
    setAiChain([...aiChain, { id: uid('aich'), providerId: d.id, model: d.defaultModel, key: '', enabled: true }]);
  };
  const enabledList = aiChain.filter((e) => e.enabled);
  /** entryId -> danh sách model lấy từ API của key đó (để chọn trong ô Model) */
  const [fetched, setFetched] = useState<Record<string, string[]>>({});
  const [loadingModels, setLoadingModels] = useState<string | null>(null);
  /** entryId đang ở chế độ tự gõ model (thay vì chọn từ danh sách) */
  const [customModel, setCustomModel] = useState<string | null>(null);
  const loadModels = async (e: AiChainEntry) => {
    const def = providerDef(e.providerId) ?? AI_PROVIDERS[0];
    setLoadingModels(e.id);
    try {
      const list = await fetchProviderModels(def, e.key, e.accountId, e.customBaseURL);
      setFetched((f) => ({ ...f, [e.id]: list }));
      const succMsg = (t.ai.fetchedModelsSuccess as string)
        .replace('{name}', def.name)
        .replace('{count}', String(list.length));
      push({ role: 'tool', text: succMsg });
    } catch (err) {
      push({ role: 'tool', text: `❌ ${def.name}: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}` });
    } finally {
      setLoadingModels(null);
    }
  };
  // Lịch sử chat nằm ở store (persist) — đổi tab hay tắt app mở lại vẫn còn, chat tiếp được.
  const msgs = aiChat;
  const [input, setInput] = useState('');
  // Nút "✨ AI viết script" ở RequestTabs ghi prompt tạm → nhận rồi xóa
  const aiSeedPrompt = useAppStore((s) => s.aiSeedPrompt);
  useEffect(() => {
    if (!aiSeedPrompt) return;
    setInput(aiSeedPrompt);
    useAppStore.getState().setAiSeedPrompt(null);
  }, [aiSeedPrompt]);
  const [busy, setBusy] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [hoveredPrompt, setHoveredPrompt] = useState<string | null>(null);
  const copyText = async (text: string, index: number) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedIdx(index);
      setTimeout(() => setCopiedIdx((curr) => (curr === index ? null : curr)), 1800);
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
    }
  };
  const contentsRef = useRef<GeminiContent[]>(sanitizeContents(aiContents));
  /** Bucket đếm RPM + trạng thái học trần (AIMD) + breaker khóa tạm — giữ suốt session */
  const bucketsRef = useRef<Record<string, { b: TierBucket; rpm: number }>>({});
  const breakersRef = useRef<Record<string, number>>({});
  const adaptiveRef = useRef<Record<string, AdaptiveState>>({});
  const boxRef = useRef<HTMLDivElement | null>(null);

  const scrollDown = () => requestAnimationFrame(() => boxRef.current?.scrollTo({ top: 1e9 }));
  const push = (m: AiChatMsg) => {
    pushAiChat(m);
    scrollDown();
  };
  // Mở tab là nhảy xuống tin mới nhất (đọc tiếp mạch cũ)
  useEffect(() => { scrollDown(); }, []);

  const str = (v: unknown, fb = '') => (typeof v === 'string' && v ? v : fb);

  /** Thực thi tool do Gemini gọi. Luôn trả object (ok + dữ liệu hoặc error). */
  const execTool = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const app = useAppStore.getState();
    switch (name) {
      case 'get_feature_guide': {
        const query = str(args.topic).trim();
        if (!query || query === 'list') {
          return {
            ok: true,
            topics: listDocTopics(),
            hint: 'Truyền tên topic cụ thể hoặc từ khóa bất kỳ để nhận tài liệu hướng dẫn chi tiết.',
          };
        }
        const exact = getDocTopic(query);
        if (exact) {
          return {
            ok: true,
            topic: exact.id,
            title: exact.title,
            summary: exact.summary,
            content: exact.content,
          };
        }
        const searchResults = searchDocs(query);
        if (searchResults.length > 0) {
          const first = searchResults[0];
          return {
            ok: true,
            matchedKeyword: query,
            topic: first.id,
            title: first.title,
            summary: first.summary,
            content: first.content,
            otherMatches: searchResults.slice(1, 4).map((m) => ({ id: m.id, title: m.title, summary: m.summary })),
          };
        }
        return {
          ok: false,
          error: `Không tìm thấy tài liệu nào khớp với từ khóa "${query}".`,
          availableTopics: listDocTopics(),
        };
      }
      case 'list_collections':
        return {
          ok: true,
          collections: app.collections.map((c) => ({
            id: c.id,
            name: c.name,
            requests: c.rootRequestIds.length + c.folders.reduce((a, f) => a + f.requestIds.length, 0),
          })),
        };
      case 'list_requests': {
        const col = matchByRef(app.collections, str(args.collection_ref), (c) => c);
        if (!col) return { ok: false, error: 'Không tìm thấy collection.' };
        const ids = [...col.rootRequestIds, ...col.folders.flatMap((f) => f.requestIds)];
        return {
          ok: true,
          collection: col.name,
          requests: ids.map((id) => app.requests[id]).filter(Boolean).map((r) => ({ id: r.id, name: r.name, method: r.method, url: r.url })),
        };
      }
      case 'get_request': {
        const req = matchByRef(Object.values(app.requests), str(args.request_ref), (r) => r);
        if (!req) return { ok: false, error: 'Không tìm thấy request.' };
        return {
          ok: true,
          request: {
            id: req.id, name: req.name, method: req.method, url: req.url,
            headers: req.headers.filter((h) => h.enabled).map((h) => `${h.key}: ${h.value}`),
            bodyType: req.bodyType, bodyPreview: (req.body ?? '').slice(0, 1500),
            hasPreRequest: !!(req.preRequest ?? '').trim(), hasTests: !!(req.tests ?? '').trim(),
            // Script kế thừa cũng chạy — AI cần biết để không sửa trùng chỗ
            runningScripts: scriptChainFor(app.collections, req),
          },
        };
      }
      case 'open_request': {
        const req = matchByRef(Object.values(app.requests), str(args.request_ref), (r) => r);
        if (!req) return { ok: false, error: 'Không tìm thấy request.' };
        useRequestStore.getState().load(req);
        onGoBuilder?.();
        return { ok: true, opened: req.name };
      }
      case 'send_request': {
        const req = matchByRef(Object.values(app.requests), str(args.request_ref), (r) => r);
        if (!req) return { ok: false, error: 'Không tìm thấy request.' };
        if (!confirmUntrustedScripts([req], `AI gửi “${req.name}”`)) {
          return { ok: false, error: 'Người dùng từ chối chạy script chưa rõ nguồn gốc.' };
        }
        const r = await runOneRequest(req, aiHooks(), 30000, undefined, undefined, app.collections);
        return {
          ok: r.ok, status: r.status, timeMs: r.timeMs,
          tests: `${r.testsPassed}/${r.testsTotal}`, error: r.error,
          bodyPreview: (r.response?.body ?? '').slice(0, 2000),
        };
      }
      case 'list_flows': {
        const { flows } = useFlowStore.getState();
        return { ok: true, flows: flows.map((f) => ({ id: f.id, name: f.name, steps: f.steps.length })) };
      }
      case 'run_flow': {
        const { flows } = useFlowStore.getState();
        const flow = matchByRef(flows, str(args.flow_ref), (f) => f);
        if (!flow) return { ok: false, error: 'Không tìm thấy flow.' };
        const stepReqs = flow.steps.flatMap((s) => {
          const r = app.requests[s.requestId];
          return r ? [r] : [];
        });
        if (!confirmUntrustedScripts(stepReqs, `AI chạy Flow “${flow.name}”`, app.collections)) {
          return { ok: false, error: 'Người dùng từ chối chạy script chưa rõ nguồn gốc.' };
        }
        const hooks = aiHooks();
        const t0 = performance.now();
        const { results, flowVars } = await runFlow(flow, app.requests, { getVars: hooks.getVars, setGlobal: hooks.setGlobal }, {
          timeoutMs: 30000, delayMs: 0, stopOnError: false, collections: app.collections,
        });
        // Lưu lại như bấm chạy ở tab Flow (xem lại ở tab Flow → lịch sử chạy)
        await recordManualFlowRun(flow.id, flow.name, Date.now(), results, performance.now() - t0);
        return {
          ok: results.every((r) => r.ok),
          steps: results.map((r, i) => ({ i, name: r.name, ok: r.ok, status: r.status, timeMs: r.timeMs, error: r.error, extracted: r.extracted, bodyChars: r.body?.length ?? 0 })),
          flowVars,
          saved: 'Đã lưu vào lịch sử chạy của flow (tab Flow). Muốn đọc body step nào thì gọi get_step_body.',
        };
      }
      case 'get_step_body': {
        const { flows, runs } = useFlowStore.getState();
        const flow = matchByRef(flows, str(args.flow_ref), (f) => f);
        if (!flow) return { ok: false, error: 'Không tìm thấy flow.' };
        const run = runs.find((r) => r.kind === 'flow' && r.refId === flow.id);
        if (!run) return { ok: false, error: `Flow “${flow.name}” chưa có lần chạy nào được lưu.` };
        const stepRef = String(args.step ?? '').trim();
        let idx = /^\d+$/.test(stepRef) ? parseInt(stepRef, 10) : -1;
        if (idx < 0) {
          const t = stepRef.toLowerCase();
          idx = run.steps.findIndex((s) => s.name.toLowerCase().includes(t));
        }
        if (idx < 0 || idx >= run.steps.length) return { ok: false, error: `Không tìm thấy step “${stepRef}” (flow có ${run.steps.length} step: ${run.steps.map((s, i) => `${i}:${s.name}`).join(', ')}).` };
        const st = run.steps[idx];
        if (!st.bodyKey) return { ok: false, error: st.bodyOmitted === 'too-large' ? 'Body quá to (>2MB) nên không lưu — mở tab Flow xem trực tiếp.' : 'Step này không có body.' };
        const stored = await getBody(st.bodyKey);
        if (!stored) return { ok: false, error: 'Body đã bị dọn (chỉ giữ 20 lần chạy gần nhất) — chạy lại flow.' };
        if (stored.bodyKind === 'binary') return { ok: true, step: st.name, binary: true, contentType: stored.contentType, note: 'Body nhị phân (ảnh/file) — mở tab Flow để xem/tải.' };
        const total = stored.body.length;
        const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
        const limit = Math.min(20000, Math.max(1, Math.floor(Number(args.limit) || 4000)));
        const text = stored.body.slice(offset, offset + limit);
        return { ok: true, step: st.name, status: st.status, contentType: stored.contentType, totalChars: total, offset, text, truncated: offset + limit < total };
      }
      case 'get_last_response': {
        const ref = str(args.request_ref).trim();
        const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
        const limit = Math.min(20000, Math.max(1, Math.floor(Number(args.limit) || 4000)));

        const { tabs, activeId } = useRequestStore.getState();
        const currentTab = tabs.find((t) => t.id === activeId);

        let targetReq: ApiRequest | null = null;
        let targetResp: ApiResponse | null = null;
        let source = '';

        if (!ref) {
          if (app.response) {
            targetReq = currentTab ? currentTab.request : null;
            targetResp = app.response;
            source = 'tab hiện tại';
          } else if (app.history.length > 0) {
            targetReq = app.history[0].request;
            targetResp = app.history[0].response ?? null;
            source = 'lần gửi gần nhất trong lịch sử';
          }
        } else {
          const lower = ref.toLowerCase();
          if (currentTab && (currentTab.request.id === ref || currentTab.request.name.toLowerCase().includes(lower) || currentTab.request.url.toLowerCase().includes(lower))) {
            targetReq = currentTab.request;
            targetResp = app.response;
            source = 'tab hiện tại';
          }
          if (!targetResp && app.history.length > 0) {
            const histItem = app.history.find((h) =>
              h.request.id === ref ||
              h.request.name.toLowerCase().includes(lower) ||
              h.request.url.toLowerCase().includes(lower)
            );
            if (histItem) {
              targetReq = histItem.request;
              targetResp = histItem.response ?? null;
              source = `lịch sử (${new Date(histItem.createdAt).toLocaleString('vi-VN')})`;
            }
          }
          if (!targetReq) {
            targetReq = matchByRef(Object.values(app.requests), ref, (r) => r);
          }
        }

        if (!targetResp) {
          if (app.sendError) {
            return {
              ok: false,
              request: targetReq ? { id: targetReq.id, name: targetReq.name, method: targetReq.method, url: targetReq.url } : null,
              error: `Request bị lỗi kết nối hoặc timeout: ${app.sendError}`,
            };
          }
          return {
            ok: false,
            error: targetReq
              ? `Request "${targetReq.name}" chưa có kết quả response nào (chưa gửi hoặc đã bị xóa lịch sử). Bạn có thể gọi tool send_request để gửi ngay.`
              : `Không tìm thấy response nào phù hợp${ref ? ` với "${ref}"` : ''}.`,
          };
        }

        if (targetResp.bodyKind === 'binary') {
          return {
            ok: true,
            source,
            request: targetReq ? { id: targetReq.id, name: targetReq.name, method: targetReq.method, url: targetReq.url } : null,
            status: targetResp.status,
            statusText: targetResp.statusText,
            timeMs: targetResp.timeMs,
            sizeBytes: targetResp.sizeBytes,
            headers: targetResp.headers,
            binary: true,
            note: 'Body nhị phân (ảnh/tập tin) — xem trực tiếp trong bảng Response.',
          };
        }

        const fullBody = targetResp.body ?? '';
        const totalChars = fullBody.length;
        const text = fullBody.slice(offset, offset + limit);

        return {
          ok: true,
          source,
          request: targetReq ? { id: targetReq.id, name: targetReq.name, method: targetReq.method, url: targetReq.url } : null,
          status: targetResp.status,
          statusText: targetResp.statusText,
          timeMs: targetResp.timeMs,
          sizeBytes: targetResp.sizeBytes,
          headers: targetResp.headers,
          isStream: targetResp.isStream,
          totalChars,
          offset,
          limit,
          bodySnippet: text,
          truncated: offset + limit < totalChars,
        };
      }
      case 'list_envs': {
        const active = app.environments.find((e) => e.id === app.activeEnvId);
        return {
          ok: true,
          active: active?.name ?? null,
          envs: app.environments.map((e) => {
            const sec = app.envSecrets[e.id] ?? [];
            return {
              id: e.id, name: e.name,
              vars: Object.keys(e.variables).filter((k) => !sec.includes(k)),
              // Chỉ TÊN biến secret — để AI viết đúng {{ten}}; giá trị không rời khỏi RAM.
              secretVars: sec,
            };
          }),
          globals: Object.keys(app.globals).filter((k) => !app.globalSecrets.includes(k)),
          globalSecrets: app.globalSecrets,
          note: 'secretVars/globalSecrets là TÊN thường (đưa vào script bằng {{ten}} được); giá trị secret không bao giờ gửi cho AI.',
        };
      }
      case 'set_active_env': {
        const env = matchByRef(app.environments, str(args.env_ref), (e) => e);
        if (!env) return { ok: false, error: 'Không tìm thấy env.' };
        app.setActiveEnv(env.id);
        return { ok: true, active: env.name };
      }
      case 'set_variable': {
        const key = str(args.key);
        const value = str(args.value);
        if (!key) return { ok: false, error: 'Thiếu key.' };
        if (args.scope === 'global') app.setGlobal(key, value);
        else {
          if (!app.activeEnvId) return { ok: false, error: 'Chưa có env active.' };
          app.setEnvVar(app.activeEnvId, key, value);
        }
        return { ok: true, scope: args.scope, key };
      }
      case 'create_request': {
        const m = str(args.method, 'GET').toUpperCase();
        const method: HttpMethod = (METHODS as string[]).includes(m) ? (m as HttpMethod) : 'GET';
        const cols = app.collections;
        const col = str(args.collection_ref) ? matchByRef(cols, str(args.collection_ref), (c) => c) : (cols[0] ?? null);
        if (!col) return { ok: false, error: 'Chưa có collection nào — tạo collection trước.' };
        const auth = parseAuthSpec(str(args.auth));
        if (!auth) return { ok: false, error: 'auth sai cú pháp — dùng "none" | "bearer TOKEN" | "header Tên: giá-trị".' };
        const req: ApiRequest = {
          id: uid('req'), name: str(args.name, 'Request mới'), method,
          url: str(args.url),
          params: [],
          headers: parseHeaderSpec(str(args.headers)).map((h) => ({ id: uid('kv'), key: h.key, value: h.value, enabled: true })),
          bodyType: str(args.body) ? 'json' : 'none', body: str(args.body),
          auth, 
          preRequest: typeof args.pre_request === 'string' ? args.pre_request : '', 
          tests: typeof args.tests === 'string' ? args.tests : '',
          collectionId: col.id, updatedAt: Date.now(),
        };
        const saved = app.saveRequest(req, col.id);
        if (!saved) return { ok: false, error: 'Không lưu được request.' };
        return withSelfCheck({ ok: true, id: saved.id, name: saved.name, collection: col.name }, args, saved);
      }
      case 'update_request': {
        const req = matchByRef(Object.values(app.requests), str(args.request_ref), (r) => r);
        if (!req) return { ok: false, error: 'Không tìm thấy request.' };
        const patch: ApiRequest = { ...req };
        if (typeof args.name === 'string' && args.name.trim()) patch.name = args.name.trim();
        if (typeof args.method === 'string' && args.method.trim()) {
          const m = args.method.trim().toUpperCase();
          if ((METHODS as string[]).includes(m)) patch.method = m as HttpMethod;
        }
        if (typeof args.url === 'string' && args.url.trim()) patch.url = args.url.trim();
        if (typeof args.body === 'string') {
          patch.body = args.body;
          if (args.body.trim() && patch.bodyType === 'none') patch.bodyType = 'json';
          if (!args.body.trim()) patch.bodyType = 'none';
        }
        if (typeof args.pre_request === 'string') patch.preRequest = args.pre_request;
        if (typeof args.tests === 'string') patch.tests = args.tests;
        
        const headLines = parseHeaderSpec(str(args.headers));
        if (headLines.length > 0) {
          const next = patch.headers.map((h) => ({ ...h }));
          for (const hl of headLines) {
            const i = next.findIndex((h) => h.key.toLowerCase() === hl.key.toLowerCase());
            if (i >= 0) next[i] = { ...next[i], value: hl.value, enabled: true };
            else next.push({ id: uid('kv'), key: hl.key, value: hl.value, enabled: true });
          }
          patch.headers = next;
        }
        if (typeof args.auth === 'string' && args.auth.trim()) {
          const auth = parseAuthSpec(args.auth);
          if (!auth) return { ok: false, error: 'auth sai cú pháp — dùng "none" | "bearer TOKEN" | "header Tên: giá-trị".' };
          patch.auth = auth;
        }
        const saved = app.saveRequest(patch);
        if (!saved) return { ok: false, error: 'Không lưu được request.' };
        // Đồng bộ ngay lập tức vào tab đang mở (force=true để ép đè cả khi tab có cờ dirty)
        useRequestStore.getState().refreshTabs({ [saved.id]: saved }, true);
        return withSelfCheck({ ok: true, id: saved.id, name: saved.name, note: 'Đã cập nhật (mở Builder để xem).' }, args, saved);
      }
      case 'import_json': {
        const content = str(args.content);
        if (!content) return { ok: false, error: 'Thiếu JSON — nhờ người dùng dán JSON vào chat.' };
        if (content.length > 200000) return { ok: false, error: 'JSON quá lớn (>200KB) — nhờ người dùng nhập bằng nút Import file ở sidebar.' };
        let json: unknown;
        try {
          json = JSON.parse(content);
        } catch {
          return { ok: false, error: 'JSON sai cú pháp — nhờ người dùng kiểm tra lại.' };
        }
        const r = importAnyJson(json, 'chat');
        return { ok: r.errors.length === 0, summary: summarizeImport(r) };
      }
      case 'create_flow': {
        const name = str(args.name, 'Flow mới');
        let rawSteps: unknown;
        try {
          rawSteps = JSON.parse(str(args.steps, '[]'));
        } catch {
          return { ok: false, error: 'steps không phải JSON hợp lệ — phải là mảng [{"request":"tên/id","extract":["bien=duongDan"]}]' };
        }
        if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
          return { ok: false, error: 'steps trống — cần ít nhất 1 step. Gọi list_requests trước để lấy tên request đúng.' };
        }
        const allReqs = Object.values(app.requests);
        const steps: { requestId: string; extract: { name: string; from: 'body-json'; path: string }[] }[] = [];
        const missing: string[] = [];
        rawSteps.slice(0, 20).forEach((s: unknown) => {
          const o = (s ?? {}) as Record<string, unknown>;
          const req = matchByRef(allReqs, typeof o.request === 'string' ? o.request : '', (r) => r);
          if (!req) { missing.push(String(o.request ?? '?')); return; }
          const extract = Array.isArray(o.extract) ? o.extract : [];
          steps.push({
            requestId: req.id,
            extract: extract
              .map((e) => String(e ?? ''))
              .map((e) => {
                const i = e.indexOf('=');
                return i > 0
                  ? { name: e.slice(0, i).trim(), from: 'body-json' as const, path: e.slice(i + 1).trim() }
                  : { name: e.trim(), from: 'body-json' as const, path: e.trim() };
              })
              .filter((e) => e.name && e.path),
          });
        });
        if (steps.length === 0) return { ok: false, error: `Không khớp request nào (${missing.join(', ')}) — gọi list_requests để lấy tên đúng.` };
        useFlowStore.getState().importFlow(
          { name, steps },
          (rid) => app.requests[rid]?.collectionId,
        );
        const created = useFlowStore.getState().flows[useFlowStore.getState().flows.length - 1];
        return {
          ok: true, id: created.id, name: created.name,
          steps: steps.map((s) => ({
            request: app.requests[s.requestId]?.name ?? s.requestId,
            extract: s.extract.map((e) => `${e.name}=${e.path}`),
          })),
          skipped: missing,
          note: 'Đã tạo flow (mở tab Flow để xem). Muốn chạy thử thì gọi run_flow.',
        };
      }
      case 'run_collection': {
        const scope = resolveScope(app, str(args.collection_ref), str(args.folder_ref));
        if ('error' in scope) return { ok: false, error: scope.error };
        const { col, folderId } = scope;
        const full = collectRequests(col, app.requests, folderId);
        if (full.length === 0) return { ok: false, error: 'Phạm vi này không có request nào.' };
        const capped = full.length > 20;
        const runList = full.slice(0, 20);
        if (!confirmUntrustedScripts(runList, `AI chạy Collection “${col.name}”`)) {
          return { ok: false, error: 'Người dùng từ chối chạy script chưa rõ nguồn gốc.' };
        }
        const hooks = aiHooks();
        const t0 = performance.now();
        const at = Date.now();
        const collected = await runRequestList(runList, hooks, {
          timeoutMs: 30000, delayMs: 0, stopOnError: false, collections: app.collections,
        });
        const refId = `${col.id}:${folderId}`;
        await saveCollectionRun(refId, `${col.name} • AI chạy`, at, collected, performance.now() - t0);
        return {
          ok: collected.every((r) => r.ok),
          ran: `${collected.length}/${full.length}${capped ? ' (collection dài, chỉ chạy 20 cái đầu)' : ''}`,
          items: collected.map((r) => ({ name: r.name, ok: r.ok, status: r.status, timeMs: r.timeMs, tests: `${r.testsPassed}/${r.testsTotal}`, error: r.error?.slice(0, 300) })),
          saved: 'Đã lưu vào lịch sử chạy của collection (tab Runner).',
        };
      }
      case 'run_collection_data': {
        const scope = resolveScope(app, str(args.collection_ref), str(args.folder_ref));
        if ('error' in scope) return { ok: false, error: scope.error };
        const { col, folderId, scopeName } = scope;
        const dataText = str(args.data);
        if (!dataText) return { ok: false, error: 'Thiếu data — dán CSV/JSON vào chat hoặc tự sinh từ cấu trúc body.' };
        if (dataText.length > 200000) return { ok: false, error: 'Data quá lớn (>200KB) — nạp bằng file ở tab Runner.' };
        const full = collectRequests(col, app.requests, folderId);
        if (full.length === 0) return { ok: false, error: 'Phạm vi này không có request nào.' };
        const parsed = parseDataFile(dataText, dataText.trimStart().startsWith('[') ? 'chat.json' : 'chat.csv');
        if (parsed.error || parsed.rows.length === 0) {
          // Kèm tên biến scope đang dùng để AI tự dựng lại header đúng rồi thử lại
          const scopeVars = [...new Set(full.flatMap((r) => collectRequestVars(r)))];
          return {
            ok: false,
            error: parsed.error ?? 'Data không có dòng nào (CSV cần dòng tiêu đề, JSON cần mảng object).',
            scopeVars,
            hint: scopeVars.length > 0
              ? `Các biến scope này đang dùng: ${scopeVars.map((v) => `{{${v}}}`).join(', ')} — CSV phải có dòng tiêu đề đúng các tên này rồi mới tới dòng giá trị.`
              : undefined,
          };
        }
        const maxRows = Math.min(50, Math.max(1, Math.floor(Number(args.max_rows) || 20)));
        const rows = parsed.rows.slice(0, maxRows);
        const runList = full.slice(0, 20);
        if (!confirmUntrustedScripts(runList, `AI chạy bulk Collection “${col.name}” (${rows.length} dòng)`)) {
          return { ok: false, error: 'Người dùng từ chối chạy script chưa rõ nguồn gốc.' };
        }
        const hooks = aiHooks();
        const t0 = performance.now();
        const at = Date.now();
        const iters = await runCollectionWithData(runList, rows, hooks, {
          timeoutMs: 30000, delayMs: 0, stopOnError: false, collections: app.collections,
        });
        // Lưu lịch sử (gộp các iteration, tên gắn #dòng) + giữ bản chi tiết để export
        const flat: RunItemResult[] = iters.flatMap((it) =>
          it.items.map((r) => ({ ...r, name: `#${it.rowIndex + 1} ${r.name}` })),
        );
        const refId = `${col.id}:${folderId}`;
        await saveCollectionRun(
          refId, `${col.name} • ${scopeName} • AI bulk (${iters.length} dòng)`,
          at, flat, performance.now() - t0,
        );
        const vars = hooks.getVars();
        const flatResp = (s: string) => s.replace(/\s+/g, ' ').slice(0, 1000);
        lastAiBulkRun = {
          at,
          refName: `${col.name} • ${scopeName} (${iters.length} dòng)`,
          rows: iters.flatMap((it) => it.items.map((r) => {
            const req = app.requests[r.requestId];
            const env = { ...vars.envVars, ...it.row };
            return {
              rowIndex: it.rowIndex,
              row: it.row,
              requestId: r.requestId,
              name: r.name,
              method: r.method,
              url: req ? resolveVariables(req.url, env, vars.globals).resolved : r.url,
              curl: req ? toCurl(req, env, vars.globals) : '',
              ok: r.ok,
              status: r.status,
              timeMs: r.timeMs,
              tests: `${r.testsPassed}/${r.testsTotal}`,
              error: r.error?.slice(0, 300),
              response: flatResp(r.response?.body ?? ''),
            };
          })),
        };
        const show = iters.slice(0, 10);
        return {
          ok: iters.every((x) => x.ok),
          iterations: `${iters.length}/${parsed.rows.length} dòng${parsed.rows.length > rows.length ? ` (giới hạn ${rows.length})` : ''}`,
          columns: parsed.columns,
          detail: show.map((it) => ({
            row: it.rowIndex + 1,
            data: it.row,
            ok: it.ok,
            failed: it.items.filter((r) => !r.ok).map((r) => `${r.name}: ${(r.error ?? `HTTP ${r.status}`).slice(0, 200)}`),
          })),
          omitted: iters.length > show.length ? iters.length - show.length : 0,
          saved: 'Đã lưu lịch sử (tab Runner). Gọi export_last_run để xuất file CSV.',
        };
      }
      case 'export_last_run': {
        if (!lastAiBulkRun) return { ok: false, error: 'Chưa có lần chạy bulk nào — gọi run_collection_data trước.' };
        const fmt = str(args.format, 'csv').toLowerCase() === 'markdown' ? 'markdown' : 'csv';
        const stamp = new Date(lastAiBulkRun.at);
        const pad = (n: number) => String(n).padStart(2, '0');
        const fname = `reqx-bulk-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.${fmt === 'csv' ? 'csv' : 'md'}`;
        const esc = (s: string | number | undefined) => {
          const t = String(s ?? '');
          return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
        };
        let content: string;
        if (fmt === 'csv') {
          const head = 'thoi_gian,iteration,data,request,method,url,curl,status,time_ms,tests,loi,response';
          const lines = lastAiBulkRun.rows.map((r) => [
            stamp.toLocaleString('vi-VN'), r.rowIndex + 1, JSON.stringify(r.row),
            r.name, r.method, r.url, r.curl, r.status ?? '', r.timeMs ?? '',
            r.tests, r.error ?? '', r.response,
          ].map(esc).join(','));
          content = head + '\n' + lines.join('\n');
        } else {
          const lines = [
            `# Kết quả chạy bulk — ${lastAiBulkRun.refName}`,
            `Thời gian: ${stamp.toLocaleString('vi-VN')} • Tổng ${lastAiBulkRun.rows.length} lượt`,
            '',
            '| # | Data | Request | KQ | Time | Tests | Lỗi |',
            '|---|---|---|---|---|---|---|',
            ...lastAiBulkRun.rows.map((r) => {
              const data = Object.entries(r.row).map(([k, v]) => `${k}=${v}`).join(' ');
              return `| ${r.rowIndex + 1} | ${data} | ${r.name} | ${r.ok ? '✅' : `❌ ${r.status ?? ''}`} | ${r.timeMs ?? ''}ms | ${r.tests} | ${(r.error ?? '').slice(0, 120)} |`;
            }),
            '',
            '## cURL từng lượt (chạy lại bằng tay khi cần)',
            ...lastAiBulkRun.rows.map((r) => `\n### #${r.rowIndex + 1} ${r.name}\n\`\`\`bash\n${r.curl}\n\`\`\``),
          ];
          content = lines.join('\n');
        }
        const saved = await saveExportBesideApp(fname, content);
        const when = stamp.toLocaleString('vi-VN');
        if (saved) return { ok: true, file: saved.path, rows: lastAiBulkRun.rows.length, runAt: when, run: lastAiBulkRun.refName, note: 'Đã lưu cạnh app ReqX.' };
        // Bản web: không ghi được cạnh app → tải về Downloads
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return { ok: true, file: fname, rows: lastAiBulkRun.rows.length, runAt: when, run: lastAiBulkRun.refName, note: 'Bản web: file đã tải về thư mục Downloads.' };
      }
      case 'generate_test_cases': {
        const reqStore = useRequestStore.getState();
        const ref = str(args.request_ref);
        const req = ref
          ? matchByRef(Object.values(app.requests), ref, (r) => r)
          : (app.requests[reqStore.current.id] ?? reqStore.current);
        if (!req) return { ok: false, error: 'Không tìm thấy request để lên key test.' };
        const max = Math.min(80, Math.max(5, Math.floor(Number(args.max_cases) || 40)));
        const cases = generateCases(req, max);
        const hint = str(args.expect_hint);
        if (hint) {
          cases[0] = { ...cases[0], note: `${cases[0]?.note ? cases[0].note + ' • ' : ''}${hint}` };
        }
        useTestCaseStore.getState().setCases(req, cases);
        const groups: Record<string, number> = {};
        for (const c of cases) groups[GROUP_LABEL[c.group]] = (groups[GROUP_LABEL[c.group]] ?? 0) + 1;
        return {
          ok: true,
          request: req.name,
          cases: cases.length,
          groups,
          first: cases.slice(0, 12).map((c, i) => ({ n: i + 1, name: c.name, mong_doi: c.expect.status })),
          ...(hint ? { note: `Mong đợi nghiệp vụ "${hint}" mới chỉ ghi vào case 1. Muốn áp cho đúng case nào thì gọi refine_test_case (kèm số thứ tự).` } : {}),
          dialog: 'Đã mở bảng "🧪 Bộ key test" để người dùng duyệt/sửa.',
          next: 'Hỏi người dùng có chạy không → run_test_cases → export_test_cases.',
        };
      }
      case 'refine_test_case': {
        const st = useTestCaseStore.getState();
        if (!st.cases.length) return { ok: false, error: 'Chưa có bộ key test — gọi generate_test_cases trước.' };
        const ref = str(args.case);
        const num = Number(ref);
        const c = Number.isInteger(num) && num >= 1 && num <= st.cases.length
          ? st.cases[num - 1]
          : st.cases.find((x) => x.id === ref);
        if (!c) return { ok: false, error: `Không thấy case "${ref}" (bảng có ${st.cases.length} case, đánh số 1..${st.cases.length}).` };
        const patch: Partial<TestCase> = {};
        if (typeof args.name === 'string' && args.name.trim()) patch.name = args.name.trim();
        if (typeof args.data === 'string' && args.data.trim()) {
          try {
            const j = JSON.parse(args.data);
            if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('Cần JSON object {"field":"gia tri"}');
            const data: Record<string, string> = {};
            for (const [k, v] of Object.entries(j as Record<string, unknown>)) data[k] = String(v ?? '');
            patch.data = data;
          } catch (e) {
            return { ok: false, error: `data không hợp lệ: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}` };
          }
        }
        const es = str(args.expect_status);
        const ec = typeof args.expect_contains === 'string' ? args.expect_contains : undefined;
        if (es || ec !== undefined) patch.expect = { status: es || c.expect.status, contains: ec ?? c.expect.contains };
        if (Object.keys(patch).length === 0) return { ok: false, error: 'Không có nội dung để sửa (name/data/expect_status/expect_contains).' };
        st.patchCase(c.id, patch);
        return { ok: true, case: c.name, updated: patch, hint: 'Bảng key test đã cập nhật.' };
      }
      case 'run_test_cases': {
        const st = useTestCaseStore.getState();
        const base = st.base;
        if (!base || st.cases.length === 0) {
          return { ok: false, error: 'Chưa có bộ key test — gọi generate_test_cases trước.' };
        }
        const list = st.cases.filter((c) => c.enabled !== false);
        if (list.length === 0) return { ok: false, error: 'Tất cả case đang bị bỏ tick trong bảng.' };
        const cap = Math.min(60, Math.max(1, Math.floor(Number(args.limit) || 25)));
        const batch = list.slice(0, cap);
        if (!confirmUntrustedScripts([base], `AI chạy ${batch.length} test case cho “${base.name}”`, app.collections)) {
          return { ok: false, error: 'Người dùng từ chối chạy script chưa rõ nguồn gốc.' };
        }
        st.clearResults();
        st.setRunning(true);
        let res: CaseRunResult[] = [];
        try {
          res = await runTestCases(base, batch, aiHooks(), {
            collections: app.collections,
            onResult: (c, r) => useTestCaseStore.getState().setResult(c.id, r),
          });
        } finally {
          useTestCaseStore.getState().setRunning(false);
        }
        const pass = res.filter((r) => r.pass).length;
        const show = batch.slice(0, 15);
        return {
          ok: pass === res.length,
          request: base.name,
          ran: `${res.length}/${list.length} case${list.length > cap ? ` (giới hạn ${cap})` : ''}`,
          pass,
          fail: res.length - pass,
          detail: show.map((c, i) => ({
            name: c.name,
            mong_doi: c.expect.status,
            status: res[i]?.status ?? '—',
            kq: res[i]?.pass ? '✅' : '❌',
            ly_do: (res[i]?.why ?? '').slice(0, 160),
          })),
          omitted: res.length > show.length ? res.length - show.length : 0,
          saved: 'Kết quả từng case đã hiện ở bảng 🧪. Gọi export_test_cases để xuất file Excel (CSV).',
        };
      }
      case 'export_test_cases': {
        const st = useTestCaseStore.getState();
        const base = st.base;
        if (!base || st.cases.length === 0) return { ok: false, error: 'Chưa có bộ key test để xuất.' };
        const fname = csvFileName(base);
        const content = casesToCsv(base, st.cases, st.results);
        const ran = Object.keys(st.results).length;
        const saved = await saveExportBesideApp(fname, content);
        if (saved) {
          return {
            ok: true, file: saved.path, cases: st.cases.length, ran,
            note: ran === 0 ? 'Mới chỉ có bộ case — chưa có kết quả chạy.' : 'Đã lưu cạnh app ReqX.',
          };
        }
        const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return { ok: true, file: fname, cases: st.cases.length, ran, note: 'Bản web: file đã tải về Downloads.' };
      }
      case 'export_git_workspace': {
        try {
          const { saveWorkspaceFile, revealExportedFile } = await import('../lib/response-file');
          const { isFlowContainer, exportAllCollections } = await import('../lib/postman-io');
          const cols = app.collections.filter((c) => !isFlowContainer(c));
          if (cols.length === 0) return { ok: false, error: 'Không có collection nào để xuất.' };
          let lastPath = '';
          let successCount = 0;
          for (const c of cols) {
            const reqIds = new Set<string>(c.rootRequestIds);
            for (const f of c.folders) for (const id of f.requestIds) reqIds.add(id);
            const colReqs = Object.values(app.requests).filter((r) => reqIds.has(r.id));
            const json = exportAllCollections([c], colReqs);
            const safeName = c.name.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
            const saved = await saveWorkspaceFile(`${safeName}.json`, json);
            if (saved) { lastPath = saved.path; successCount++; }
          }
          if (successCount > 0 && lastPath) {
            await revealExportedFile(lastPath);
            return { ok: true, message: `Đã xuất thành công ${successCount} collections vào thư mục reqx_workspace!` };
          }
          return { ok: false, error: 'Tính năng này chỉ hoạt động trên ứng dụng Desktop (Tauri).' };
        } catch (e) {
          return { ok: false, error: String(e) };
        }
      }
      case 'import_git_workspace': {
        try {
          const { readWorkspaceFiles } = await import('../lib/response-file');
          const files = await readWorkspaceFiles();
          if (files.length === 0) return { ok: false, error: 'Không tìm thấy file nào trong thư mục reqx_workspace, hoặc không chạy trên Web.' };
          let successCols = 0, successReqs = 0;
          for (const content of files) {
            try {
              const data = JSON.parse(content);
              const { importAnyJson } = await import('../lib/import-any');
              const res = importAnyJson(data, 'Workspace File');
              successCols += res.collections.length;
              successReqs += res.collections.reduce((sum, c) => sum + c.requests, 0);
            } catch {}
          }
          if (successCols > 0) return { ok: true, message: `Đã cập nhật ${successCols} Collections, ${successReqs} Requests từ Git Workspace.` };
          return { ok: false, error: 'Không có file JSON hợp lệ trong thư mục.' };
        } catch (e) {
          return { ok: false, error: String(e) };
        }
      }
      case 'list_schedules': {
        const schedules = useScheduleStore.getState().schedules;
        return {
          ok: true,
          schedules: schedules.map((s) => ({
            id: s.id,
            name: s.name,
            kind: s.kind,
            intervalMin: s.intervalMin,
            enabled: s.enabled,
            notify: s.notify,
            nextRunAt: new Date(s.nextRunAt).toLocaleString('vi-VN'),
            lastRun: s.lastRun ? { at: new Date(s.lastRun.at).toLocaleString('vi-VN'), ok: s.lastRun.ok, total: s.lastRun.total } : null,
          })),
        };
      }
      case 'create_schedule': {
        const name = str(args.name);
        const kind = str(args.kind, 'collection') as 'collection' | 'flow';
        if (!name) return { ok: false, error: 'Thiếu tên schedule.' };
        const intervalMin = Math.max(1, Number(args.intervalMin ?? 60));
        const notify = args.notify !== false;
        if (kind === 'flow') {
          const flowRef = str(args.flow_ref);
          if (!flowRef) return { ok: false, error: 'Thiếu flow_ref khi tạo schedule cho flow.' };
          const { flows } = useFlowStore.getState();
          const flow = matchByRef(flows, flowRef, (f) => f);
          if (!flow) return { ok: false, error: 'Không tìm thấy flow.' };
          useScheduleStore.getState().addSchedule({
            name, kind: 'flow', collectionId: '', folderId: '', flowId: flow.id, intervalMin, notify, enabled: true,
          });
          return { ok: true, message: `Đã tạo schedule "${name}" cho flow "${flow.name}", chạy mỗi ${intervalMin} phút.` };
        } else {
          const colRef = str(args.collection_ref);
          if (!colRef) return { ok: false, error: 'Thiếu collection_ref khi tạo schedule cho collection.' };
          const app = useAppStore.getState();
          const col = matchByRef(app.collections, colRef, (c) => c);
          if (!col) return { ok: false, error: 'Không tìm thấy collection.' };
          const folderRef = str(args.folder_ref, '');
          let folderId = 'all';
          if (folderRef.toLowerCase() === 'root') {
            folderId = 'root';
          } else if (folderRef) {
            const f = col.folders.find((x) => x.id === folderRef || x.name.toLowerCase().includes(folderRef.toLowerCase()));
            if (!f) return { ok: false, error: `Không thấy folder "${folderRef}".` };
            folderId = f.id;
          }
          useScheduleStore.getState().addSchedule({
            name, kind: 'collection', collectionId: col.id, folderId, intervalMin, notify, enabled: true,
          });
          return { ok: true, message: `Đã tạo schedule "${name}" cho collection "${col.name}", chạy mỗi ${intervalMin} phút.` };
        }
      }
      case 'delete_schedule': {
        const schRef = str(args.schedule_ref);
        if (!schRef) return { ok: false, error: 'Thiếu schedule_ref.' };
        const schedules = useScheduleStore.getState().schedules;
        const sch = matchByRef(schedules, schRef, (s) => s);
        if (!sch) return { ok: false, error: 'Không tìm thấy schedule.' };
        useScheduleStore.getState().removeSchedule(sch.id);
        return { ok: true, message: `Đã xóa schedule "${sch.name}".` };
      }
      case 'toggle_schedule': {
        const schRef = str(args.schedule_ref);
        if (!schRef) return { ok: false, error: 'Thiếu schedule_ref.' };
        const enabled = !!args.enabled;
        const schedules = useScheduleStore.getState().schedules;
        const sch = matchByRef(schedules, schRef, (s) => s);
        if (!sch) return { ok: false, error: 'Không tìm thấy schedule.' };
        useScheduleStore.getState().updateSchedule(sch.id, { enabled });
        return { ok: true, message: `Đã ${enabled ? 'bật' : 'tắt'} schedule "${sch.name}".` };
      }
      case 'get_run_history': {
        const refType = str(args.ref_type);
        const refId = str(args.ref_id);
        if (!refType || !['collection', 'flow', 'request'].includes(refType)) return { ok: false, error: 'ref_type phải là collection/flow/request.' };
        if (!refId) return { ok: false, error: 'Thiếu ref_id.' };
        const limit = Math.min(50, Math.max(1, Number(args.limit ?? 20)));
        const runs = useFlowStore.getState().runs.filter((r) => r.kind === refType && r.refId === refId).slice(0, limit);
        return {
          ok: true,
          history: runs.map((r) => ({
            at: new Date(r.at).toLocaleString('vi-VN'),
            ok: r.ok,
            total: r.total,
            timeMs: r.timeMs,
            stopped: r.stopped,
            steps: r.steps?.map((s) => ({ name: s.name, ok: s.ok, status: s.status, timeMs: s.timeMs, error: s.error })) ?? [],
          })),
          totalRuns: runs.length,
        };
      }
      case 'get_current_tab_request': {
        const { tabs, activeId } = useRequestStore.getState();
        const tab = tabs.find((t) => t.id === activeId);
        if (!tab) return { ok: false, error: 'Không có tab nào đang mở.' };
        return {
          ok: true,
          request: {
            id: tab.request.id,
            name: tab.request.name,
            method: tab.request.method,
            url: tab.request.url,
            headers: tab.request.headers.filter((h) => h.enabled).map((h) => `${h.key}: ${h.value}`),
            bodyType: tab.request.bodyType,
            bodyPreview: (tab.request.body ?? '').slice(0, 1500),
            hasPreRequest: !!(tab.request.preRequest ?? '').trim(),
            hasTests: !!(tab.request.tests ?? '').trim(),
            runningScripts: scriptChainFor(app.collections, tab.request),
            dirty: tab.dirty,
          },
        };
      }
      case 'update_current_request': {
        const { tabs, activeId, set } = useRequestStore.getState();
        const tab = tabs.find((t) => t.id === activeId);
        if (!tab) return { ok: false, error: 'Không có tab nào đang mở.' };
        const patch: Partial<ApiRequest> = {};
        if (args.name !== undefined) patch.name = str(args.name);
        if (args.method !== undefined) {
          const m = str(args.method, 'GET').toUpperCase();
          const validMethods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
          patch.method = (validMethods as string[]).includes(m) ? (m as HttpMethod) : 'GET';
        }
        if (args.url !== undefined) patch.url = str(args.url);
        if (args.body !== undefined) patch.body = str(args.body);
        if (args.headers !== undefined) {
          const parsed = parseHeaderSpec(str(args.headers));
          if (parsed.length > 0) {
            // Merge vào headers cũ: có rồi thì đè, chưa có thì thêm
            const existingMap = new Map(tab.request.headers.filter((h) => h.enabled).map((h) => [h.key.toLowerCase(), h]));
            for (const { key, value } of parsed) {
              const lowerKey = key.toLowerCase();
              if (existingMap.has(lowerKey)) {
                // Đè value của header đã có
                const old = existingMap.get(lowerKey)!;
                old.value = value;
              } else {
                // Thêm header mới (cần id theo type KeyValue)
                tab.request.headers.push({ id: uid('hdr'), key, value, enabled: true });
              }
            }
            patch.headers = tab.request.headers;
          }
        }
        if (args.auth !== undefined) {
          const auth = parseAuthSpec(str(args.auth));
          if (auth) patch.auth = auth;
          else return { ok: false, error: 'auth sai cú pháp: "none" | "bearer TOKEN" | "header Tên: giá-trị"' };
        }
        if (args.pre_request !== undefined) patch.preRequest = str(args.pre_request);
        if (args.tests !== undefined) patch.tests = str(args.tests);
        const merged: ApiRequest = { ...tab.request, ...patch };
        set(patch);
        return withSelfCheck(
          { ok: true, message: `Đã cập nhật request "${merged.name}" trong tab hiện tại.` },
          args,
          merged,
        );
      }
      case 'import_postman_files': {
        const filesRaw = str(args.files);
        if (!filesRaw) return { ok: false, error: 'Thiếu files — nhờ user paste JSON array chứa nội dung các file Postman.' };
        let filesJson: unknown[];
        try {
          filesJson = JSON.parse(filesRaw);
        } catch {
          return { ok: false, error: 'files phải là JSON array hợp lệ.' };
        }
        if (!Array.isArray(filesJson)) return { ok: false, error: 'files phải là JSON array.' };
        if (filesJson.length > 50) return { ok: false, error: 'Tối đa 50 file/lần — chia nhỏ nếu nhiều hơn.' };
        const { importAnyJson } = await import('../lib/import-any');
        let totalCols = 0, totalReqs = 0;
        const colNames: string[] = [];
        const errors: string[] = [];
        for (let i = 0; i < filesJson.length; i++) {
          try {
            const res = importAnyJson(filesJson[i], `Postman file #${i + 1}`);
            totalCols += res.collections.length;
            totalReqs += res.collections.reduce((s, c) => s + c.requests, 0);
            res.collections.forEach((c) => colNames.push(c.name));
            if (res.errors.length > 0) errors.push(...res.errors);
          } catch (e) {
            errors.push(`File #${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        const msg = `Đã import ${totalCols} collection (${totalReqs} request) từ ${filesJson.length} file Postman.` +
          (colNames.length > 0 ? `\nCollections: ${colNames.slice(0, 10).join(', ')}${colNames.length > 10 ? '…' : ''}` : '') +
          (errors.length > 0 ? `\n⚠ Lỗi ${errors.length} file: ${errors.slice(0, 3).join('; ')}` : '');
        return { ok: totalCols > 0 || errors.length === 0, message: msg, collectionsImported: totalCols, requestsImported: totalReqs, errors };
      }
      case 'get_script_snippet': {
        const id = str(args.id).trim();
        const kind = str(args.kind).trim();
        if (id) {
          const s = snippetById(id);
          if (!s) {
            return { ok: false, error: `Không có mẫu “${id}”. Có: ${SCRIPT_SNIPPETS.map((x) => x.id).join(', ')}` };
          }
          return {
            ok: true, id: s.id, kind: s.kind, label: s.label.vi, hint: s.hint.vi, code: s.code,
            note: 'Mẫu này đã chạy thật trong sandbox (vitest). Chỉ sửa các chỗ đánh "// SỬA", rồi chèn bằng update_request (pre_request/tests) hoặc set_scope_scripts.',
          };
        }
        const list = kind === 'pre' || kind === 'tests' ? snippetsFor(kind) : SCRIPT_SNIPPETS;
        return {
          ok: true,
          snippets: list.map((s) => ({ id: s.id, kind: s.kind, label: s.label.vi, hint: s.hint.vi })),
          note: 'Truyền id để lấy nguyên văn code của mẫu.',
        };
      }
      case 'set_scope_scripts': {
        const scope = resolveScope(app, str(args.collection_ref), str(args.folder_ref));
        if ('error' in scope) return { ok: false, error: scope.error };
        const { col, folderId } = scope;
        if (folderId === 'root') {
          return { ok: false, error: 'Script chỉ có ở mức collection hoặc folder cụ thể, không có mức "root".' };
        }
        const atCollection = folderId === 'all';
        const src = atCollection ? col : col.folders.find((f) => f.id === folderId);
        if (!src) return { ok: false, error: 'Không thấy folder.' };
        const where = atCollection ? `collection “${col.name}”` : `folder “${src.name}”`;

        if (args.pre_request === undefined && args.tests === undefined) {
          return { ok: true, scope: where, pre_request: src.preRequest ?? '', tests: src.tests ?? '' };
        }
        const patch = {
          preRequest: args.pre_request !== undefined ? str(args.pre_request) : (src.preRequest ?? ''),
          tests: args.tests !== undefined ? str(args.tests) : (src.tests ?? ''),
        };
        const st = useAppStore.getState();
        if (atCollection) st.setCollectionScripts(col.id, patch);
        else st.setFolderScripts(col.id, folderId, patch);
        return {
          ok: true,
          message: `Đã cập nhật script ${where}. Pre-request: ${patch.preRequest.trim() ? 'có' : 'trống'}, Tests: ${patch.tests.trim() ? 'có' : 'trống'}.`,
          // Script mức collection/folder chạy cho MỌI request trong phạm vi — không tự chọn bừa 1 request để gửi.
          tu_kiem_chung: (patch.preRequest.trim() || patch.tests.trim()) && useAppStore.getState().aiAutoVerify
            ? { skipped: `script mức ${where} — tự gọi send_request trên 1 request trong phạm vi để kiểm chứng (đừng chọn request ghi/destructive)` }
            : undefined,
        };
      }
      case 'list_mock_rules': {
        const { isRunning, port, rules } = useMockStore.getState();
        return {
          ok: true,
          isRunning,
          port,
          rules: rules.map((r) => ({
            id: r.id,
            name: r.name,
            method: r.method,
            path: r.path,
            statusCode: r.statusCode,
            delayMs: r.delayMs,
            enabled: r.enabled,
            responseBodyType: r.responseBodyType,
          })),
        };
      }
      case 'create_mock_rule': {
        const name = str(args.name).trim();
        const method = str(args.method, 'GET').toUpperCase() as any;
        const path = str(args.path).trim();
        const statusCode = Math.floor(Number(args.status_code) || 200);
        const delayMs = Math.max(0, Math.floor(Number(args.delay_ms) || 0));
        const bodyRaw = str(args.response_body);
        let responseBody = bodyRaw;
        let responseBodyType: 'json' | 'text' | 'xml' = 'text';
        if (bodyRaw) {
          try {
            JSON.parse(bodyRaw);
            responseBodyType = 'json';
          } catch {
            if (/^\s*<\?xml|^\s*<[a-zA-Z]/i.test(bodyRaw)) responseBodyType = 'xml';
            else responseBodyType = 'text';
          }
        }
        let headers: KeyValue[] = [{ id: uid('kv'), key: 'Content-Type', value: responseBodyType === 'json' ? 'application/json' : 'text/plain', enabled: true }];
        if (args.headers !== undefined) {
          const parsed = parseHeaderSpec(str(args.headers));
          if (parsed.length > 0) {
            headers = parsed.map((h) => ({ id: uid('kv'), key: h.key, value: h.value, enabled: true }));
          }
        }
        const newId = useMockStore.getState().addRule({
          name,
          method,
          path,
          statusCode,
          delayMs,
          responseBody,
          responseBodyType,
          headers,
          enabled: true,
        });
        const { isRunning, port } = useMockStore.getState();
        return {
          ok: true,
          id: newId,
          name,
          method,
          path,
          statusCode,
          serverStatus: isRunning ? `Đang chạy tại http://localhost:${port}` : 'Server đang tắt (gọi toggle_mock_server để bật)',
          message: `Đã tạo mock rule "${name}" [${method} ${path} -> ${statusCode}].`,
        };
      }
      case 'toggle_mock_server': {
        const mock = useMockStore.getState();
        if (args.port !== undefined) {
          const p = Math.floor(Number(args.port));
          if (p >= 1024 && p <= 65535) mock.setPort(p);
        }
        let newRunning = mock.isRunning;
        if (args.running !== undefined) {
          newRunning = Boolean(args.running);
          if (newRunning) mock.startServer();
          else mock.stopServer();
        } else {
          newRunning = !mock.isRunning;
          if (newRunning) mock.startServer();
          else mock.stopServer();
        }
        const port = useMockStore.getState().port;
        return {
          ok: true,
          isRunning: newRunning,
          port,
          message: newRunning ? `Mock Server đã BẬT tại http://localhost:${port}` : 'Mock Server đã TẮT.',
        };
      }
      case 'export_api_docs': {
        const colRef = str(args.collection_ref);
        const col = matchByRef(app.collections, colRef, (c) => c);
        if (!col) return { ok: false, error: `Không tìm thấy collection "${colRef}".` };
        const folderRef = str(args.folder_ref).trim();
        let folderId: string | undefined = undefined;
        let folderName = '';
        if (folderRef && folderRef !== 'root' && folderRef !== 'all') {
          const folder = matchByRef(col.folders, folderRef, (f) => f);
          if (!folder) return { ok: false, error: `Không tìm thấy folder "${folderRef}" trong collection "${col.name}".` };
          folderId = folder.id;
          folderName = folder.name;
        }
        const format = (str(args.format).toLowerCase() === 'md' ? 'md' : 'html') as 'md' | 'html';
        const env = app.environments.find((e) => e.id === app.activeEnvId);
        const extras = collectDocsExtras();
        const md = renderCollectionDocs(col, app.requests, {
          env: { name: env?.name, variables: env?.variables ?? {}, globals: app.globals },
          folderId,
          ...extras,
        });
        const label = folderName ? `${col.name}-${folderName}` : col.name;
        const text = format === 'html' ? renderDocsHtml(md, { lang: extras.lang }) : md;
        const fname = docsFileName(label, format);
        const where = await saveDocExport(fname, text, format);
        return {
          ok: true,
          collection: col.name,
          folder: folderName || 'toàn bộ collection',
          format,
          savedPath: where,
          message: `Đã xuất tài liệu API (${format.toUpperCase()}) thành công cho ${folderName ? `folder "${folderName}"` : `collection "${col.name}"`} → ${where}`,
        };
      }
      default:
        return { ok: false, error: `Không có tool ${name}.` };
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const live = useAppStore.getState();
    if (orderChain(live.aiChain, live.aiRrIndex, live.aiStrategy).length === 0) {
      setShowKeys(true);
      push({ role: 'model', text: t.ai.noProviderConfigured });
      return;
    }
    setInput('');
    push({ role: 'user', text });
    contentsRef.current.push({ role: 'user', parts: [{ text }] });
    // Dọn history trước mỗi lượt gửi: vết cắt cap-30 có thể để lại cặp call/response gãy.
    contentsRef.current = sanitizeContents(contentsRef.current);
    setBusy(true);
    // Chain: xoay vòng + strategy + admission từng nấc + breaker từng nấc + failover
    const complained = new Set<string>();
    let waitedThisTurn = false; // chỉ đợi lùi 1 lần/lượt, và chỉ cho nấc paid
    /** Số lượt chừa lại khi gần chạm trần (khóa tạm trước khi dính 429 thật) */
    const HEADROOM = 2;
    const bucketFor = (entry: AiChainEntry, rpm: number) => {
      const b = bucketsRef.current[entry.id];
      if (!b || b.rpm !== rpm) bucketsRef.current[entry.id] = { b: new TierBucket(rpm), rpm };
      return bucketsRef.current[entry.id].b;
    };
    const callEntry = async (
      entry: AiChainEntry,
      overrideTools?: GeminiFunctionDecl[],
      onDelta?: (delta: string) => void,
    ) => {
      const def = providerDef(entry.providerId);
      if (!def) throw new Error(`Provider lạ: ${entry.providerId}`);
      const model = entry.model.trim() || def.defaultModel;
      const activeTools = overrideTools !== undefined ? overrideTools : TOOLS;
      if (def.style === 'gemini') {
        const r = await generateContent(entry.key, model, SYSTEM, contentsRef.current, activeTools, onDelta);
        return { parts: r.parts, usage: r.usage, rateLimit: undefined as AiRateLimit | undefined, entry };
      }
      if (def.style === 'anthropic') {
        const r = await anthropicChat({
          baseURL: entry.customBaseURL || def.baseURL,
          key: entry.key,
          model,
          system: SYSTEM,
          contents: contentsRef.current,
          tools: activeTools,
          maxTokens: Math.min(4096, def.maxTokensCap ?? 4096),
          onDelta,
        });
        return { parts: r.parts, usage: r.usage, rateLimit: r.rateLimit, entry };
      }
      const base = buildBaseURL(def, entry.accountId, entry.customBaseURL);
      if (!base) throw new Error(`${def.name}: thiếu Account ID hoặc Base URL.`);
      const r = await openaiChat({
        baseURL: base, key: entry.key, model,
        system: SYSTEM, contents: contentsRef.current, tools: activeTools,
        maxTokens: Math.min(4096, def.maxTokensCap ?? 4096),
        extraHeaders: def.id === 'openrouter' ? { 'HTTP-Referer': 'https://reqx.app', 'X-Title': 'ReqX' } : undefined,
        onDelta,
      });
      return { parts: r.parts, usage: r.usage, rateLimit: r.rateLimit, entry };
    };
    const gen = async (
      overrideTools?: GeminiFunctionDecl[],
      onDelta?: (delta: string) => void,
    ) => {
      const st = useAppStore.getState();
      const order = orderChain(st.aiChain, st.aiRrIndex, st.aiStrategy);
      let lastErr: unknown = new Error('Chain trống.');
      for (const entry of order) {
        const def = providerDef(entry.providerId);
        const tier = entryTier(entry, def);
        const badge = tier === 'paid' ? '💰' : '🆓';
        const label = `${badge} ${def?.name ?? entry.providerId} (${entry.model.trim() || (def?.defaultModel ?? '?')})`;
        // Breaker: nấc đang khóa tạm (vừa sập) thì bỏ qua hẳn
        const now = Date.now();
        const lockedUntil = breakersRef.current[entry.id] ?? 0;
        if (lockedUntil > now) {
          if (!complained.has(`lock:${entry.id}`)) {
            complained.add(`lock:${entry.id}`);
            push({ role: 'tool', text: `🔒 ${label} đang khóa tạm (~${Math.ceil((lockedUntil - now) / 1000)}s nữa) — nhảy xuống nấc tiếp.` });
          }
          continue;
        }
        // Admission từng nấc: trần = số đã học (AIMD), khởi đầu = trần cấu hình.
        // Gần chạm trần thì khóa tạm để lượt sau nhảy xuống nấc kế (né 429 trước khi dính).
        const configured = entryRpm(entry, def);
        const ad = adaptiveRef.current[entry.id] ?? (adaptiveRef.current[entry.id] = adaptiveInit(configured));
        const effectiveRpm = Math.min(ad.learned, configured);
        const bucket = bucketFor(entry, effectiveRpm);
        if (bucket.left(now) < Math.min(HEADROOM, effectiveRpm)) {
          if (!complained.has(`near:${entry.id}`)) {
            complained.add(`near:${entry.id}`);
            push({ role: 'tool', text: `🔒 ${label} gần chạm trần (~${effectiveRpm}/phút, đang tự học) — khóa tạm, nhảy xuống nấc tiếp.` });
          }
          continue;
        }
        bucket.take(now);
        try {
          const r = await callEntry(entry, overrideTools, onDelta);
          delete breakersRef.current[entry.id]; // thành công → mở lại breaker
          // Học trần: header hãng cho số thật thì theo, không thì AIMD tăng dần
          const hl = r.rateLimit?.limit;
          adaptiveRef.current[entry.id] = hl && hl > 0 && hl <= configured
            ? { learned: hl }
            : adaptOnSuccess(ad, configured);
          if (r.rateLimit?.resetMs && r.rateLimit.resetMs > Date.now())
            breakersRef.current[entry.id] = r.rateLimit.resetMs; // hãng báo hết lượt tới giờ X
          st.recordAiUsage(entry.id, r.usage, true);
          return r.parts;
        } catch (e) {
          lastErr = e;
          st.recordAiUsage(entry.id, { prompt: 0, completion: 0 } as AiUsage, false);
          const msg = (e instanceof Error ? e.message : String(e)).slice(0, 160);
          // Sập quota/rate limit → AIMD giảm trần + khóa nấc này để các lượt sau khỏi nện vào
          if (isQuotaError(e)) {
            adaptiveRef.current[entry.id] = adaptOnRateLimit(ad, undefined);
            const m = msg.match(/retry[ -]?after[: ]?(\d+)/i)?.[1];
            const lockSec = Math.min(300, Math.max(60, parseInt(m ?? '60', 10) || 60));
            breakersRef.current[entry.id] = Date.now() + lockSec * 1000;
          }
          // Nấc paid 429 vì gọi dồn → đợi lùi rồi thử lại đúng nấc đó 1 lần; nấc free thì bỏ qua nhanh
          if (tier === 'paid' && !waitedThisTurn && /429|rate.?limit|too many requests/i.test(msg)) {
            waitedThisTurn = true;
            const sec = Math.min(30, Math.max(5, parseInt(msg.match(/retry[ -]?after[: ]?(\d+)/i)?.[1] ?? '10', 10) || 10));
            push({ role: 'tool', text: `⏳ ${label} giới hạn tốc độ — đợi ${sec}s thử lại 1 lần…` });
            await new Promise((r) => setTimeout(r, sec));
            try {
              const r2 = await callEntry(entry, overrideTools, onDelta);
              st.recordAiUsage(entry.id, r2.usage, true);
              return r2.parts;
            } catch (e2) {
              lastErr = e2;
              st.recordAiUsage(entry.id, { prompt: 0, completion: 0 } as AiUsage, false);
            }
          }
          // Báo 1 lần/entry/lượt để vòng tool-loop (tối đa 6 vòng) không spam
          if (!complained.has(entry.id)) {
            complained.add(entry.id);
            const locked = isQuotaError(lastErr) ? ' (đã khóa tạm nấc này)' : '';
            push({ role: 'tool', text: `⚠ ${label} lỗi → thử tiếp${locked}: ${(lastErr instanceof Error ? lastErr.message : String(lastErr)).slice(0, 160)}` });
          }
        }
      }
      throw lastErr;
    };
    try {
      let reply = '';
      for (let i = 0; i < 6; i++) {
        setStreamingText('');
        const handleDelta = (delta: string) => {
          setStreamingText((prev) => (prev ?? '') + delta);
          scrollDown();
        };
        const parts = await gen(undefined, handleDelta);
        setStreamingText(null);
        const calls = parts.filter((p) => p.functionCall);
        const text = parts.map((p) => p.text ?? '').join('');
        if (text) reply += (reply ? '\n\n' : '') + text;
        if (calls.length === 0) {
          contentsRef.current.push({ role: 'model', parts });
          break;
        }
        contentsRef.current.push({ role: 'model', parts });
        const respParts = [];
        for (const c of calls) {
          const fn = c.functionCall!;
          let out: Record<string, unknown>;
          try {
            out = await execTool(fn.name, fn.args ?? {});
          } catch (e) {
            out = { ok: false, error: e instanceof Error ? e.message : String(e) };
          }
          const brief = out.ok === false ? `❌ ${String(out.error ?? 'lỗi')}` : '✓ xong';
          // cho người dùng thấy luôn bước app tự gửi thử kiểm chứng script (không chỉ model biết)
          const sc = out.tu_kiem_chung as Record<string, unknown> | undefined;
          const scTxt = !sc
            ? ''
            : typeof sc.skipped === 'string'
              ? ` · 🔁 bỏ tự chạy thử (${sc.skipped})`
              : sc.scriptError
                ? ` · 🔁 tự chạy thử: script lỗi — ${String(sc.scriptError).slice(0, 90)}`
                : ` · 🔁 tự chạy thử: HTTP ${sc.status ?? '—'} · tests ${sc.tests ?? '0/0'}`;
          push({ role: 'tool', text: `🔧 ${fn.name} → ${brief}${scTxt}` });
          respParts.push({ functionResponse: { name: fn.name, response: out } });
        }
        contentsRef.current.push({ role: 'user', parts: respParts });
      }

      // NẾU sau các vòng gọi tool mà model chưa trả lời văn bản cho user (hoặc bị ngắt ở vòng 6):
      // BẮT BUỘC gọi 1 lượt Final Summary với tools = [] để AI giải thích rõ cho người dùng.
      if (!reply.trim()) {
        try {
          contentsRef.current.push({
            role: 'user',
            parts: [{ text: 'Đã hoàn tất các thao tác công cụ trên. Hãy tóm tắt rõ ràng bằng tiếng Việt cho người dùng: bạn vừa làm những gì, kết quả hoặc lỗi gặp phải là gì, và cần người dùng cung cấp hay làm gì tiếp theo.' }],
          });
          setStreamingText('');
          const handleDelta = (delta: string) => {
            setStreamingText((prev) => (prev ?? '') + delta);
            scrollDown();
          };
          const summaryParts = await gen([], handleDelta);
          setStreamingText(null);
          const summaryText = summaryParts.map((p) => p.text ?? '').join('');
          if (summaryText.trim()) {
            reply = summaryText.trim();
            contentsRef.current.push({ role: 'model', parts: summaryParts });
          }
        } catch {
          setStreamingText(null);
        }
      }

      push({ role: 'model', text: reply.trim() || 'Đã hoàn tất các thao tác trên. Vui lòng kiểm tra kết quả trong app hoặc gửi tiếp yêu cầu.' });
    } catch (e) {
      push({ role: 'model', text: `❌ ${e instanceof Error ? e.message : String(e)}` });
      // Mọi nấc trong chain đều đã thử và lỗi
      if (isQuotaError(e))
        push({ role: 'model', text: t.ai.allQuotaError });
    } finally {
      setStreamingText(null);
      setBusy(false);
      bumpAiRr(); // xoay lượt tiếp theo sang nấc khác (chia tải đều)
      setAiContents(contentsRef.current);
      scrollDown();
    }
  };

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      {onClose && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800 bg-slate-900/60 rounded-t shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-cyan-400 font-semibold text-xs flex items-center gap-1.5">
              <span>✨</span> {t.ai.drawerTitle}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { contentsRef.current = []; clearAiChat(); }}
              className="text-[11px] text-slate-400 hover:text-slate-200 hover:bg-slate-800 px-2 py-0.5 rounded transition-colors flex items-center gap-1"
              title={t.ai.clearChatTitle}
            >
              <span>🗑</span>
              <span>{t.ai.clearChat}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
              title={t.ai.closeAssistant}
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}
      <div className="border border-slate-800 bg-slate-950/60 rounded-xl shrink-0 overflow-hidden">
        <button
          onClick={() => setShowKeys((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800/50 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-400">{showKeys ? '▾' : '▸'}</span>
            <span className="font-semibold text-slate-200 truncate">
              🔑 {t.ai.chainTitle} ({enabledList.length} {t.ai.enabled}: {enabledList.filter((e) => entryTier(e, providerDef(e.providerId)) === 'paid').length}💰 + {enabledList.filter((e) => entryTier(e, providerDef(e.providerId)) !== 'paid').length}🆓)
            </span>
          </div>
          {enabledList[0] && (
            <span className="text-[11px] text-cyan-400/80 font-mono truncate ml-2">
              {aiStrategy === 'stable' ? t.ai.paidFirst : t.ai.freeFirst} · {providerDef(enabledList[0].providerId)?.name ?? ''}
            </span>
          )}
        </button>
        {showKeys && (
          <div className="p-3 pt-1 border-t border-slate-800/80 flex flex-col gap-2.5 max-h-[50vh] overflow-y-auto pr-1.5">
            <div className="flex flex-col gap-2 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 text-xs">
              <div className="flex flex-wrap items-center gap-3 text-slate-300">
                <span className="text-slate-400 font-medium">{t.ai.strategy}</span>
                <label className="flex items-center gap-1.5 cursor-pointer hover:text-white" title={t.ai.saveCostTitle}>
                  <input type="radio" checked={aiStrategy === 'save-cost'} onChange={() => setAiStrategy('save-cost')} className="text-cyan-500 focus:ring-0" />
                  <span>{t.ai.saveCost}</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer hover:text-white" title={t.ai.stableTitle}>
                  <input type="radio" checked={aiStrategy === 'stable'} onChange={() => setAiStrategy('stable')} className="text-cyan-500 focus:ring-0" />
                  <span>{t.ai.stable}</span>
                </label>
              </div>
              <label
                className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white pt-1 border-t border-slate-800/60"
                title={t.ai.autoVerifyTitle}
              >
                <input type="checkbox" checked={aiAutoVerify} onChange={(ev) => setAiAutoVerify(ev.target.checked)} className="rounded text-cyan-500 focus:ring-0" />
                <span>{t.ai.autoVerify}</span>
              </label>
            </div>
            {aiChain.map((e, i) => {
              const def = providerDef(e.providerId) ?? AI_PROVIDERS[0];
              const suggestions = [...new Set([...def.models, ...(fetched[e.id] ?? [])])];
              const tier = entryTier(e, def);
              const st = aiStats[e.id];
              const statTip = st
                ? (t.ai.statTip as string)
                    .replace('{calls}', String(st.calls))
                    .replace('{fails}', String(st.fails))
                    .replace('{total}', String(st.prompt + st.completion))
                    .replace('{prompt}', String(st.prompt))
                    .replace('{completion}', String(st.completion))
                : t.ai.neverCalled;
              return (
                <div
                  key={e.id}
                  className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex flex-col gap-2.5 shadow-sm transition-colors hover:border-slate-700"
                  title={statTip}
                >
                  {/* Row 1: Checkbox, Tier selector, Order & Delete */}
                  <div className="flex items-center justify-between gap-2 border-b border-slate-800/60 pb-2">
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={e.enabled}
                          onChange={(ev) => updEntry(e.id, { enabled: ev.target.checked })}
                          className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                        />
                        <span>#{i + 1}</span>
                      </label>
                      <span className="text-slate-600">|</span>
                      <select
                        value={e.tier ?? ''}
                        onChange={(ev) => updEntry(e.id, { tier: (ev.target.value || undefined) as AiChainEntry['tier'] })}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-300 outline-none hover:border-slate-700"
                      >
                        <option value="">{t.ai.byProvider} ({def.tier === 'paid' ? '💰' : '🆓'})</option>
                        <option value="free">🆓 {t.ai.freeTier}</option>
                        <option value="paid">💰 {t.ai.paidTier}</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => moveEntry(e.id, -1)}
                        title={t.ai.moveUp}
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                      >
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-none stroke-current" strokeWidth="2"><path d="M18 15l-6-6-6 6"/></svg>
                      </button>
                      <button
                        onClick={() => moveEntry(e.id, 1)}
                        title={t.ai.moveDown}
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                      >
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-none stroke-current" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                      </button>
                      <button
                        onClick={() => delEntry(e.id)}
                        title={t.ai.deleteTier}
                        className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors ml-1"
                      >
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-none stroke-current" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  </div>

                  {/* Row 2: Provider & Model */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-400 font-medium">{t.ai.providerLabel}</span>
                      <select
                        value={e.providerId}
                        onChange={(ev) => {
                          const nd = providerDef(ev.target.value) ?? AI_PROVIDERS[0];
                          updEntry(e.id, { providerId: nd.id, model: nd.defaultModel });
                        }}
                        className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-500"
                      >
                        {AI_PROVIDERS.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
                        <span>{t.ai.modelLabel} {fetched[e.id] ? `(${fetched[e.id].length})` : ''}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {customModel === e.id || (e.model.trim() !== '' && !suggestions.includes(e.model)) ? (
                          <div className="flex-1 flex gap-1 min-w-0">
                            <input
                              value={e.model}
                              onChange={(ev) => updEntry(e.id, { model: ev.target.value })}
                              placeholder={def.defaultModel}
                              className="flex-1 min-w-0 bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-cyan-500"
                            />
                            <button
                              onClick={() => { setCustomModel(null); if (!suggestions.includes(e.model)) updEntry(e.id, { model: def.defaultModel }); }}
                              title={t.ai.pickFromList}
                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-slate-300"
                            >
                              ▼
                            </button>
                          </div>
                        ) : (
                          <select
                            value={e.model}
                            onChange={(ev) => {
                              if (ev.target.value === '__custom') setCustomModel(e.id);
                              else updEntry(e.id, { model: ev.target.value });
                            }}
                            className="flex-1 min-w-0 bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-cyan-500 truncate"
                          >
                            {e.model === '' && <option value="">{t.ai.selectModel}</option>}
                            {suggestions.map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                            <option value="__custom">{t.ai.customModel}</option>
                          </select>
                        )}
                        <button
                          onClick={() => void loadModels(e)}
                          disabled={loadingModels === e.id || (!e.key.trim() && !def.noKeyRequired)}
                          title={e.key.trim() || def.noKeyRequired ? t.ai.fetchModelsTitle : t.ai.fetchModelsNeedKey}
                          className="shrink-0 p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-cyan-300 disabled:opacity-40"
                        >
                          {loadingModels === e.id ? '…' : '↻'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Row 3: API Key & RPM */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex flex-col gap-1 min-w-0">
                      <span className="text-[11px] text-slate-400 font-medium truncate">{def.keyLabel}</span>
                      <input
                        type="password"
                        value={e.key}
                        onChange={(ev) => updEntry(e.id, { key: ev.target.value })}
                        placeholder={def.keyPlaceholder}
                        className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-cyan-500"
                      />
                    </div>

                    <div className="w-20 shrink-0 flex flex-col gap-1">
                      <span className="text-[11px] text-slate-400 font-medium" title={t.ai.rpmTitle}>
                        RPM
                      </span>
                      <input
                        value={e.rpm ?? ''}
                        onChange={(ev) => {
                          const n = parseInt(ev.target.value, 10);
                          updEntry(e.id, { rpm: Number.isFinite(n) && n > 0 ? n : undefined });
                        }}
                        placeholder={String(entryRpm({ ...e, rpm: undefined }, def))}
                        inputMode="numeric"
                        className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-2 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-cyan-500 text-center"
                      />
                    </div>
                  </div>

                  {/* Account ID if needed (e.g. Cloudflare) */}
                  {def.needsAccountId && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-400 font-medium">{def.accountLabel ?? 'Account ID'}</span>
                      <input
                        value={e.accountId ?? ''}
                        onChange={(ev) => updEntry(e.id, { accountId: ev.target.value })}
                        placeholder="Cloudflare Account ID"
                        className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-cyan-500"
                      />
                    </div>
                  )}

                  {/* Ollama / Local LLM custom Base URL */}
                  {def.id === 'ollama' && (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
                        <span>{t.ai.serverBaseUrl}</span>
                        <span className="text-[10px] text-slate-500">{t.ai.defaultLabel} {def.baseURL}</span>
                      </div>
                      <input
                        value={e.customBaseURL ?? ''}
                        onChange={(ev) => updEntry(e.id, { customBaseURL: ev.target.value })}
                        placeholder={def.baseURL}
                        className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-cyan-500"
                      />
                    </div>
                  )}
                </div>
              );
            })}
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                onClick={addEntry}
                className="px-3 py-1.5 bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-500/40 text-cyan-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
              >
                <span>+</span> {t.ai.addProvider}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed bg-slate-900/40 p-2 rounded-lg border border-slate-800/60">
              {t.ai.chainHelp}
            </p>
            {Object.keys(aiStats).length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span>
                  {(t.ai.usedTokens as string)
                    .replace('{total}', Object.values(aiStats).reduce((a, s) => a + s.prompt + s.completion, 0).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US'))
                    .replace('{prompt}', Object.values(aiStats).reduce((a, s) => a + s.prompt, 0).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US'))
                    .replace('{completion}', Object.values(aiStats).reduce((a, s) => a + s.completion, 0).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US'))
                    .replace('{fails}', Object.values(aiStats).reduce((a, s) => a + s.fails, 0).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US'))}
                </span>
                <button onClick={clearAiStats} title={t.ai.clearStatsTitle} className="text-slate-500 hover:text-slate-300 underline">
                  {t.ai.reset}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div
        ref={boxRef}
        onMouseLeave={() => setHoveredPrompt(null)}
        className="flex-1 min-h-0 overflow-auto border border-slate-800 rounded p-3 flex flex-col gap-2 bg-slate-950/50 relative"
      >
        {/* Sticky Prompt Pinned Header: Neo câu lệnh tương ứng khi rê chuột hoặc câu gần nhất */}
        {(() => {
          const lastUserMsg = [...msgs].reverse().find((m) => m.role === 'user');
          const activePromptText = hoveredPrompt || lastUserMsg?.text;
          if (!activePromptText) return null;
          return (
            <div className="sticky top-0 z-10 -mt-1 -mx-1 mb-2 px-3 py-2 bg-slate-900/95 border-b border-teal-500/30 backdrop-blur-md rounded-t shadow-md flex items-center justify-between gap-2 group transition-all">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-teal-400 bg-teal-950/80 border border-teal-500/40 px-1.5 py-0.5 rounded shrink-0">
                  Prompt
                </span>
                <span className="text-xs text-slate-200 font-medium truncate" title={activePromptText}>
                  {activePromptText}
                </span>
              </div>
              <button
                onClick={() => setInput(activePromptText)}
                title="Dán lại câu lệnh này vào ô nhập"
                className="opacity-0 group-hover:opacity-100 text-[10px] text-slate-400 hover:text-cyan-300 px-1.5 py-0.5 rounded hover:bg-slate-800 transition-all shrink-0 font-mono"
              >
                ↩ Dùng lại
              </button>
            </div>
          );
        })()}

        {msgs.length === 0 && (
          <p className="text-slate-500 text-sm">
            {t.ai.emptyHint}
          </p>
        )}
        {msgs.map((m, i) => {
          // Tìm câu lệnh user tương ứng cho block này (quay ngược từ index i đến user msg gần nhất)
          const findPromptFor = (idx: number) => {
            for (let k = idx; k >= 0; k--) {
              if (msgs[k].role === 'user') return msgs[k].text;
            }
            return null;
          };

          if (m.role === 'user') {
            return (
              <div
                key={i}
                onMouseEnter={() => setHoveredPrompt(m.text)}
                className="group relative text-sm rounded-xl px-3 py-2 bg-slate-800 text-slate-100 self-end max-w-[90%] shadow-sm border border-slate-700/60"
              >
                <div className="whitespace-pre-wrap break-words pr-6">{m.text}</div>
                <button
                  onClick={() => void copyText(m.text, i)}
                  title={copiedIdx === i ? t.ai.copied : t.ai.copyChat}
                  className="absolute top-1.5 right-1.5 p-1 rounded-md text-slate-400 hover:text-white bg-slate-800/90 hover:bg-slate-700 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                >
                  {copiedIdx === i ? (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium px-1">
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-none stroke-current" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span>{t.ai.copied}</span>
                    </span>
                  ) : (
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-none stroke-current" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  )}
                </button>
              </div>
            );
          }

          if (m.role === 'model') {
            return (
              <div
                key={i}
                onMouseEnter={() => {
                  const p = findPromptFor(i);
                  if (p) setHoveredPrompt(p);
                }}
                className="group relative text-sm rounded-xl px-3 py-2 bg-slate-900/90 border border-slate-800 hover:border-slate-700 text-slate-200 self-start max-w-[95%] shadow-sm transition-colors"
              >
                <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-800/80 text-[11px]">
                  <span className="flex items-center gap-1.5 text-cyan-400 font-medium">
                    <span>✨</span> {t.ai.aiAssistant}
                  </span>
                  <button
                    onClick={() => void copyText(m.text, i)}
                    title={copiedIdx === i ? t.ai.copied : t.ai.copyReply}
                    className="p-1 px-1.5 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-all flex items-center gap-1 text-[11px]"
                  >
                    {copiedIdx === i ? (
                      <span className="flex items-center gap-1 text-emerald-400 font-medium">
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-none stroke-current" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        <span>{t.ai.copied}</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-slate-400 hover:text-cyan-300">
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-none stroke-current" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        <span className="text-[10px]">{t.common.copy}</span>
                      </span>
                    )}
                  </button>
                </div>
                <MarkdownMessage content={m.text} />
              </div>
            );
          }

          return (
            <div
              key={i}
              onMouseEnter={() => {
                const p = findPromptFor(i);
                if (p) setHoveredPrompt(p);
              }}
              className="group text-slate-400 text-xs font-mono py-0.5 px-1.5 flex items-center justify-between hover:bg-slate-900/50 rounded transition-colors"
            >
              <span className="truncate pr-2">{m.text}</span>
              <button
                onClick={() => void copyText(m.text, i)}
                title={t.ai.copyToolLog}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-500 hover:text-slate-300 transition-opacity shrink-0"
              >
                {copiedIdx === i ? (
                  <span className="text-[10px] text-emerald-400">✓</span>
                ) : (
                  <svg viewBox="0 0 24 24" className="w-3 h-3 fill-none stroke-current" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                )}
              </button>
            </div>
          );
        })}
        {streamingText !== null && (
          <div className="group relative text-sm rounded-xl px-3 py-2 bg-slate-900/90 border border-cyan-500/50 text-slate-200 self-start max-w-[95%] shadow-sm transition-colors">
            <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-800/80 text-[11px]">
              <span className="flex items-center gap-1.5 text-cyan-400 font-medium">
                <span className="inline-block animate-spin text-xs">✨</span> {t.ai.streaming}
              </span>
            </div>
            <MarkdownMessage content={streamingText || '…'} />
          </div>
        )}
        {busy && streamingText === null && <div className="text-xs text-slate-500">{t.ai.thinking}</div>}
      </div>

      <div className="flex gap-2 shrink-0 items-end">
        <textarea
          rows={Math.min(5, Math.max(1, input.split('\n').length))}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={t.ai.inputPlaceholder}
          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 resize-none font-sans text-slate-200 placeholder-slate-500 max-h-32 transition-all"
        />
        <button
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg px-4 py-2 text-sm disabled:opacity-40 shadow-md transition-all h-[38px] shrink-0"
        >
          {t.ai.send}
        </button>
      </div>
    </div>
  );
}
