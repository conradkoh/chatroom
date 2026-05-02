/**
 * Pending prompt queue for the direct-harness feature.
 *
 * Provides submit → claim → complete lifecycle:
 *   1. UI calls `submitPrompt` → inserts pending row
 *   2. Daemon polls via subscription, calls `claimNextPendingPrompt` → pending→processing
 *   3. Daemon calls `harness.prompt()`, then `completePendingPrompt` → done|error
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from '../../_generated/server.js';
import { getSessionWithAccess, requireDirectHarnessWorkers } from './helpers.js';
import { getAuthenticatedUser } from '../../auth/authenticatedUser.js';

// ─── submitPrompt ─────────────────────────────────────────────────────────────

/**
 * Submit a prompt to be executed against a harness session.
 *
 * Auth: requires `requireChatroomAccess` resolved via the session's workspace.
 * Rejects if the session status is `closed` or `failed`.
 */
export const submitPrompt = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
    parts: v.array(v.object({ type: v.literal('text'), text: v.string() })),
    override: v.object({
      agent: v.string(),
      model: v.optional(v.object({ providerID: v.string(), modelID: v.string() })),
      system: v.optional(v.string()),
      tools: v.optional(v.record(v.string(), v.boolean())),
    }),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    if (!args.override.agent || args.override.agent.trim() === '') {
      throw new ConvexError({
        code: 'HARNESS_SESSION_INVALID_AGENT',
        message: 'override.agent is required and must not be empty',
      });
    }

    const { harnessSession, session } = await getSessionWithAccess(
      ctx,
      args.sessionId,
      args.harnessSessionRowId
    );

    if (harnessSession.status === 'closed' || harnessSession.status === 'failed') {
      throw new ConvexError({
        code: 'HARNESS_SESSION_CLOSED',
        message: `Cannot submit prompt — session ${args.harnessSessionRowId} status is '${harnessSession.status}'`,
      });
    }

    // Look up workspace to get machineId (denormalized for daemon poll)
    const workspace = await ctx.db.get(harnessSession.workspaceId);
    if (!workspace) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Workspace not found' });
    }

    const now = Date.now();

    // Update lastUsedConfig on the session to mirror the override (keeps session-detail in sync)
    await ctx.db.patch(args.harnessSessionRowId, {
      lastUsedConfig: args.override,
      lastActiveAt: now,
    });

    const promptId = await ctx.db.insert('chatroom_pendingPrompts', {
      harnessSessionRowId: args.harnessSessionRowId,
      machineId: workspace.machineId,
      workspaceId: harnessSession.workspaceId,
      taskType: 'prompt',
      parts: args.parts,
      override: args.override,
      status: 'pending',
      requestedBy: session.userId,
      requestedAt: now,
      updatedAt: now,
    });

    return { promptId };
  },
});

// ─── resumeSession ─────────────────────────────────────────────────────

/**
 * Enqueue a resume task for a session.
 *
 * The daemon picks it up via claimNextPendingPrompt, reconnects to the harness,
 * and flips the session status back to 'active'.
 *
 * Lazy resume contract: sessions are NOT auto-resumed on daemon startup.
 * Resume only happens on explicit user action (click in the UI).
 * This keeps daemon boot fast and avoids surprise costs.
 *
 * Note: closed sessions CAN be resumed if opencode still has the session
 * record in its store. The mutation does not block on this; only the
 * daemon knows whether the harness can actually resume. If it cannot,
 * status will flip to 'failed'.
 */
