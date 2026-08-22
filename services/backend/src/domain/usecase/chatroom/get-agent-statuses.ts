import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import type { AgentType } from '../../entities/agent';
import { getAgentViewStatus } from './get-agent-view-status';
import { filterTeamAgentConfigsForTeam } from '../../../../convex/utils/teamRoleKey';

export interface AgentRoleView { role: string; state: 'running' | 'stopped' | 'starting' | 'circuit_open'; type: AgentType; machineId?: string; machineName?: string; /** @deprecated configs are loaded through getMachineAgentConfigs. */ agentHarness?: string; model?: string; workingDir?: string; spawnedAt?: number; wantResume?: boolean; }
export interface ChatroomAgentStatus { teamRoles: string[]; agents: AgentRoleView[]; teamId?: string; }
export interface GetAgentStatusInput { chatroomId: Id<'chatroom_rooms'>; userId: Id<'users'>; }

/** Backward-compatible thin wrapper over the projection-based hot path. */
export async function getAgentStatusForChatroom(ctx: QueryCtx, input: GetAgentStatusInput): Promise<ChatroomAgentStatus | null> {
  const view = await getAgentViewStatus(ctx, input);
  if (!view) return null;
  const chatroom = await ctx.db.get('chatroom_rooms', input.chatroomId);
  const configs = chatroom?.teamId ? filterTeamAgentConfigsForTeam(await ctx.db.query('chatroom_teamAgentConfigs').withIndex('by_chatroom', (q) => q.eq('chatroomId', input.chatroomId)).collect(), input.chatroomId, chatroom.teamId) : [];
  const byRole = new Map(configs.map((c) => [c.role.toLowerCase(), c]));
  const names = await ctx.db.query('chatroom_machines').withIndex('by_userId', (q) => q.eq('userId', input.userId)).collect();
  const nameById = new Map(names.map((m) => [m.machineId, m.hostname]));
  return { teamRoles: view.teamRoles, teamId: view.teamId, agents: view.agents.map((agent) => {
    const c = byRole.get(agent.role.toLowerCase());
    const state = agent.state === 'stopped' && c?.desiredState === 'running' && c.spawnedAgentPid == null && agent.lastStatus && ['agent.requestStart', 'agent.restart', 'agent.restartPhase'].includes(agent.lastStatus) ? 'starting' as const : agent.state;
    return { role: agent.role, state, type: agent.type, machineId: agent.machineId, machineName: agent.machineName ?? (c?.machineId ? nameById.get(c.machineId) : undefined), agentHarness: c?.agentHarness, model: c?.model, workingDir: c?.workingDir, spawnedAt: c?.spawnedAt, wantResume: c?.wantResume };
  }) };
}
