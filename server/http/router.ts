import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, sendError, sendJson } from './body.ts';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  deviceId: string | null;
  json<T = unknown>(): Promise<T>;
}

export type Result = { status: number; body: unknown; headers?: Record<string, string> } | void;
export type Handler = (ctx: Ctx) => Promise<Result> | Result;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method: method.toUpperCase(), segments: pattern.split('/').filter(Boolean), handler });
  }
  get(p: string, h: Handler) {
    this.add('GET', p, h);
  }
  post(p: string, h: Handler) {
    this.add('POST', p, h);
  }
  put(p: string, h: Handler) {
    this.add('PUT', p, h);
  }
  delete(p: string, h: Handler) {
    this.add('DELETE', p, h);
  }

  /** Returns true if a route matched (response handled), false to fall through. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const method = (req.method ?? 'GET').toUpperCase();
    let pathMatched = false;
    for (const r of this.routes) {
      const params = match(r.segments, parts);
      if (!params) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const ctx: Ctx = {
        req,
        res,
        url,
        params,
        query: url.searchParams,
        deviceId: (req.headers['x-device-id'] as string | undefined) ?? url.searchParams.get('device_id'),
        json: () => readJson(req),
      };
      try {
        const result = await r.handler(ctx);
        if (result && !res.writableEnded) sendJson(res, result.status, result.body, { req, headers: result.headers });
      } catch (e) {
        if (res.writableEnded) return true;
        if (e instanceof HttpError) sendError(res, e.status, e.code, e.message, e.extra);
        else {
          console.error(`[http] ${method} ${url.pathname} failed:`, e);
          sendError(res, 500, 'INTERNAL', (e as Error)?.message ?? 'Internal error');
        }
      }
      return true;
    }
    if (pathMatched) {
      sendError(res, 405, 'METHOD_NOT_ALLOWED', `${method} not allowed`);
      return true;
    }
    return false;
  }
}

function match(pattern: string[], parts: string[]): Record<string, string> | null {
  if (pattern.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i]);
    else if (p !== parts[i]) return null;
  }
  return params;
}
