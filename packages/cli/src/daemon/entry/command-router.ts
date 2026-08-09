import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  handleHandoffRoute,
  type HandoffRouteDeps,
} from '../infrastructure/inbound/local/routes/handoff.route.js';

export type CommandRouterDeps = HandoffRouteDeps;

// fallow-ignore-next-line complexity
export async function dispatchCliHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CommandRouterDeps
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const method = req.method ?? 'GET';
  const path = url.pathname;

  if (method === 'POST' && path === '/handoff') {
    await handleHandoffRoute(req, res, deps);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: `No route for ${method} ${path}` }));
}
