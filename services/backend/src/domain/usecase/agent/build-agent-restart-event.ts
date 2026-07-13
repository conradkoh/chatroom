/**
 * Single source of truth for the shape of an `agent.restart` event.
 */

import { AGENT_REQUEST_DEADLINE_MS } from '../../../../config/reliability';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { AgentHarness } from '../../entities/agent';

export interface AgentRestartEventInput {
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
  correlationId: string;
  wantResume: boolean;
}

export function buildAgentRestartEvent(input: AgentRestartEventInput, now: number) {
  return {
    type: 'agent.restart' as const,
    chatroomId: input.chatroomId,
    machineId: input.machineId,
    role: input.role,
    agentHarness: input.agentHarness,
    model: input.model,
    workingDir: input.workingDir,
    correlationId: input.correlationId,
    wantResume: input.wantResume,
    deadline: now + AGENT_REQUEST_DEADLINE_MS,
    timestamp: now,
  };
}

export type AgentRestartPhase =
  | 'reset'
  | 'spawn'
  | 'await_session'
  | 'ready'
  | 'deliver'
  | 'completed'
  | 'failed';

export function buildAgentRestartPhaseEvent(
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    machineId: string;
    role: string;
    correlationId: string;
    phase: AgentRestartPhase;
    detail?: string;
  },
  now: number
) {
  return {
    type: 'agent.restartPhase' as const,
    chatroomId: input.chatroomId,
    machineId: input.machineId,
    role: input.role,
    correlationId: input.correlationId,
    phase: input.phase,
    detail: input.detail,
    timestamp: now,
  };
}

export function buildAgentRestartCompletedEvent(
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    machineId: string;
    role: string;
    correlationId: string;
    deliveredTaskIds?: string[];
  },
  now: number
) {
  return {
    type: 'agent.restartCompleted' as const,
    chatroomId: input.chatroomId,
    machineId: input.machineId,
    role: input.role,
    correlationId: input.correlationId,
    deliveredTaskIds: input.deliveredTaskIds,
    timestamp: now,
  };
}
