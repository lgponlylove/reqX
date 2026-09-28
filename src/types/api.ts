export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export type BodyType = 'none' | 'json' | 'raw' | 'form-data' | 'urlencoded';

export type AuthType = 'none' | 'bearer' | 'basic' | 'apikey';

export interface AuthConfig {
  type: AuthType;
  token?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  apiKeyIn?: 'header' | 'query';
  apiKeyName?: string;
}

export interface ApiRequest {
  id: string;
  name: string;
  method: HttpMethod;
  /** URL có thể chứa biến {{var}} */
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  bodyType: BodyType;
  body: string;
  auth: AuthConfig;
  /** Script JS chạy trước khi gửi (được phép sửa biến + request) */
  preRequest?: string;
  /** Script JS kiểm tra response (pm.test / pm.expect) */
  tests?: string;
  collectionId?: string;
  updatedAt: number;
  /** Nguồn gốc: 'imported' = từ file import vào (chạy script phải hỏi trước); tự tạo hoặc đã mở-ra-lưu = local */
  origin?: 'local' | 'imported';
}

export interface ApiResponse {
  status: number;
  statusText: string;
  timeMs: number;
  sizeBytes: number;
  headers: Record<string, string>;
  /** text: body gốc; binary: body là base64 */
  body: string;
  bodyKind?: 'text' | 'binary';
}

export interface Folder {
  id: string;
  name: string;
  requestIds: string[];
}

export interface Collection {
  id: string;
  name: string;
  folders: Folder[];
  /** request nằm ngoài folder (root) */
  rootRequestIds: string[];
}

/** Thư mục cấp cao (kiểu workspace): chứa các collection. Collection không nằm trong dir nào = "Ngoài thư mục". */
export interface Dir {
  id: string;
  name: string;
  collectionIds: string[];
}

export interface Environment {
  id: string;
  name: string;
  variables: Record<string, string>;
}

export interface HistoryItem {
  id: string;
  request: ApiRequest;
  responseStatus: number;
  timeMs: number;
  createdAt: number;
}

/** Nguồn trích giá trị từ response để truyền sang step sau. */
export type ExtractFrom = 'body-json' | 'header' | 'status' | 'body-text';

export interface ExtractRule {
  id: string;
  /** Tên biến flow sẽ tạo ra */
  name: string;
  from: ExtractFrom;
  /**
   * body-json: dot-path (vd `data.access_token`, hỗ trợ index `items.0.id`);
   * header: tên header (không phân biệt hoa/thường);
   * status: bỏ trống (lấy status code);
   * body-text: regex (lấy group 1, không có group thì lấy cả match — dùng được cho XML/text).
   */
  path: string;
}

export interface FlowStep {
  id: string;
  collectionId: string;
  requestId: string;
  disabled?: boolean;
  extract: ExtractRule[];
}

export interface Flow {
  id: string;
  name: string;
  steps: FlowStep[];
  createdAt: number;
}

export const DEFAULT_REQUEST: Omit<ApiRequest, 'id' | 'updatedAt'> = {
  name: 'New Request',
  method: 'GET',
  url: '{{baseUrl}}/users',
  params: [],
  headers: [],
  bodyType: 'none',
  body: '',
  auth: { type: 'none' },
  preRequest: '',
  tests: '',
};
