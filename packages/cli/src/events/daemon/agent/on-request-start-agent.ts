/**
 * Handles an agent.requestStart event from chatroom_eventStream.
 * Delegates all policy checks and spawning to SpawnGateService.
 */

import type { Id } from '../../../api.js';
import type {
  DaemonContext,
  StartAgentReason,
} from '../../../commands/machine/daemon-start/types.js';

export interface AgentRequestStartEventPayload {
  _id: Id<'chatroom_eventStream'>;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  agentHarness: 'opencode' | 'pi' | 'cursor';
  model: string;
  workingDir: string;
  reason: string;
  deadline: number;
}

export async function onRequestStartAgent(
  ctx: DaemonContext,
  event: AgentRequestStartEventPayload
): Promise<void> {
  const eventId = event._id.toString();

  console.log(`[daemon] Processing agent.requestStart (id: ${eventId})`);

  const result = await ctx.deps.spawnGate.requestSpawn(ctx, {
    chatroomId: event.chatroomId,
    role: event.role,
    agentHarness: event.agentHarness,
    model: event.model,
    workingDir: event.workingDir,
    reason: event.reason as StartAgentReason,
    deadline: event.deadline,
  });

  if (!result.spawned) {
    console.log(`[daemon] Spawn rejected for role=${event.role}: ${result.reason}`);
  }
}
