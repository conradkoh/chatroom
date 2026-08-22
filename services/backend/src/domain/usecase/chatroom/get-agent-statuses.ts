import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import type { AgentType } from '../../entities/agent';
import { getAgentViewStatus } from './get-agent-view-status';

export interface AgentRoleView { role: string; state: 'running' | 'stopped' | 'starting' | 'circuit_open'; type: AgentType; machineId?: string; machineName?: string; /** @deprecated configs are loaded through getMachineAgentConfigs. */ agentHarness?: string; model?: string; workingDir?: string; wantResume?: boolean; }
export interface ChatroomAgentStatus { teamRoles: string[]; agents: AgentRoleView[]; teamId?: string; }
export interface GetAgentStatusInput { chatroomId: Id<'chatroom_rooms'>; userId: Id<'users'>; }

/** Backward-compatible thin wrapper over the projection-based hot path. */
export async function getAgentStatusForChatroom(ctx: QueryCtx, input: GetAgentStatusInput): Promise<ChatroomAgentStatus | null> {
  const view = await getAgentViewStatus(ctx, input);
  if (!view) return null;
  return { teamRoles: view.teamRoles, teamId: view.teamId, agents: view.agents.map(({ role, state, type, machineId, machineName }) => ({ role, state, type, machineId, machineName })) };
}
