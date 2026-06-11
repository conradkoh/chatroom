import { Effect } from 'effect';

import type { Id } from '../../../api.js';
import { formatTimestamp } from '../../../commands/machine/daemon-start/utils.js';

export interface AgentStoppedPayload {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  pid: number;
}

/**
 * Core — logs agent stop. No service deps.
 */
export function onAgentStoppedCore(payload: AgentStoppedPayload): void {
  const ts = formatTimestamp();
  console.log(`[${ts}] 🔴 Agent stopped: ${payload.role} (PID: ${payload.pid})`);
}

/** Effect twin — pure, no service deps. */
// fallow-ignore-next-line unused-export
export const onAgentStoppedEffect = (payload: AgentStoppedPayload): Effect.Effect<void> =>
  Effect.sync(() => onAgentStoppedCore(payload));
