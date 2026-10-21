import protobuf from 'protobufjs';

export interface GrpcMethod {
  /** Tên đầy đủ kiểu URL: package.Service/Method */
  path: string;
  name: string;
  inputType: string;
  outputType: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
}

export interface GrpcService {
  fullName: string;
  methods: GrpcMethod[];
}

export interface ParsedProto {
  root: protobuf.Root;
  services: GrpcService[];
}

/** Parse nội dung .proto → root + danh sách service/method. */
export function parseProto(text: string): ParsedProto {
  const parsed = protobuf.parse(text, { keepCase: true });
  const root = parsed.root;
  root.resolveAll();
  const services: GrpcService[] = [];
  const walk = (ns: protobuf.NamespaceBase) => {
    for (const nested of ns.nestedArray) {
      if (nested instanceof protobuf.Service) {
        const methods: GrpcMethod[] = Object.values(nested.methods).map((m) => ({
          path: `${nested.fullName.slice(1)}/${m.name}`,
          name: m.name,
          inputType: m.resolvedRequestType?.fullName.slice(1) ?? m.requestType,
          outputType: m.resolvedResponseType?.fullName.slice(1) ?? m.responseType,
          clientStreaming: !!m.requestStream,
          serverStreaming: !!m.responseStream,
        }));
        services.push({ fullName: nested.fullName.slice(1), methods });
      } else if (nested instanceof protobuf.Namespace) {
        walk(nested);
      }
    }
  };
  walk(root);
  return { root, services };
}

/** Encode object JSON → protobuf bytes theo message type. */
export function encodeMessage(root: protobuf.Root, typeName: string, json: unknown): Uint8Array {
  const type = root.lookupType(typeName);
  const err = type.verify(json as protobuf.Message<{}>);
  if (err) throw new Error(`Request không khớp ${typeName}: ${err}`);
  return type.encode(type.fromObject(json as protobuf.Message<{}>)).finish();
}

/** Decode protobuf bytes → object JSON. */
export function decodeMessage(root: protobuf.Root, typeName: string, bytes: Uint8Array): unknown {
  const type = root.lookupType(typeName);
  const msg = type.decode(bytes);
  return type.toObject(msg, { longs: String, enums: String, bytes: String, defaults: false });
}

/** Đóng khung gRPC-Web: 0x00 + length BE32 + payload. */
export function frameGrpcWeb(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = 0;
  new DataView(out.buffer).setUint32(1, payload.length, false);
  out.set(payload, 5);
  return out;
}

export interface GrpcWebResult {
  grpcStatus: number;
  grpcMessage: string;
  /** data frames nối lại (chưa decode) */
  data: Uint8Array | null;
  trailerHeaders: Record<string, string>;
}

/** Gửi unary gRPC-Web qua fetch POST. Cần server/proxy hỗ trợ gRPC-Web + CORS. */
export async function sendGrpcWeb(
  url: string,
  framed: Uint8Array,
  metadata: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<GrpcWebResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`Timeout sau ${timeoutMs / 1000}s`)), timeoutMs);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  }
  try {
    const headers: Record<string, string> = {
      'content-type': 'application/grpc-web+proto',
      accept: 'application/grpc-web+proto',
      ...metadata,
    };
    const res = await fetch(url, { method: 'POST', headers, body: framed as BodyInit, signal: ctrl.signal });
    if (!res.ok && res.status !== 200) {
      throw new Error(`HTTP ${res.status} ${res.statusText} — proxy/server chưa hỗ trợ gRPC-Web?`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    // Tách frames: byte0 flag (0x00 data, 0x80 trailer), 4 byte length
    const dataParts: Uint8Array[] = [];
    const trailerBytes: number[] = [];
    let off = 0;
    while (off + 5 <= buf.length) {
      const flag = buf[off];
      const len = new DataView(buf.buffer, buf.byteOffset + off + 1, 4).getUint32(0, false);
      const chunk = buf.slice(off + 5, off + 5 + len);
      if (flag & 0x80) trailerBytes.push(...chunk);
      else dataParts.push(chunk);
      off += 5 + len;
    }
    const trailerText = new TextDecoder().decode(new Uint8Array(trailerBytes));
    const trailerHeaders: Record<string, string> = {};
    for (const line of trailerText.split('\r\n')) {
      const i = line.indexOf(':');
      if (i > 0) trailerHeaders[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    const total = dataParts.reduce((a, p) => a + p.length, 0);
    const data = new Uint8Array(total);
    let p = 0;
    for (const part of dataParts) {
      data.set(part, p);
      p += part.length;
    }
    return {
      grpcStatus: Number(trailerHeaders['grpc-status'] ?? -1),
      grpcMessage: decodeURIComponent(trailerHeaders['grpc-message'] ?? ''),
      data: total > 0 ? data : null,
      trailerHeaders,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const PROTO_SAMPLE = `syntax = "proto3";

package hello;

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
}

message HelloRequest {
  string name = 1;
}

message HelloReply {
  string message = 1;
}
`;
