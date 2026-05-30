/**
 * Helper utilities for the direct-harness backend module.
 *
 * Provides:
 * - Feature flag guard (throws when directHarnessWorkers is off)
 * - Session access guard (resolves via existing chatroom_workspaces)
 */

import { ConvexError } from 'convex/values';

import { featureFlags } from '../../config/featureFlags.js';
import type { Doc, Id } from '../_generated/dataModel.js';
import type { MutationCtx, QueryCtx } from '../_generated/server.js';
import type { AuthenticatedChatroomAccess } from '../auth/chatroomAccess.js';
import { requireChatroomAccess } from '../auth/chatroomAccess.js';
import {
  type MachineAuth,
  requireMachineOwner,
} from '../auth/machineAccess.js';

// ─── Feature flag guard ──────────────────────────────────────────────────────

export function requireDirectHarnessWorkers(): void {
  if (!featureFlags.directHarnessWorkers) {
    throw new ConvexError('directHarnessWorkers feature flag is disabled');
  }
}

// ─── Agent validation ────────────────────────────────────────────────────────

export function assertAgentNonEmpty(agent: string): void {
  if (!agent || agent.trim().length === 0) {
    throw new ConvexError({
      code: 'HARNESS_SESSION_INVALID_AGENT',
      message: 'Agent must be a non-empty string',
      fields: { agent },
    });
  }
}

/**
 * Returns the next monotonically-increasing turnSeq for a session's turns.
 * Starts at 1. Convex mutations are serialised so this is race-free.
 */
export async function getNextTurnSeq(
  ctx: { db: MutationCtx['db'] },
  harnessSessionId: Id<'chatroom_harnessSessions'>
): Promise<number> {
  const lastTurn = await ctx.db
    .query('chatroom_harnessSessionTurns')
    .withIndex('by_session_turnSeq', (q) => q.eq('harnessSessionId', harnessSessionId))
    .order('desc')
    .first();
  return (lastTurn?.turnSeq ?? 0) + 1;
}

// ─── Harness session type narrowing ─────────────────────────────────────────

/**
 * Narrows a harness session doc to the 'opencode' variant.
 * Throws if the session is in the legacy flat format (pre-migration).
 * After dev:cleanup migration all sessions have type='opencode'.
 */
export function requireOpencodeSession(
  s: Doc<'chatroom_harnessSessions'>
): Extract<Doc<'chatroom_harnessSessions'>, { type: 'opencode' }> {
  if (!('type' in s) || (s as { type: unknown }).type !== 'opencode') {
    throw new ConvexError({
      code: 'UNSUPPORTED_HARNESS_TYPE',
      message: `Expected opencode session but got type='${
        'type' in s ? (s as { type: unknown }).type : 'legacy'
      }'`,
    });
  }
  return s as Extract<Doc<'chatroom_harnessSessions'>, { type: 'opencode' }>;
}

export interface SessionAccess extends AuthenticatedChatroomAccess {
  harnessSession: Doc<'chatroom_harnessSessions'>;
  workspace: Doc<'chatroom_workspaces'>;
}

export async function getSessionWithAccess(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  harnessSessionId: Id<'chatroom_harnessSessions'>
): Promise<SessionAccess> {
  const harnessSession = await ctx.db.get('chatroom_harnessSessions', harnessSessionId);
  if (!harnessSession) {
    throw new ConvexError({
      code: 'NOT_FOUND',
      message: `HarnessSession ${harnessSessionId} not found`,
    });
  }

  const workspace = await ctx.db.get('chatroom_workspaces', harnessSession.workspaceId);
  if (!workspace) {
    throw new ConvexError({
      code: 'NOT_FOUND',
      message: `Workspace ${harnessSession.workspaceId} not found`,
    });
  }

  const chatroomAccess = await requireChatroomAccess(ctx, sessionId, workspace.chatroomId);
  return { ...chatroomAccess, harnessSession, workspace };
}

export interface HarnessSessionOnMachineAccess {
  auth: MachineAuth;
  harnessSession: Doc<'chatroom_harnessSessions'>;
  workspace: Doc<'chatroom_workspaces'>;
}

/**
 * Layer 3 guard: session must exist and its workspace must belong to the authorized machine.
 */
export async function requireHarnessSessionOnOwnedMachine(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  machineId: string,
  harnessSessionId: Id<'chatroom_harnessSessions'>
): Promise<HarnessSessionOnMachineAccess> {
  const auth = await requireMachineOwner(ctx, sessionId, machineId);

  const harnessSession = await ctx.db.get('chatroom_harnessSessions', harnessSessionId);
  if (!harnessSession) {
    throw new ConvexError({
      code: 'NOT_FOUND',
      message: `HarnessSession ${harnessSessionId} not found`,
    });
  }

  const workspace = await ctx.db.get('chatroom_workspaces', harnessSession.workspaceId);
  if (!workspace) {
    throw new ConvexError({
      code: 'NOT_FOUND',
      message: `Workspace ${harnessSession.workspaceId} not found`,
    });
  }

  if (workspace.machineId !== machineId) {
    throw new ConvexError({
      code: 'NOT_AUTHORIZED_MACHINE',
      message: 'Session does not belong to this machine',
    });
  }

  return { auth, harnessSession, workspace };
}
