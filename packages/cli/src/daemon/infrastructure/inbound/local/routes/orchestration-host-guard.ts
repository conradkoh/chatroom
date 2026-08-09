import type { ServerResponse } from 'node:http';

import { sendJson } from './http-utils.js';
import type { OrchestrationHost } from '../../../../domain/value-objects/orchestration-host.js';
import { fetchChatroomOrchestrationHost } from '../../../convex/adapters/handoff-chatroom-adapter.js';
import { isDaemonOrchestrationP8Enabled } from '../../../projection/feature-flags.js';

export type OrchestrationHostGuardDeps = {
  machineId: string;
  /** Resolve the chatroom's P8 orchestration host (null when unbound). */
  queryChatroomOrchestrationHost: (chatroomId: string) => Promise<OrchestrationHost | null>;
};

/**
 * P8: reject orchestration HTTP commands for chatrooms hosted on a different
 * machine. Flag-off returns true immediately (unchanged behavior).
 *
 * Returns true when the request should proceed; false when a 403 response has
 * already been written.
 */
// fallow-ignore-next-line unused-export complexity
export async function assertChatroomHostedLocally(
  deps: OrchestrationHostGuardDeps,
  chatroomId: string,
  res: ServerResponse
): Promise<boolean> {
  if (!isDaemonOrchestrationP8Enabled()) return true;

  const host = await deps.queryChatroomOrchestrationHost(chatroomId);
  if (!host) return true; // not yet bound — allow (backfill pending)

  if (host.machineId !== deps.machineId) {
    sendJson(res, 403, {
      success: false,
      error: {
        code: 'chatroom_not_hosted',
        message: 'This chatroom is hosted on a different machine',
      },
    });
    return false;
  }
  return true;
}

/** Convenience factory for route handlers — resolves the chatroom host via the Convex chatrooms query. */
export function createChatroomHostedGuard(deps: {
  machineId: string;
  sessionId: string;
  query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
}): (chatroomId: string, res: ServerResponse) => Promise<boolean> {
  const adapterDeps = { query: deps.query, sessionId: deps.sessionId };
  return (chatroomId, res) =>
    assertChatroomHostedLocally(
      {
        machineId: deps.machineId,
        queryChatroomOrchestrationHost: (chatroomIdArg) =>
          fetchChatroomOrchestrationHost(adapterDeps, chatroomIdArg),
      },
      chatroomId,
      res
    );
}
