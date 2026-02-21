/**
 * Fire-and-forget lifecycle heartbeat for CLI commands.
 *
 * Called by task-started, handoff, report-progress, task-complete, and context
 * commands to refresh the agent's heartbeatAt in the lifecycle table. This
 * keeps custom agents (without a daemon heartbeat loop) alive while working.
 *
 * Also writes lastSeenAt on the participant row (Phase 1 of FSM migration).
 */

import { api } from '../api.js';
import type { Id } from '../api.js';
import { withRetry } from './retry-queue.js';

export function sendLifecycleHeartbeat(
  client: { mutation: (fn: any, args: any) => Promise<any> },
  opts: { sessionId: string; chatroomId: string; role: string }
): void {
  withRetry(() =>
    client.mutation(api.machineAgentLifecycle.heartbeat, {
      sessionId: opts.sessionId,
      chatroomId: opts.chatroomId as Id<'chatroom_rooms'>,
      role: opts.role,
    })
  ).catch(() => {});

  // Also update lastSeenAt on the participant row.
  // No connectionId — callers of this helper are mid-task commands (not wait-for-task),
  // so the connectionId guard in participants.heartbeat is intentionally skipped.
  withRetry(() =>
    client.mutation(api.participants.heartbeat, {
      sessionId: opts.sessionId,
      chatroomId: opts.chatroomId as Id<'chatroom_rooms'>,
      role: opts.role,
    })
  ).catch(() => {});
}
