/**
 * Use Case: Stop Agent
 *
 * Thin wrapper around `requestAgentStop` for callers that still import
 * `stopAgent` (e.g. `machines.sendCommand` stop-agent, integration tests).
 */

import { requestAgentStop } from './request-agent-stop';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { AgentStopReason } from '../../entities/agent';

export interface StopAgentInput {
  machineId: string;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  userId: Id<'users'>;
  reason: AgentStopReason;
}

export interface StopAgentResult {}

export async function stopAgent(ctx: MutationCtx, input: StopAgentInput): Promise<StopAgentResult> {
  const { machineId, chatroomId, role, reason } = input;
  await requestAgentStop(ctx, { machineId, chatroomId, role, reason });
  return {};
}
