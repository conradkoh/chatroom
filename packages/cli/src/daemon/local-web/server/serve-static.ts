import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

export function resolveClientDistDir(): string {
  return join(import.meta.dirname, '../../client/build');
}

// fallow-ignore-next-line complexity
export function tryServeStatic(
  req: IncomingMessage,
  res: ServerResponse,
  distDir: string
): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  if (pathname.startsWith('/api/') || pathname.startsWith('/events/') || pathname === '/health') {
    return false;
  }

  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = join(distDir, safePath);

  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end();
    return true;
  }

  if (existsSync(filePath)) {
    const ext = safePath.slice(safePath.lastIndexOf('.'));
    const type = MIME[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(readFileSync(filePath));
    }
    return true;
  }

  const indexPath = join(distDir, 'index.html');
  if (existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(readFileSync(indexPath));
    }
    return true;
  }

  return false;
}
