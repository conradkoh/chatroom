// fallow-ignore-file coverage-gaps
import type { IncomingMessage, ServerResponse } from 'node:http';

import { readQueryParams, sendJson } from './http-utils.js';
import { createChatroomHostedGuard } from './orchestration-host-guard.js';
import { api } from '../../../../../api.js';

export type MessagesRouteDeps = {
  sessionId: string;
  machineId: string;
  query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

/** P8: reject when this daemon does not host the chatroom's orchestration. */
async function isChatroomHosted(
  deps: MessagesRouteDeps,
  chatroomId: string,
  res: ServerResponse
): Promise<boolean> {
  const isHosted = createChatroomHostedGuard({
    machineId: deps.machineId,
    sessionId: deps.sessionId,
    query: deps.query,
  });
  return isHosted(chatroomId, res);
}

/**
 * GET /messages/list-since — messages since a given message id (P6).
 * Transitional: messages are not yet in the daemon read models, so the route
 * proxies the Convex read; the CLI still gets a single daemon HTTP hop.
 */
export async function handleMessagesListSinceRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: MessagesRouteDeps
): Promise<void> {
  const params = readQueryParams(req);
  const chatroomId = params.get('chatroomId');
  const sinceMessageId = params.get('sinceMessageId');
  const role = params.get('role');
  const limit = Number(params.get('limit') ?? 100);

  if (!chatroomId || !sinceMessageId || !role) {
    sendJson(res, 400, {
      error: {
        code: 'BAD_REQUEST',
        message: 'Missing query params: chatroomId, sinceMessageId, role',
      },
    });
    return;
  }

  if (!(await isChatroomHosted(deps, chatroomId, res))) return;

  try {
    const messages = await deps.query(api.messages.listSinceMessage, {
      sessionId: deps.sessionId,
      chatroomId,
      sinceMessageId,
      limit,
    });
    sendJson(res, 200, messages);
  } catch (err) {
    sendJson(res, 500, { error: { code: 'QUERY_FAILED', message: (err as Error).message } });
  }
}

/**
 * GET /messages/list-by-sender — messages from a given sender role (P6).
 */
export async function handleMessagesListBySenderRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: MessagesRouteDeps
): Promise<void> {
  const params = readQueryParams(req);
  const chatroomId = params.get('chatroomId');
  const role = params.get('role');
  const senderRole = params.get('senderRole');
  const limit = Number(params.get('limit') ?? 10);

  if (!chatroomId || !role || !senderRole) {
    sendJson(res, 400, {
      error: {
        code: 'BAD_REQUEST',
        message: 'Missing query params: chatroomId, role, senderRole',
      },
    });
    return;
  }

  if (!(await isChatroomHosted(deps, chatroomId, res))) return;

  try {
    const messages = await deps.query(api.messages.listBySenderRole, {
      sessionId: deps.sessionId,
      chatroomId,
      senderRole,
      limit,
    });
    sendJson(res, 200, messages);
  } catch (err) {
    sendJson(res, 500, { error: { code: 'QUERY_FAILED', message: (err as Error).message } });
  }
}
