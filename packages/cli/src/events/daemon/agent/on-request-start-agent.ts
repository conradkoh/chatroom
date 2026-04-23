/**
 * Handles an agent.requestStart event from chatroom_eventStream.
 * Delegates to AgentProcessManager for lifecycle management.
 * Deadline check is kept at the caller level (transport concern).
 */

import { api } from '../../../api.js';
import type { Id } from '../../../api.js';
import type {
  AgentHarness,
  DaemonContext,
  StartAgentReason,
} from '../../../commands/machine/daemon-start/types.js';

export interface AgentRequestStartEventPayload {
  _id: Id<'chatroom_eventStream'>;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
  opencodeAgentName?: string;
  reason: string;
  deadline: number;
}

export async function onRequestStartAgent(
  ctx: DaemonContext,
  event: AgentRequestStartEventPayload
): Promise<void> {
  const eventId = event._id.toString();

  // Deadline check — transport-level concern, not lifecycle
  if (Date.now() > event.deadline) {
    console.log(
      `[daemon] ⏰ Skipping expired agent.requestStart for role=${event.role} (id: ${eventId}, deadline passed)`
    );
    return;
  }

  console.log(`[daemon] Processing agent.requestStart (id: ${eventId})`);

  const result = await ctx.deps.agentProcessManager.ensureRunning({
    chatroomId: event.chatroomId,
    role: event.role,
    agentHarness: event.agentHarness,
    model: event.model,
    workingDir: event.workingDir,
    agentName: event.opencodeAgentName,
    reason: event.reason as StartAgentReason,
  });

  if (!result.success) {
    console.log(
      `[daemon] Agent start rejected for role=${event.role}: ${result.error ?? 'unknown'}`
    );

    // Notify the backend so participant status and desiredState are updated.
    // Without this, the agent stays stuck in "STARTING" state in the UI.
    ctx.deps.backend
      .mutation(api.machines.emitAgentStartFailed, {
        sessionId: ctx.sessionId,
        machineId: ctx.machineId,
        chatroomId: event.chatroomId,
        role: event.role,
        error: result.error ?? 'unknown',
      })
      .catch((err: Error) => {
        console.log(`   ⚠️  Failed to emit startFailed event: ${err.message}`);
      });
  } else {
    // Register workspace (fire-and-forget — don't block agent start)
    ctx.deps.backend
      .mutation(api.workspaces.registerWorkspace, {
        sessionId: ctx.sessionId,
        chatroomId: event.chatroomId,
        machineId: ctx.machineId,
        workingDir: event.workingDir,
        hostname: ctx.config?.hostname ?? 'unknown',
        registeredBy: event.role,
      })
      .catch((err: Error) => {
        console.warn(`[daemon] ⚠️ Failed to register workspace: ${err.message}`);
      });
  }
}
