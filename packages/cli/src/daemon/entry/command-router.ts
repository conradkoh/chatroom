import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  handleContextReadRoute,
  type ContextRouteDeps,
} from '../infrastructure/inbound/local/routes/context.route.js';
import {
  handleHandoffRoute,
  type HandoffRouteDeps,
} from '../infrastructure/inbound/local/routes/handoff.route.js';
import {
  handleMessagesListSinceRoute,
  handleMessagesListBySenderRoute,
  type MessagesRouteDeps,
} from '../infrastructure/inbound/local/routes/messages.route.js';
import {
  handleTaskReadRoute,
  type TaskReadRouteDeps,
} from '../infrastructure/inbound/local/routes/task-read.route.js';
import {
  handleTasksClaimNextRoute,
  type TasksRouteDeps,
} from '../infrastructure/inbound/local/routes/tasks.route.js';

export type CommandRouterDeps = HandoffRouteDeps &
  TasksRouteDeps &
  MessagesRouteDeps &
  ContextRouteDeps &
  TaskReadRouteDeps;

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

  if (method === 'POST' && path === '/tasks/claim-next') {
    await handleTasksClaimNextRoute(req, res, deps);
    return;
  }

  if (method === 'GET' && path === '/messages/list-since') {
    await handleMessagesListSinceRoute(req, res, deps);
    return;
  }

  if (method === 'GET' && path === '/messages/list-by-sender') {
    await handleMessagesListBySenderRoute(req, res, deps);
    return;
  }

  if (method === 'GET' && path === '/context/read') {
    await handleContextReadRoute(req, res, deps);
    return;
  }

  if (method === 'POST' && path === '/tasks/read') {
    await handleTaskReadRoute(req, res, deps);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: `No route for ${method} ${path}` }));
}
