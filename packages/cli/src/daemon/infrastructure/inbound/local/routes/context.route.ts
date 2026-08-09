// fallow-ignore-file coverage-gaps
import type { IncomingMessage, ServerResponse } from 'node:http';

import { sendJson } from './http-utils.js';
import { api } from '../../../../../api.js';

export type ContextRouteDeps = {
  sessionId: string;
  query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

/**
 * GET /context/read — conversation history + task status for a role (P6).
 * Transitional: context messages are proxied from Convex until the daemon
 * maintains a message cache.
 */
export async function handleContextReadRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ContextRouteDeps
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const chatroomId = url.searchParams.get('chatroomId');
  const role = url.searchParams.get('role');

  if (!chatroomId || !role) {
    sendJson(res, 400, {
      error: { code: 'BAD_REQUEST', message: 'Missing query params: chatroomId, role' },
    });
    return;
  }

  try {
    const context = await deps.query(api.messages.getContextForRole, {
      sessionId: deps.sessionId,
      chatroomId,
      role,
    });
    sendJson(res, 200, context);
  } catch (err) {
    sendJson(res, 500, { error: { code: 'QUERY_FAILED', message: (err as Error).message } });
  }
}
