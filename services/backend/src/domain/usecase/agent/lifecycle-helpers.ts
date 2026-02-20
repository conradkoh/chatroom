/**
 * Lifecycle Helpers — internal functions for dual-write from existing mutations.
 *
 * These functions are called from within other Convex mutation handlers
 * (e.g., participants.join, machines.sendCommand) to keep the new
 * chatroom_machineAgentLifecycle table in sync during the migration period.
 *
 * All operations are best-effort: they log warnings on failure rather than
 * throwing, so the existing mutation behavior is not affected.
 */

import { validateTransition, type LifecycleState } from './machine-agent-lifecycle-transitions';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LifecycleTransitionInput {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  targetState: LifecycleState;
  machineId?: string;
  pid?: number;
  model?: string;
  agentHarness?: 'opencode';
  workingDir?: string;
  connectionId?: string;
}

export interface LifecycleTransitionResult {
  transitioned: boolean;
  from?: LifecycleState;
  to?: LifecycleState;
  reason?: string;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

async function resolveTeamId(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<string | null> {
  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  return chatroom?.teamId ?? null;
}

async function getLifecycleRow(
  ctx: MutationCtx,
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

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Attempt a lifecycle transition from within another mutation handler.
 * Best-effort: logs warnings on failure, never throws.
 */
export async function tryLifecycleTransition(
  ctx: MutationCtx,
  input: LifecycleTransitionInput
): Promise<LifecycleTransitionResult> {
  try {
    const teamId = await resolveTeamId(ctx, input.chatroomId);
    if (!teamId) {
      return { transitioned: false, reason: 'Chatroom has no teamId' };
    }

    const existing = await getLifecycleRow(ctx, input.chatroomId, teamId, input.role);
    const now = Date.now();

    const currentState: LifecycleState = existing?.state ?? 'offline';
    const targetState = input.targetState;

    const validation = validateTransition(currentState, targetState);
    if (!validation.valid) {
      return { transitioned: false, from: currentState, reason: validation.reason };
    }

    const updates: Record<string, unknown> = {
      state: targetState,
      stateChangedAt: now,
    };

    if (input.machineId !== undefined) updates.machineId = input.machineId;
    if (input.pid !== undefined) updates.pid = input.pid;
    if (input.model !== undefined) updates.model = input.model;
    if (input.agentHarness !== undefined) updates.agentHarness = input.agentHarness;
    if (input.workingDir !== undefined) updates.workingDir = input.workingDir;
    if (input.connectionId !== undefined) updates.connectionId = input.connectionId;

    if (targetState === 'offline') {
      updates.pid = undefined;
      updates.heartbeatAt = undefined;
      updates.connectionId = undefined;
    }

    if (targetState === 'ready' || targetState === 'working') {
      updates.heartbeatAt = now;
    }

    if (existing) {
      await ctx.db.patch('chatroom_machineAgentLifecycle', existing._id, updates);
    } else {
      await ctx.db.insert('chatroom_machineAgentLifecycle', {
        chatroomId: input.chatroomId,
        teamId,
        role: input.role,
        state: targetState,
        stateChangedAt: now,
        machineId: input.machineId,
        pid: targetState === 'offline' ? undefined : input.pid,
        heartbeatAt: targetState === 'ready' || targetState === 'working' ? now : undefined,
        model: input.model,
        agentHarness: input.agentHarness,
        workingDir: input.workingDir,
        connectionId: targetState === 'offline' ? undefined : input.connectionId,
      });
    }

    return { transitioned: true, from: currentState, to: targetState };
  } catch (e) {
    console.warn(
      `[lifecycle-dual-write] Failed to transition ${input.role} to ${input.targetState}: ${(e as Error).message}`
    );
    return { transitioned: false, reason: (e as Error).message };
  }
}

/**
 * Update the heartbeat timestamp for an active agent.
 * Best-effort: logs warnings on failure, never throws.
 */
export async function tryLifecycleHeartbeat(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<boolean> {
  try {
    const teamId = await resolveTeamId(ctx, chatroomId);
    if (!teamId) return false;

    const existing = await getLifecycleRow(ctx, chatroomId, teamId, role);
    if (!existing) return false;

    if (existing.state !== 'ready' && existing.state !== 'working') {
      return false;
    }

    await ctx.db.patch('chatroom_machineAgentLifecycle', existing._id, {
      heartbeatAt: Date.now(),
    });
    return true;
  } catch (e) {
    console.warn(`[lifecycle-dual-write] Failed to heartbeat for ${role}: ${(e as Error).message}`);
    return false;
  }
}
