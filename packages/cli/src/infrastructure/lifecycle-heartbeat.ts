/**
 * Fire-and-forget lifecycle heartbeat for CLI commands.
 *
 * Called by task-started, handoff, report-progress, task-complete, and context
 * commands to refresh the agent's lastSeenAt on the participant row. This keeps
 * custom agents (without a daemon heartbeat loop) visible while working.
 *
 * FSM heartbeat writes (machineAgentLifecycle.heartbeat) are intentionally
 * omitted here — Phase 4 of the FSM → lastSeenAt migration. The daemon's
 * wait-for-task loop still writes FSM heartbeats separately.
 */

import { api } from '../api.js';
import type { Id } from '../api.js';
import { withRetry } from './retry-queue.js';

export function sendLifecycleHeartbeat(
  client: { mutation: (fn: any, args: any) => Promise<any> },
  opts: { sessionId: string; chatroomId: string; role: string }
): void {
  // Only update lastSeenAt on the participant row — FSM writes stopped (Phase 4).
  withRetry(() =>
    client.mutation(api.participants.heartbeat, {
      sessionId: opts.sessionId,
      chatroomId: opts.chatroomId as Id<'chatroom_rooms'>,
      role: opts.role,
    })
  ).catch(() => {});
}
