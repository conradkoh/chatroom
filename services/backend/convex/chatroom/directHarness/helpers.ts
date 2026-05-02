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
  const harnessSession = await ctx.db.get("chatroom_harnessSessions", harnessSessionRowId);
  if (!harnessSession) {
    throw new ConvexError({
      code: 'NOT_FOUND',
      message: `HarnessSession ${harnessSessionRowId} not found`,
    });
  }

  const workspace = await ctx.db.get("chatroom_workspaces", harnessSession.workspaceId);
  if (!workspace) {
    throw new ConvexError({
      code: 'NOT_FOUND',
      message: `Workspace ${harnessSession.workspaceId} not found`,
    });
  }

  const chatroomAccess = await requireChatroomAccess(ctx, sessionId, workspace.chatroomId);

  return { ...chatroomAccess, harnessSession, workspace };
}
