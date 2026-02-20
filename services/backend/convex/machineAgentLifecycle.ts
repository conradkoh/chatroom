/**
 * Machine Agent Lifecycle — mutations and queries for the agent state machine.
 *
 * This is the single source of truth for agent status. The `state` field
 * is the display status — no computation or priority resolution needed.
 *
 * All state transitions are validated against the VALID_TRANSITIONS map
 * defined in the domain layer.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { HEARTBEAT_TTL_MS } from '../config/reliability';
import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';
import { validateSession } from './auth/cliSessionAuth';
import {
  LIFECYCLE_STATES,
  validateTransition,
  type LifecycleState,
} from '../src/domain/usecase/agent/machine-agent-lifecycle-transitions';

// ─── Validators ──────────────────────────────────────────────────────────────

const lifecycleStateValidator = v.union(...LIFECYCLE_STATES.map((s) => v.literal(s)));

// ─── Helper: Resolve teamId from chatroom ────────────────────────────────────

async function resolveTeamId(
  ctx: MutationCtx | QueryCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<string> {
  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!chatroom?.teamId) {
    throw new Error(`Chatroom ${chatroomId} has no teamId`);
  }
  return chatroom.teamId;
}

// ─── Helper: Get lifecycle row ───────────────────────────────────────────────

async function getLifecycleRow(
  ctx: MutationCtx | QueryCtx,
  chatroomId: Id<'chatroom_rooms'>,
  teamId: string,
  role: string
) {
  return ctx.db
    .query('chatroom_machineAgentLifecycle')
    .withIndex('by_chatroom_team_role', (q) =>
      q.eq('chatroomId', chatroomId).eq('teamId', teamId).eq('role', role)
    )
    .unique();
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Transition an agent to a new state. Validates the transition is legal.
 *
 * If no lifecycle row exists and the target state is a valid initial state
 * (transition from 'offline'), a new row is created.
 */
export const transition = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    targetState: lifecycleStateValidator,
    machineId: v.optional(v.string()),
    pid: v.optional(v.number()),
    model: v.optional(v.string()),
    agentHarness: v.optional(v.literal('opencode')),
    workingDir: v.optional(v.string()),
    connectionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await validateSession(ctx, args.sessionId);
    if (!result.valid) {
      throw new Error('Invalid session');
    }

    const teamId = await resolveTeamId(ctx, args.chatroomId);
    const existing = await getLifecycleRow(ctx, args.chatroomId, teamId, args.role);
    const now = Date.now();

    const currentState: LifecycleState = existing?.state ?? 'offline';
    const targetState = args.targetState as LifecycleState;

    const validation = validateTransition(currentState, targetState);
    if (!validation.valid) {
      return { transitioned: false, reason: validation.reason, currentState };
    }

    const updates: Record<string, unknown> = {
      state: targetState,
      stateChangedAt: now,
    };

    if (args.machineId !== undefined) updates.machineId = args.machineId;
    if (args.pid !== undefined) updates.pid = args.pid;
    if (args.model !== undefined) updates.model = args.model;
    if (args.agentHarness !== undefined) updates.agentHarness = args.agentHarness;
    if (args.workingDir !== undefined) updates.workingDir = args.workingDir;
    if (args.connectionId !== undefined) updates.connectionId = args.connectionId;

    // When transitioning to offline, clear runtime fields
    if (targetState === 'offline') {
      updates.pid = undefined;
      updates.heartbeatAt = undefined;
      updates.connectionId = undefined;
    }

    // When transitioning to ready/working, set heartbeat
    if (targetState === 'ready' || targetState === 'working') {
      updates.heartbeatAt = now;
    }

    if (existing) {
      await ctx.db.patch('chatroom_machineAgentLifecycle', existing._id, updates);
    } else {
      await ctx.db.insert('chatroom_machineAgentLifecycle', {
        chatroomId: args.chatroomId,
        teamId,
        role: args.role,
        state: targetState,
        stateChangedAt: now,
        machineId: args.machineId,
        pid: targetState === 'offline' ? undefined : args.pid,
        heartbeatAt: targetState === 'ready' || targetState === 'working' ? now : undefined,
        model: args.model,
        agentHarness: args.agentHarness,
        workingDir: args.workingDir,
        connectionId: targetState === 'offline' ? undefined : args.connectionId,
      });
    }

    return { transitioned: true, from: currentState, to: targetState };
  },
});

