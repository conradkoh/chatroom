import { Effect } from 'effect';

import type { Id } from '../../../api.js';
import { formatTimestamp } from '../../../commands/machine/daemon-start/utils.js';

export interface AgentStartedPayload {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  pid: number;
  harness: string;
  model?: string;
}

/**
 * Core — logs agent start. No service deps.
 */
export function onAgentStartedCore(payload: AgentStartedPayload): void {
  const ts = formatTimestamp();
  console.log(
    `[${ts}] 🟢 Agent started: ${payload.role} (PID: ${payload.pid}, harness: ${payload.harness})`
  );
}

/** Effect twin — pure, no service deps. */
// fallow-ignore-next-line unused-export
export const onAgentStartedEffect = (payload: AgentStartedPayload): Effect.Effect<void> =>
  Effect.sync(() => onAgentStartedCore(payload));
