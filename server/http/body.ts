import type { IncomingMessage, ServerResponse } from 'node:http';
import zlib from 'node:zlib';

export class HttpError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export async function readJson<T = unknown>(req: IncomingMessage, limit = 5 * 1024 * 1024): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > limit) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `Body exceeds ${limit} bytes`);
    chunks.push(b);
  }
  if (size === 0) return {} as T;
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'Request body is not valid JSON');
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, opts: { req?: IncomingMessage; headers?: Record<string, string> } = {}): void {
  const json = Buffer.from(JSON.stringify(body));
  const headers: Record<string, string | number> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(opts.headers ?? {}),
  };
  const acceptsGzip = opts.req?.headers['accept-encoding']?.toString().includes('gzip');
  if (acceptsGzip && json.length > 1024) {
    const gz = zlib.gzipSync(json);
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = gz.length;
    headers['Vary'] = 'Accept-Encoding';
    res.writeHead(status, headers);
    res.end(gz);
  } else {
    headers['Content-Length'] = json.length;
    res.writeHead(status, headers);
    res.end(json);
  }
}

export function sendError(res: ServerResponse, status: number, code: string, message: string, extra: Record<string, unknown> = {}): void {
  sendJson(res, status, { error: { code, message, ...extra } });
}

export function sendText(res: ServerResponse, status: number, text: string, contentType = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}
