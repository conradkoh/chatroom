/**
 * Fire-and-forget lifecycle heartbeat for CLI commands.
 *
 * Fired centrally from the Commander `preAction` hook in index.ts before every
 * chatroom-aware command (any command that has both --chatroom-id and --role).
 * This refreshes the agent's lastSeenAt on the participant row (no action) and keeps custom
 * agents (without a daemon heartbeat loop) visible while working. It also gives
 * `messages list` and `backlog` commands automatic heartbeat coverage.
 */

import type { ConvexHttpClient } from 'convex/browser';

import type { Id } from '../api.js';
import { api } from '../api.js';
import { withRetry } from './retry-queue.js';
import { isDaemonWorkerRole } from '../daemon/domain/entities/execution-kind.js';

export function sendLifecycleHeartbeat(
  client: Pick<ConvexHttpClient, 'mutation'>,
  opts: { sessionId: string; chatroomId: string; role: string; action?: string | undefined }
): void {
  // Enhancer presence is registered by the backend when its job is claimed;
  // it does not use the long-lived CLI heartbeat path.
  if (isDaemonWorkerRole(opts.role)) return;
  // Update lastSeenAt (and optionally lastSeenAction) on the participant row.
  withRetry(() =>
    client.mutation(api.participants.join, {
      sessionId: opts.sessionId as never,
      chatroomId: opts.chatroomId as Id<'chatroom_rooms'>,
      role: opts.role,
      ...(opts.action !== undefined ? { action: opts.action } : {}),
    })
  ).catch(() => {});
}
