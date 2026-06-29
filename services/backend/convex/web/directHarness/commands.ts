/**
 * Web-facing direct-harness command endpoints.
 *
 * Called from the web UI to issue commands for the daemon to execute.
 * Commands are stored in chatroom_directHarnessCommands and picked up
 * by the daemon via listPendingCommands.
 *
 * Each command type has an optional field named after the type (e.g.
 * refreshCapabilities → refreshCapabilities payload). This keeps the
 * schema extensible for future command types.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';
import type { SessionId } from 'convex-helpers/server/sessions';

import type { Id } from '../../_generated/dataModel';
import { mutation } from '../../_generated/server';
import type { MutationCtx } from '../../_generated/server';
import { requireDirectHarnessWorkers } from '../../api/directHarnessHelpers';
import { requireChatroomAccess } from '../../auth/chatroomAccess';

async function requireHarnessSessionContext(
  ctx: MutationCtx,
  sessionId: SessionId,
  harnessSessionId: Id<'chatroom_harnessSessions'>
) {
  requireDirectHarnessWorkers();

  const harnessSession = await ctx.db.get('chatroom_harnessSessions', harnessSessionId);
  if (!harnessSession) {
    throw new Error('Harness session not found');
  }

  const workspace = await ctx.db.get('chatroom_workspaces', harnessSession.workspaceId);
  if (!workspace) {
    throw new Error('Workspace not found');
  }

  await requireChatroomAccess(ctx, sessionId, workspace.chatroomId);

  return { harnessSession, workspace };
}

// ─── refreshCapabilities ──────────────────────────────────────────────────────

/**
 * Request the daemon to re-discover and re-publish its capabilities
 * (agents, providers, models) for the given workspace.
 *
 * Creates a chatroom_directHarnessCommands row that the daemon picks up
 * via listPendingCommands.
 */
export const refreshCapabilities = mutation({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const workspace = await ctx.db.get('chatroom_workspaces', args.workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }

    // Verify the caller has access to this workspace's chatroom
    const { session } = await requireChatroomAccess(ctx, args.sessionId, workspace.chatroomId);

    // Dedup: if there's already a pending refreshCapabilities for this workspace,
    // don't create another — the daemon will pick it up
    const existing = await ctx.db
      .query('chatroom_directHarnessCommands')
      .withIndex('by_machineId_status', (q) =>
        q.eq('machineId', workspace.machineId).eq('status', 'pending')
      )
      .filter((q) => q.eq(q.field('type'), 'refreshCapabilities'))
      .first();

    if (existing) {
      return;
    }

    await ctx.db.insert('chatroom_directHarnessCommands', {
      machineId: workspace.machineId,
      workspaceId: args.workspaceId,
      type: 'refreshCapabilities',
      refreshCapabilities: { initiatedBy: session.userId },
      status: 'pending',
      createdAt: Date.now(),
    });
  },
});

// ─── refreshSessionTitle ──────────────────────────────────────────────────────

/**
 * Request the daemon to fetch the current session title from OpenCode
 * and sync it back to Convex.
 *
 * Creates a chatroom_directHarnessCommands row for the daemon that manages
 * the given harness session.
 */
export const refreshSessionTitle = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    const { harnessSession, workspace } = await requireHarnessSessionContext(
      ctx,
      args.sessionId,
      args.harnessSessionId
    );

    // Skip if session has no opencode session ID yet (still spawning)
    if (!('opencode' in harnessSession) || !harnessSession.opencode?.opencodeSessionId) {
      return;
    }

    await ctx.db.insert('chatroom_directHarnessCommands', {
      machineId: workspace.machineId,
      workspaceId: harnessSession.workspaceId,
      type: 'refreshSessionTitle',
      refreshSessionTitle: { harnessSessionId: args.harnessSessionId },
      status: 'pending',
      createdAt: Date.now(),
    });
  },
});

// ─── closeSession ─────────────────────────────────────────────────────────────

/**
 * Request the daemon to gracefully close a harness session: flush journal,
 * abort the harness process session, and mark the backend row as closed.
 */
// fallow-ignore-next-line code-duplication
export const closeSession = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    const { harnessSession, workspace } = await requireHarnessSessionContext(
      ctx,
      args.sessionId,
      args.harnessSessionId
    );

    if (harnessSession.status === 'closed' || harnessSession.status === 'failed') {
      return;
    }

    const existing = await ctx.db
      .query('chatroom_directHarnessCommands')
      .withIndex('by_machineId_status', (q) =>
        q.eq('machineId', workspace.machineId).eq('status', 'pending')
      )
      .filter((q) =>
        q.and(
          q.eq(q.field('type'), 'closeSession'),
          q.eq(q.field('closeSession.harnessSessionId'), args.harnessSessionId)
        )
      )
      .first();

    if (existing) {
      return;
    }

    await ctx.db.insert('chatroom_directHarnessCommands', {
      machineId: workspace.machineId,
      workspaceId: harnessSession.workspaceId,
      type: 'closeSession',
      closeSession: { harnessSessionId: args.harnessSessionId },
      status: 'pending',
      createdAt: Date.now(),
    });
  },
});
