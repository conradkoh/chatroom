import type { IncomingMessage, ServerResponse } from 'node:http';

import type { HarnessStreamEvent, StreamHub } from './stream-hub.js';
import type { PersistenceStore } from '../../infrastructure/persistence/index.js';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
  sendJson(res, 200, { status: 'ok', service: 'v2-local-web' });
}

// fallow-ignore-next-line complexity
export function handleHarnessHistory(
  req: IncomingMessage,
  res: ServerResponse,
  persistence: PersistenceStore | undefined
): void {
  if (!persistence) {
    sendJson(res, 200, { lines: [] });
    return;
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const harness = url.searchParams.get('harness') ?? undefined;
  const limit = Number(url.searchParams.get('limit') ?? '500');
  const lines = persistence.listHarnessStreamLines({
    harness,
    limit: Number.isFinite(limit) ? limit : 500,
  });
  sendJson(res, 200, { lines });
}

export function handleHarnessStreamSse(
  req: IncomingMessage,
  res: ServerResponse,
  streamHub: StreamHub
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

  const send = (event: HarnessStreamEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const unsubscribe = streamHub.subscribe(send);

  req.on('close', () => {
    unsubscribe();
    res.end();
  });
}

// fallow-ignore-next-line complexity
export function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: { persistence?: PersistenceStore; streamHub: StreamHub }
): void {
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  if (req.method === 'GET' && pathname === '/health') return handleHealth(req, res);
  if (req.method === 'GET' && pathname === '/api/harness/history')
    return handleHarnessHistory(req, res, deps.persistence);
  if (req.method === 'GET' && pathname === '/events/harness-stream')
    return handleHarnessStreamSse(req, res, deps.streamHub);
  sendJson(res, 404, { error: 'not_found' });
}
