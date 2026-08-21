import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export interface DevMiddleware {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  close(): Promise<void>;
}

/** Mount Vite in middleware mode on our own http server (dev only). */
export async function createViteDev(httpServer: Server, rootDir: string, webDir: string): Promise<DevMiddleware> {
  const vite = await import('vite');
  const server = await vite.createServer({
    configFile: path.join(rootDir, 'vite.config.ts'),
    root: webDir,
    appType: 'custom',
    server: { middlewareMode: true, ws: { server: httpServer } },
  });
  const indexPath = path.join(webDir, 'index.html');
  return {
    handle(req, res) {
      return new Promise<void>((resolve) => {
        server.middlewares(req, res, async () => {
          try {
            const url = req.url ?? '/';
            let html = fs.readFileSync(indexPath, 'utf8');
            html = await server.transformIndexHtml(url, html);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(html);
          } catch (e) {
            server.ssrFixStacktrace?.(e as Error);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(String((e as Error)?.stack ?? e));
          }
          resolve();
        });
      });
    },
    close: () => server.close(),
  };
}
