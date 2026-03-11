/**
 * Use Case: Try Start Agent for Task
 *
 * Best-effort one-time trigger to start an agent when a pending task is
 * created and no agent process is running for the assigned role.
 *
 * Two cases are handled:
 * 1. Config exists (chatroom_teamAgentConfigs) but PID is null:
 *    Emit agent.requestStart if desiredState is 'running'.
 * 2. No config exists:
 *    Fall back to chatroom_agentPreferences (user's last-used config).
 *    If a preference exists with complete data and the machine daemon is connected,
 *    create the config record and emit agent.requestStart.
 *
 * This does NOT replace the ensureAgentHandler fallback — it runs in addition
 * to provide immediate agent activation without waiting for the scheduled delay.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { AgentHarness, AgentType } from '../../entities/agent';
import { AGENT_REQUEST_DEADLINE_MS } from '../../../../config/reliability';
import { buildTeamRoleKey, deleteStaleTeamAgentConfigs } from '../../../../convex/utils/teamRoleKey';

export interface TryStartAgentForTaskInput {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
}

/**
 * Attempts to start the agent for a role if it is not currently running.
 * Returns true if an agent.requestStart event was emitted, false otherwise.
 */
export async function tryStartAgentForTask(
  ctx: MutationCtx,
  input: TryStartAgentForTaskInput
): Promise<boolean> {
  const { chatroomId, role } = input;
  const roleLower = role.toLowerCase();
  const now = Date.now();

  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!chatroom?.teamId) return false;

  const teamRoleKey = buildTeamRoleKey(chatroomId, chatroom.teamId, role);
  const config = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .first();

  if (config) {
    return await tryStartFromConfig(ctx, config, chatroomId, now);
  }

  return await tryStartFromPreference(ctx, chatroom, chatroomId, roleLower, teamRoleKey, now);
}

async function tryStartFromConfig(
  ctx: MutationCtx,
  config: {
    type: string;
    spawnedAgentPid?: number;
    desiredState?: string;
    machineId?: string;
    agentHarness?: string;
    model?: string;
    workingDir?: string;
    role: string;
  },
  chatroomId: Id<'chatroom_rooms'>,
  now: number
): Promise<boolean> {
  if (config.type !== 'remote') return false;
  if (config.spawnedAgentPid != null) return false;
  if (config.desiredState !== 'running') return false;
  if (!config.machineId || !config.agentHarness || !config.model || !config.workingDir) {
    return false;
  }

  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', config.machineId!))
    .first();

  if (!machine?.daemonConnected) return false;

  await ctx.db.insert('chatroom_eventStream', {
    type: 'agent.requestStart',
    chatroomId,
    machineId: config.machineId!,
    role: config.role,
    agentHarness: config.agentHarness! as AgentHarness,
    model: config.model!,
    workingDir: config.workingDir!,
    reason: 'platform.task_activated',
    deadline: now + AGENT_REQUEST_DEADLINE_MS,
    timestamp: now,
  });

  return true;
}

async function tryStartFromPreference(
  ctx: MutationCtx,
  chatroom: { ownerId: Id<'users'>; teamId?: string },
  chatroomId: Id<'chatroom_rooms'>,
  roleLower: string,
  teamRoleKey: string,
  now: number
): Promise<boolean> {
  const pref = await ctx.db
    .query('chatroom_agentPreferences')
    .withIndex('by_userId_chatroom_role', (q) =>
      q.eq('userId', chatroom.ownerId).eq('chatroomId', chatroomId).eq('role', roleLower)
    )
    .first();

  if (!pref?.machineId || !pref.agentHarness || !pref.model || !pref.workingDir) {
    return false;
  }

  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', pref.machineId))
    .first();

  if (!machine?.daemonConnected) return false;

  if (!machine.availableHarnesses.includes(pref.agentHarness)) return false;

  await deleteStaleTeamAgentConfigs(ctx, teamRoleKey);
  await ctx.db.insert('chatroom_teamAgentConfigs', {
    teamRoleKey,
    chatroomId,
    role: roleLower,
    type: 'remote' as AgentType,
    machineId: pref.machineId,
    agentHarness: pref.agentHarness,
    model: pref.model,
    workingDir: pref.workingDir,
    desiredState: 'running',
    circuitState: 'closed',
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.insert('chatroom_eventStream', {
    type: 'agent.requestStart',
    chatroomId,
    machineId: pref.machineId,
    role: roleLower,
    agentHarness: pref.agentHarness,
    model: pref.model,
    workingDir: pref.workingDir,
    reason: 'platform.task_activated',
    deadline: now + AGENT_REQUEST_DEADLINE_MS,
    timestamp: now,
  });

  return true;
}
