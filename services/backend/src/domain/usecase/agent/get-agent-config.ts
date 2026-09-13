/**
 * Resolve the latest submitted launch request for a chatroom role.
 *
 * This reader intentionally does not expose backend-owned desired state or
 * process state. The daemon is authoritative for runtime; the role-status
 * projection is the only backend presentation of that runtime.
 */

import { getLastSentLaunchRequestForRole } from './get-last-sent-launch-request';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import type { AgentHarness, AgentType, ModelSource } from '../../entities/agent';

export interface GetAgentConfigInput {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
}

export interface ResolvedAgentConfig {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  type: AgentType;
  machineId: string | undefined;
  agentHarness: AgentHarness | undefined;
  workingDir: string | undefined;
  model: string | undefined;
  modelSource: ModelSource;
  /** Runtime fields are retained temporarily for compatibility and stay empty. */
  spawnedAgentPid: number | undefined;
  spawnedAt: number | undefined;
  desiredState: 'running' | 'stopped' | undefined;
  circuitState: 'closed' | 'open' | 'half-open' | undefined;
  wantResume: boolean | undefined;
  hasSystemPromptControl: boolean;
}

export type GetAgentConfigResult = { found: true; config: ResolvedAgentConfig } | { found: false };

export async function getAgentConfig(
  ctx: QueryCtx | MutationCtx,
  input: GetAgentConfigInput
): Promise<GetAgentConfigResult> {
  const chatroom = await ctx.db.get('chatroom_rooms', input.chatroomId);
  if (!chatroom) return { found: false };

  const launchRequest = await getLastSentLaunchRequestForRole(ctx, {
    chatroomId: input.chatroomId,
    role: input.role,
  });
  if (!launchRequest) return { found: false };

  return {
    found: true,
    config: {
      chatroomId: input.chatroomId,
      role: launchRequest.role,
      type: launchRequest.agentType,
      machineId: launchRequest.machineId,
      agentHarness: launchRequest.agentHarness,
      workingDir: launchRequest.workingDir,
      model: launchRequest.model,
      modelSource: 'team_config',
      spawnedAgentPid: undefined,
      spawnedAt: undefined,
      desiredState: undefined,
      circuitState: undefined,
      wantResume: launchRequest.wantResume,
      hasSystemPromptControl: launchRequest.agentType === 'remote',
    },
  };
}
