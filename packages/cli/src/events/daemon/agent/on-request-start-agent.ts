/**
 * Handles an agent.requestStart event from chatroom_eventStream.
 * Checks deadline before executing — expired requests are skipped.
 * Calls executeStartAgent directly — no synthetic command ID needed.
 */

import type { Id } from '../../../api.js';
import type {
  AgentHarness,
  DaemonContext,
  StartAgentReason,
} from '../../../commands/machine/daemon-start/types.js';
import { executeStartAgent } from '../../../commands/machine/daemon-start/handlers/start-agent.js';

export interface AgentRequestStartEventPayload {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
  reason: string;
  deadline: number;
}

export async function onRequestStartAgent(
  ctx: DaemonContext,
  event: AgentRequestStartEventPayload
): Promise<void> {
  if (Date.now() > event.deadline) {
    console.log(
      `[daemon] ⏰ Skipping expired agent.requestStart for role=${event.role} (deadline passed)`
    );
    return;
  }

  // Gate the spawn through the HarnessSpawningService rate limiter
  const spawnCheck = ctx.deps.spawning.shouldAllowSpawn(event.chatroomId, event.reason);
  if (!spawnCheck.allowed) {
    const retryMsg = spawnCheck.retryAfterMs ? ` Retry after ${spawnCheck.retryAfterMs}ms.` : '';
    console.warn(
      `[daemon] ⚠️  Spawn suppressed for chatroom=${event.chatroomId} role=${event.role} reason=${event.reason}.${retryMsg}`
    );
    return;
  }

  await executeStartAgent(ctx, {
    chatroomId: event.chatroomId,
    role: event.role,
    agentHarness: event.agentHarness,
    model: event.model,
    workingDir: event.workingDir,
    reason: event.reason as StartAgentReason,
  });
}