export const resumeSession = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { harnessSession, session } = await getSessionWithAccess(
      ctx,
      args.sessionId,
      args.harnessSessionRowId
    );

    // Structurally invalid statuses cannot be resumed
    if (harnessSession.status === 'pending' || harnessSession.status === 'spawning') {
      throw new ConvexError(
        `Cannot resume session ${args.harnessSessionRowId} — it is still starting (status: ${harnessSession.status})`
      );
    }

    const workspace = await ctx.db.get(harnessSession.workspaceId);
    if (!workspace) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Workspace not found' });
    }

    const now = Date.now();
    const promptId = await ctx.db.insert('chatroom_pendingPrompts', {
      harnessSessionRowId: args.harnessSessionRowId,
      machineId: workspace.machineId,
      workspaceId: harnessSession.workspaceId,
      taskType: 'resume',
      parts: [], // no parts for resume tasks
      override: { agent: harnessSession.lastUsedConfig.agent },
      status: 'pending',
      requestedBy: session.userId,
      requestedAt: now,
      updatedAt: now,
    });

    return { promptId };
  },
});

// ─── claimNextPendingPrompt ───────────────────────────────────────────────────

/**
 * Atomically claim the next pending prompt for a machine.
 *
 * Auth: machine ownership (same pattern as publishMachineCapabilities).
 * Transitions status pending → processing for the oldest pending prompt.
 * Returns null if no pending prompts exist for this machine.
 *
 * Ordered by _creationTime ascending (index order tracks insertion, which equals requestedAt
 * for our sequential writers). Convex mutations are serializable so insertion order is guaranteed.
 */
export const claimNextPendingPrompt = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) throw new Error('Authentication required');

    // Verify the machine belongs to the authenticated user
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    if (!machine) throw new Error(`Machine ${args.machineId} is not registered`);
    if (machine.userId !== auth.user._id) throw new Error('Machine belongs to a different user');

    // Find the oldest pending prompt for this machine
    const pending = await ctx.db
      .query('chatroom_pendingPrompts')
      .withIndex('by_machine_status', (q) =>
        q.eq('machineId', args.machineId).eq('status', 'pending')
      )
      .order('asc') // oldest first (by _creationTime, which equals requestedAt for sequential inserts)
      .first();

    if (!pending) return null;

    // Atomically claim it
    await ctx.db.patch(pending._id, {
      status: 'processing',
      updatedAt: Date.now(),
    });

    return { ...pending, status: 'processing' as const };
  },
});

// ─── completePendingPrompt ────────────────────────────────────────────────────

/**
 * Finalise a claimed prompt — set status to done or error.
 * Auth: machine ownership.
 */
export const completePendingPrompt = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    promptId: v.id('chatroom_pendingPrompts'),
    status: v.union(v.literal('done'), v.literal('error')),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) throw new Error('Authentication required');

    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    if (!machine) throw new Error(`Machine ${args.machineId} is not registered`);
    if (machine.userId !== auth.user._id) throw new Error('Machine belongs to a different user');

    const prompt = await ctx.db.get(args.promptId);
    if (!prompt) throw new ConvexError({ code: 'NOT_FOUND', message: 'Pending prompt not found' });

    // Verify the prompt belongs to the machine that is completing it
    if (prompt.machineId !== args.machineId) {
      throw new ConvexError('Prompt does not belong to this machine');
    }

    await ctx.db.patch(args.promptId, {
      status: args.status,
      ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
      updatedAt: Date.now(),
    });
  },
});

// ─── getPendingPromptsForMachine ──────────────────────────────────────────────

/**
 * Query pending prompts for a machine (for daemon subscription).
 * Returns prompts with status 'pending' ordered by requestedAt.
 */
export const getPendingPromptsForMachine = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) return [];

    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    if (!machine || machine.userId !== auth.user._id) return [];

    return ctx.db
      .query('chatroom_pendingPrompts')
      .withIndex('by_machine_status', (q) =>
        q.eq('machineId', args.machineId).eq('status', 'pending')
      )
      .order('asc')
      .collect();
  },
});

// ─── getSessionPromptQueue ────────────────────────────────────────────────────

/**
 * Get all prompts for a session (for UI subscription).
 * Shows the full history including done/error prompts.
 */
export const getSessionPromptQueue = query({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionRowId);

    return ctx.db
      .query('chatroom_pendingPrompts')
      .withIndex('by_session', (q) => q.eq('harnessSessionRowId', args.harnessSessionRowId))
      .order('asc')
      .collect();
  },
});
