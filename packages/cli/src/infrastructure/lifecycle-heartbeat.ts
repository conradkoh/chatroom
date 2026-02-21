/**
 * Fire-and-forget lifecycle heartbeat for CLI commands.
 *
 * Called by task-started, handoff, report-progress, task-complete, and context
 * commands to refresh the agent's heartbeatAt in the lifecycle table. This
 * keeps custom agents (without a daemon heartbeat loop) alive while working.
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
}
