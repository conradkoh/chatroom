/**
 * Handles a command.startAgent event from chatroom_eventStream.
 * Calls executeStartAgent directly — no synthetic command ID needed.
 */

import type { Id } from '../../../api.js';
import type {
  DaemonContext,
  StartAgentReason,
} from '../../../commands/machine/daemon-start/types.js';
import { executeStartAgent } from '../../../commands/machine/daemon-start/handlers/start-agent.js';

export interface CommandStartAgentEventPayload {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  agentHarness: 'opencode' | 'pi';
  model: string;
  workingDir: string;
  reason: string;
}

export async function onCommandStartAgent(
  ctx: DaemonContext,
  event: CommandStartAgentEventPayload
): Promise<void> {
  await executeStartAgent(ctx, {
    chatroomId: event.chatroomId,
    role: event.role,
    agentHarness: event.agentHarness,
    model: event.model,
    workingDir: event.workingDir,
    reason: event.reason as StartAgentReason,
  });
}
