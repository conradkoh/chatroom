/**
 * Use Case: Emit Request Start If Needed
 *
 * Unified helper to emit an agent.requestStart event when a role needs an
 * agent running. Replaces the earlier try-start-agent-for-task with
 * additional support for circuit breaker checks and preference-based
 * config creation.
 *
 * Two paths:
 * 1. Config exists → validate state, optionally check circuit breaker,
 *    emit requestStart if all checks pass.
 * 2. No config + createFromPreferences → create config from user's
 *    agentPreferences, emit requestStart.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { AgentHarness, AgentStartReason, AgentType } from '../../entities/agent';
import { AGENT_REQUEST_DEADLINE_MS } from '../../../../config/reliability';
import { buildTeamRoleKey, deleteStaleTeamAgentConfigs } from '../../../../convex/utils/teamRoleKey';
import { checkCircuitBreaker } from './check-circuit-breaker';

export interface EmitRequestStartOptions {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  reason: AgentStartReason;
  /** Skip circuit breaker check (default: false) */
  skipCircuitBreaker?: boolean;
  /** Create config from agentPreferences if none exists (default: false) */
  createFromPreferences?: boolean;
}

export async function emitRequestStartIfNeeded(
  ctx: MutationCtx,
  opts: EmitRequestStartOptions
): Promise<boolean> {
  const { chatroomId, role, reason } = opts;
  const roleLower = role.toLowerCase();
  const now = Date.now();

  const chatroom = await ctx.db.get(chatroomId);
  if (!chatroom?.teamId) return false;

  const teamRoleKey = buildTeamRoleKey(chatroomId, chatroom.teamId, role);
  const config = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .first();

  if (config) {
    return await emitFromConfig(ctx, config, chatroomId, reason, opts.skipCircuitBreaker, now);
  }

  if (opts.createFromPreferences) {
    return await emitFromPreference(ctx, chatroom, chatroomId, roleLower, teamRoleKey, reason, now);
  }

  return false;
}

async function emitFromConfig(
  ctx: MutationCtx,
  config: {
    _id: Id<'chatroom_teamAgentConfigs'>;
    type: string;
    spawnedAgentPid?: number;
    desiredState?: string;
    machineId?: string;
    agentHarness?: string;
    model?: string;
    workingDir?: string;
    role: string;
    circuitState?: string;
    circuitOpenedAt?: number;
  },
  chatroomId: Id<'chatroom_rooms'>,
  reason: AgentStartReason,
  skipCircuitBreaker: boolean | undefined,
  now: number
): Promise<boolean> {
  if (config.type !== 'remote') return false;
  if (config.spawnedAgentPid != null) return false;
  if (config.desiredState !== 'running') return false;

  if (skipCircuitBreaker !== true) {
    const status = await checkCircuitBreaker(ctx, chatroomId, config);
    if (status === 'open') return false;
  }

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
    reason,
    deadline: now + AGENT_REQUEST_DEADLINE_MS,
    timestamp: now,
  });

  return true;
}

async function emitFromPreference(
  ctx: MutationCtx,
  chatroom: { ownerId: Id<'users'>; teamId?: string },
  chatroomId: Id<'chatroom_rooms'>,
  roleLower: string,
  teamRoleKey: string,
  reason: AgentStartReason,
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
    reason,
    deadline: now + AGENT_REQUEST_DEADLINE_MS,
    timestamp: now,
  });

  return true;
}
