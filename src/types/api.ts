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

export type BodyType = 'none' | 'json' | 'raw' | 'form-data' | 'urlencoded' | 'binary';

export type RawSubtype = 'json' | 'text' | 'javascript' | 'html' | 'xml';

export type AuthType = 'none' | 'bearer' | 'basic' | 'apikey' | 'oauth2' | 'digest' | 'awsv4' | 'ntlm';

export interface OAuth2Config {
  grantType?: 'client_credentials' | 'password' | 'authorization_code' | 'implicit' | 'refresh_token';
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  issuedAt?: number;
  addTokenTo?: 'header' | 'query';
  tokenUrl?: string;
  authUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  username?: string;
  password?: string;
  redirectUri?: string;
  code?: string;
  codeVerifier?: string;
  codeChallenge?: string;
  clientAuth?: 'header' | 'body';
  headerPrefix?: string; // Default: 'Bearer'
  autoSaveVar?: string; // e.g. 'accessToken'
  /** Ghi autoSaveVar vào đâu: 'env' = môi trường đang chọn (mặc định), 'global' = biến Dùng chung */
  autoSaveScope?: 'env' | 'global';
  /** 'access_token' (mặc định) hay 'Bearer xxx' — nhiều API cần nguyên cả prefix trong 1 biến */
  autoSaveFormat?: 'access_token' | 'with_type';
}

export interface DigestConfig {
  username?: string;
  password?: string;
  realm?: string;
  nonce?: string;
  algorithm?: 'MD5' | 'SHA-256';
  qop?: 'auth' | 'auth-int' | 'none';
  opaque?: string;
}

export interface AwsSigV4Config {
  accessKey?: string;
  accessKeyId?: string;
  secretKey?: string;
  secretAccessKey?: string;
  region?: string;
  service?: string;
  sessionToken?: string;
}

export interface NtlmConfig {
  username?: string;
  password?: string;
  domain?: string;
  workstation?: string;
}

export interface AuthConfig {
  type: AuthType;
  token?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  apiKeyIn?: 'header' | 'query';
  apiKeyName?: string;
  oauth2?: OAuth2Config;
  digest?: DigestConfig;
  awsv4?: AwsSigV4Config;
  ntlm?: NtlmConfig;
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
  rawType?: RawSubtype;
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
  description?: string;
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
  /** Nested folders bên trong folder này */
  folderIds: string[];
  /** Script chạy trước mọi request trong folder (kế thừa từ collection xuống) */
  preRequest?: string;
  /** Script test chạy sau mọi request trong folder */
  tests?: string;
}

export interface Collection {
  id: string;
  name: string;
  folders: Folder[];
  /** request nằm ngoài folder (root) */
  rootRequestIds: string[];
  /** Script chạy trước mọi request trong collection */
  preRequest?: string;
  /** Script test chạy sau mọi request trong collection */
  tests?: string;
}

/** Thư mục (kiểu workspace): chứa các collection, lồng nhau không giới hạn qua parentId. Collection không nằm trong dir nào = "Ngoài thư mục". */
export interface Dir {
  id: string;
  name: string;
  collectionIds: string[];
  /** id thư mục cha; null/undefined = thư mục gốc */
  parentId?: string | null;
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
  response?: ApiResponse;
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

export type StepConditionOp = '==' | '!=' | 'contains' | '>' | '<' | 'exists' | 'empty';

export interface StepCondition {
  enabled: boolean;
  varName: string;
  operator: StepConditionOp;
  value: string;
  onFalse?: 'skip' | 'jump';
  jumpStepId?: string;
}

export interface StepRetry {
  enabled: boolean;
  maxAttempts: number; // Tối đa số lần chạy (1 + retries)
  delayMs: number;     // Thời gian chờ giữa các lần thử lại
}

export interface FlowStep {
  id: string;
  collectionId: string;
  requestId: string;
  disabled?: boolean;
  extract: ExtractRule[];
  /** Điều kiện chạy bước này: nếu sai -> bỏ qua hoặc nhảy bước */
  condition?: StepCondition;
  /** Tự động thử lại khi request hoặc assertion bị lỗi */
  retry?: StepRetry;
  /** Nhảy tới bước khác nếu bước này chạy THÀNH CÔNG */
  onSuccessJump?: string;
  /** Nhảy tới bước khác nếu bước này THẤT BẠI sau khi đã hết số lần retry */
  onFailJump?: string;
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
  description: '',
};

export interface MockRule {
  id: string;
  name: string;
  enabled: boolean;
  method: HttpMethod | 'ALL';
  /** Path khớp, ví dụ: /api/users hoặc /api/users/:id hoặc /test* */
  path: string;
  statusCode: number;
  delayMs?: number;
  headers: KeyValue[];
  responseBody: string;
  responseBodyType: 'json' | 'text' | 'xml';
}

export interface MockLogItem {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  matchedRuleId: string | null;
  statusCode: number;
  responseBody: string;
  timeMs: number;
}

