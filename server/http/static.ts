import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

function sendFile(res: ServerResponse, file: string, cacheControl: string): void {
  const stat = fs.statSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cacheControl,
  });
  fs.createReadStream(file).pipe(res);
}

const SAFE_IMG = /^[A-Za-z0-9_-]+\.(webp|png|jpg)$/;

/** /img/<file> and /img/thumb/<file> from the images dir. Returns true if handled. */
export function serveImage(req: IncomingMessage, res: ServerResponse, pathname: string, imagesDir: string): boolean {
  if (!pathname.startsWith('/img/')) return false;
  const rest = pathname.slice(5);
  let file: string;
  if (rest.startsWith('thumb/')) {
    const name = rest.slice(6);
    if (!SAFE_IMG.test(name)) return notFound(res);
    file = path.join(imagesDir, 'thumb', name);
  } else {
    if (!SAFE_IMG.test(rest)) return notFound(res);
    file = path.join(imagesDir, rest);
  }
  if (!fs.existsSync(file)) return notFound(res);
  sendFile(res, file, 'public, max-age=31536000, immutable');
  return true;
}

/** Production: dist/ with SPA fallback. Returns true if handled. */
export function serveDist(req: IncomingMessage, res: ServerResponse, pathname: string, distDir: string): boolean {
  if (!fs.existsSync(distDir)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Frontend not built. Run: npm run build   (or use npm run dev)');
    return true;
  }
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const candidate = path.normalize(path.join(distDir, rel));
  if (candidate.startsWith(distDir) && rel && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    const immutable = rel.startsWith('assets/');
    sendFile(res, candidate, immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    return true;
  }
  // SPA fallback
  const index = path.join(distDir, 'index.html');
  if (fs.existsSync(index)) {
    sendFile(res, index, 'no-store');
    return true;
  }
  return notFound(res);
}

function notFound(res: ServerResponse): true {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
  return true;
}