/**
 * Update the heartbeat timestamp for an active agent.
 * Only valid when the agent is in 'ready' or 'working' state.
 */
export const heartbeat = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const result = await validateSession(ctx, args.sessionId);
    if (!result.valid) {
      throw new Error('Invalid session');
    }

    const teamId = await resolveTeamId(ctx, args.chatroomId);
    const existing = await getLifecycleRow(ctx, args.chatroomId, teamId, args.role);

    if (!existing) {
      return { updated: false, reason: 'No lifecycle row found' };
    }

    if (existing.state !== 'ready' && existing.state !== 'working') {
      return { updated: false, reason: `Cannot heartbeat in state '${existing.state}'` };
    }

    await ctx.db.patch('chatroom_machineAgentLifecycle', existing._id, { heartbeatAt: Date.now() });
    return { updated: true };
  },
});

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Get the lifecycle state for a single agent.
 */
export const getStatus = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const result = await validateSession(ctx, args.sessionId);
    if (!result.valid) {
      return null;
    }

    const teamId = await resolveTeamId(ctx, args.chatroomId);
    return getLifecycleRow(ctx, args.chatroomId, teamId, args.role);
  },
});

/**
 * Get lifecycle states for all agents in a chatroom.
 */
export const getTeamStatus = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const result = await validateSession(ctx, args.sessionId);
    if (!result.valid) {
      return { agents: [] };
    }

    const agents = await ctx.db
      .query('chatroom_machineAgentLifecycle')
      .withIndex('by_chatroom_team_role', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    return { agents };
  },
});

/**
 * Get all agents assigned to a specific machine.
 * Used by daemon for state recovery on restart.
 */
export const getByMachine = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const result = await validateSession(ctx, args.sessionId);
    if (!result.valid) {
      return { agents: [] };
    }

    const agents = await ctx.db
      .query('chatroom_machineAgentLifecycle')
      .withIndex('by_machine_state', (q) => q.eq('machineId', args.machineId))
      .collect();

    return { agents };
  },
});

// ─── Internal Mutations (for cron) ───────────────────────────────────────────

/**
 * Reconcile stale lifecycle records. Called by the cron job.
 *
 * 1. Expire heartbeats: ready/working with stale heartbeat → dead
 * 2. Clean up stuck transitions: dead/stopping/starting/etc. past timeout → offline
 */
export const reconcile = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let expired = 0;
    let cleanedUp = 0;

    // 1. Heartbeat expiry: ready/working with no heartbeat for > TTL → dead
    const readyAgents = await ctx.db
      .query('chatroom_machineAgentLifecycle')
      .withIndex('by_state', (q) => q.eq('state', 'ready'))
      .collect();

    const workingAgents = await ctx.db
      .query('chatroom_machineAgentLifecycle')
      .withIndex('by_state', (q) => q.eq('state', 'working'))
      .collect();

    for (const agent of [...readyAgents, ...workingAgents]) {
      if (agent.heartbeatAt && agent.heartbeatAt + HEARTBEAT_TTL_MS < now) {
        await ctx.db.patch('chatroom_machineAgentLifecycle', agent._id, {
          state: 'dead',
          stateChangedAt: now,
        });
        expired++;
      }
    }

    // 2. Stuck transition cleanup
    const stuckStates: { state: LifecycleState; timeout: number }[] = [
      { state: 'dead', timeout: 60_000 },
      { state: 'stopping', timeout: 60_000 },
      { state: 'starting', timeout: 120_000 },
      { state: 'start_requested', timeout: 30_000 },
      { state: 'stop_requested', timeout: 30_000 },
    ];

    for (const { state, timeout } of stuckStates) {
      const agents = await ctx.db
        .query('chatroom_machineAgentLifecycle')
        .withIndex('by_state', (q) => q.eq('state', state))
        .collect();

      for (const agent of agents) {
        if (agent.stateChangedAt + timeout < now) {
          await ctx.db.patch('chatroom_machineAgentLifecycle', agent._id, {
            state: 'offline',
            stateChangedAt: now,
            pid: undefined,
            heartbeatAt: undefined,
            connectionId: undefined,
          });
          cleanedUp++;
        }
      }
    }

    if (expired > 0 || cleanedUp > 0) {
      console.warn(`[lifecycle-reconcile] expired=${expired} cleanedUp=${cleanedUp}`);
    }

    return { expired, cleanedUp };
  },
});
