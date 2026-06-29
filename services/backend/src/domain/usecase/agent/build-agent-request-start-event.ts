/**
 * Single source of truth for the shape of an `agent.requestStart` event.
 *
 * The start-agent use case emits this event when a user or platform requests
 * an agent start. Routing through this constructor keeps the field set
 * consistent and makes omissions a compile error for required fields like
 * `wantResume`.
 */

import { AGENT_REQUEST_DEADLINE_MS } from '../../../../config/reliability';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { AgentHarness } from '../../entities/agent';

/** Fully-resolved inputs for an `agent.requestStart` event. */
export interface AgentRequestStartEventInput {
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
  reason: string;
  /** Resolved resume preference (default already applied by the caller). */
  wantResume: boolean;
}

/**
 * The exact document inserted into `chatroom_eventStream` for a start request.
 * Computes the deadline from {@link AGENT_REQUEST_DEADLINE_MS} so callers cannot
 * forget it or use an inconsistent window.
 */
export function buildAgentRequestStartEvent(input: AgentRequestStartEventInput, now: number) {
  return {
    type: 'agent.requestStart' as const,
    chatroomId: input.chatroomId,
    machineId: input.machineId,
    role: input.role,
    agentHarness: input.agentHarness,
    model: input.model,
    workingDir: input.workingDir,
    reason: input.reason,
    deadline: now + AGENT_REQUEST_DEADLINE_MS,
    timestamp: now,
    wantResume: input.wantResume,
  };
}
