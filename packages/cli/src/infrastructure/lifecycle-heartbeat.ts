/**
 * Fire-and-forget lifecycle heartbeat for CLI commands.
 *
 * Fired centrally from the Commander `preAction` hook in index.ts before every
 * chatroom-aware command (any command that has both --chatroom-id and --role).
 * This refreshes the agent's lastSeenAt on the participant row and keeps custom
 * agents (without a daemon heartbeat loop) visible while working. It also gives
 * `messages list` and `backlog` commands automatic heartbeat coverage.
 */

import type { Id } from '../api.js';
import { api } from '../api.js';
import { withRetry } from './retry-queue.js';

export function sendLifecycleHeartbeat(
  client: { mutation: (fn: any, args: any) => Promise<any> },
  opts: { sessionId: string; chatroomId: string; role: string; action?: string }
): void {
  // Update lastSeenAt (and optionally lastSeenAction) on the participant row.
  withRetry(() =>
    client.mutation(api.participants.join, {
      sessionId: opts.sessionId,
      chatroomId: opts.chatroomId as Id<'chatroom_rooms'>,
      role: opts.role,
      ...(opts.action !== undefined ? { action: opts.action } : {}),
    })
  ).catch(() => {});
}
