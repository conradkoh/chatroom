/**
 * Helper utilities for the direct-harness backend module.
 *
 * Provides:
 * - Feature flag guard (throws when directHarnessWorkers is off)
 * - Session access guard (resolves via existing chatroom_workspaces)
 */

import { ConvexError } from 'convex/values';

import { featureFlags } from '../../../config/featureFlags.js';
import type { Doc, Id } from '../../_generated/dataModel.js';
import type { MutationCtx, QueryCtx } from '../../_generated/server.js';
import type { AuthenticatedChatroomAccess } from '../../auth/cliSessionAuth.js';
import { requireChatroomAccess } from '../../auth/cliSessionAuth.js';

// ─── Feature flag guard ──────────────────────────────────────────────────────

/**
 * Throws a ConvexError if the directHarnessWorkers feature flag is disabled.
 * Call at the top of every mutation and query in this module.
 */
export function requireDirectHarnessWorkers(): void {
  if (!featureFlags.directHarnessWorkers) {
    throw new ConvexError('directHarnessWorkers feature flag is disabled');
  }
}

// ─── Agent validation ────────────────────────────────────────────────────────

/**
 * Asserts that the given agent string is non-empty. Throws a ConvexError with
 * code HARNESS_SESSION_INVALID_AGENT if the assertion fails.
 */
export function assertAgentNonEmpty(agent: string): void {
  if (!agent || agent.trim().length === 0) {
    throw new ConvexError({
      code: 'HARNESS_SESSION_INVALID_AGENT',
      message: 'Agent must be a non-empty string',
      fields: { agent },
    });
  }
}

// ─── Message sequencing ─────────────────────────────────────────────────────

/**
 * Compute the next monotonically-increasing sequence number for a session's
 * messages. Convex mutations are serialized, so this is race-free: no two
 * mutations can interleave between the read and write.
 *
 * Falls back to Date.now() if no messages exist yet (first message).
 */
export async function getNextMessageSeq(
  ctx: { db: MutationCtx['db'] },
  harnessSessionRowId: Id<'chatroom_harnessSessions'>
): Promise<number> {
  const lastMessage = await ctx.db
    .query('chatroom_harnessSessionMessages')
    .withIndex('by_session_seq', (q) => q.eq('harnessSessionRowId', harnessSessionRowId))
    .order('desc')
    .first();
  return lastMessage ? lastMessage.seq + 1 : Date.now();
}

// ─── Session access guard ────────────────────────────────────────────────────

/** The authenticated context returned when a session access check passes. */
export interface SessionAccess extends AuthenticatedChatroomAccess {
  harnessSession: Doc<'chatroom_harnessSessions'>;
  workspace: Doc<'chatroom_workspaces'>;
}

/**
 * Fetch the harness session document and verify that the calling session has
 * access to the session's workspace's chatroom. Throws on not found or unauthorized.
 */
export async function getSessionWithAccess(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  harnessSessionRowId: Id<'chatroom_harnessSessions'>
): Promise<SessionAccess> {
  const harnessSession = await ctx.db.get('chatroom_harnessSessions', harnessSessionRowId);
  if (!harnessSession) {
    throw new ConvexError({
      code: 'NOT_FOUND',
      message: `HarnessSession ${harnessSessionRowId} not found`,
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
