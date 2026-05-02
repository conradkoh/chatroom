/**
 * HarnessSession mutations and queries for the direct-harness feature.
 *
 * Sessions are associated with existing chatroom_workspaces entries (the daemon
 * registers workspaces separately via the daemon workspace registry).
 *
 * All functions require:
 *  1. directHarnessWorkers feature flag enabled
 *  2. Valid SessionIdArg authentication
 *  3. Chatroom membership (resolved via the workspace's chatroomId)
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from '../../_generated/server.js';
import { requireChatroomAccess } from '../../auth/cliSessionAuth.js';
import { getAuthenticatedUser } from '../../auth/authenticatedUser.js';
import { getSessionWithAccess, requireDirectHarnessWorkers } from './helpers.js';

// ─── openSession ─────────────────────────────────────────────────────────────

/**
 * Open a new harness session in the given workspace.
 *
 * Atomic: inserts the session row AND a paired pending-prompt row in a single
 * transaction. Validates firstPrompt and config.agent BEFORE inserting any row
 * so a bad request leaves no orphaned rows behind (per design §9.5).
 *
 * Returns { harnessSessionRowId, promptId }.
 */
export const openSession = mutation({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
    harnessName: v.string(),
    config: v.object({
      agent: v.string(),
      model: v.optional(v.object({ providerID: v.string(), modelID: v.string() })),
      system: v.optional(v.string()),
      tools: v.optional(v.record(v.string(), v.boolean())),
    }),
    firstPrompt: v.object({
      parts: v.array(v.object({ type: v.literal('text'), text: v.string() })),
    }),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    // Validate BEFORE inserting any row (§9.5)
    if (!args.config.agent || args.config.agent.trim() === '') {
      throw new ConvexError({
        code: 'HARNESS_SESSION_INVALID_AGENT',
        message: 'config.agent is required and must not be empty',
      });
    }
    if (!args.firstPrompt.parts || args.firstPrompt.parts.length === 0) {
      throw new ConvexError({
        code: 'HARNESS_SESSION_INVALID_PROMPT',
        message: 'firstPrompt.parts must have at least one entry',
      });
    }

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: `Workspace ${args.workspaceId} not found`,
      });
    }

    const { session } = await requireChatroomAccess(ctx, args.sessionId, workspace.chatroomId);

    const now = Date.now();

    // Atomically insert session row + pending prompt
    const harnessSessionRowId = await ctx.db.insert('chatroom_harnessSessions', {
      workspaceId: args.workspaceId,
      harnessName: args.harnessName,
      harnessSessionId: undefined,
      lastUsedConfig: args.config,
      status: 'pending',
      createdBy: session.userId,
      createdAt: now,
      lastActiveAt: now,
    });

    const promptId = await ctx.db.insert('chatroom_pendingPrompts', {
      harnessSessionRowId,
      machineId: workspace.machineId,
      workspaceId: args.workspaceId,
      taskType: 'prompt',
      parts: args.firstPrompt.parts,
      override: args.config,
      status: 'pending',
      requestedBy: session.userId,
      requestedAt: now,
      updatedAt: now,
    });

    return { harnessSessionRowId, promptId };
  },
});

// ─── associateHarnessSessionId ────────────────────────────────────────────────

/**
 * Associate the opencode-server-issued harnessSessionId with a session row
 * after the harness process has spawned.
 *
 * Idempotent: if the same harnessSessionId is already set, returns without writing.
 * Throws if a different harnessSessionId is already associated.
 */
export const associateHarnessSessionId = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
    harnessSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { harnessSession } = await getSessionWithAccess(
      ctx,
      args.sessionId,
      args.harnessSessionRowId
    );

    // Idempotent: same session already associated
    if (harnessSession.harnessSessionId === args.harnessSessionId) {
      return;
    }

    // Conflict: different session already associated
    if (harnessSession.harnessSessionId !== undefined && harnessSession.harnessSessionId !== null) {
      throw new ConvexError({
        code: 'CONFLICT',
        message: `HarnessSession ${args.harnessSessionRowId} already has a different harnessSessionId: ${harnessSession.harnessSessionId}`,
      });
    }

    await ctx.db.patch(args.harnessSessionRowId, {
      harnessSessionId: args.harnessSessionId,
      status: 'active',
      lastActiveAt: Date.now(),
    });
  },
});

// ─── closeSession ─────────────────────────────────────────────────────────────

/**
 * Mark a harness session as closed. Idempotent — closing an already-closed
 * session is a no-op.
 */
export const closeSession = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { harnessSession } = await getSessionWithAccess(
      ctx,
      args.sessionId,
      args.harnessSessionRowId
    );

    if (harnessSession.status === 'closed') {
      return;
    }

    await ctx.db.patch(args.harnessSessionRowId, {
      status: 'closed',
      lastActiveAt: Date.now(),
    });
  },
});

// ─── updateSessionConfig ──────────────────────────────────────────────────────

/**
 * Update the config (agent, model, system, tools) associated with a harness session.
 *
 * Patches lastUsedConfig by merging the provided fields with the existing config.
 * Only present keys overwrite.
 *
 * Validates agent against the machine registry when provided:
 * - No registry entry → harness not booted yet → accept any agent
 * - Registry entry, no workspace entry → harness not published this workspace yet → accept any
 * - Registry entry, workspace with agents=[] → misconfigured harness → reject
 * - Registry entry, workspace with agents → must be in the known list
 */
export const updateSessionConfig = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
    config: v.object({
      agent: v.optional(v.string()),
      model: v.optional(v.object({ providerID: v.string(), modelID: v.string() })),
      system: v.optional(v.string()),
      tools: v.optional(v.record(v.string(), v.boolean())),
    }),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { harnessSession } = await getSessionWithAccess(
      ctx,
      args.sessionId,
      args.harnessSessionRowId
    );

    // Validate agent against machine registry if provided
    if (args.config.agent !== undefined) {
      const workspace = await ctx.db.get(harnessSession.workspaceId);
      if (workspace) {
        const registryEntry = await ctx.db
          .query('chatroom_machineRegistry')
          .withIndex('by_machineId', (q) => q.eq('machineId', workspace.machineId))
          .first();

        if (registryEntry) {
          const wsEntry = registryEntry.workspaces.find(
            (w) => w.workspaceId === (harnessSession.workspaceId as string)
          );
          if (wsEntry) {
            const allAgents = wsEntry.harnesses.flatMap((h) => h.agents);
            if (allAgents.length === 0) {
              throw new ConvexError({
                code: 'HARNESS_SESSION_UNKNOWN_AGENT',
                message: `Workspace harness reports no available agents. Check your opencode configuration.`,
              });
            }
            const knownAgentNames = allAgents.map((a) => a.name);
            if (!knownAgentNames.includes(args.config.agent)) {
              throw new ConvexError({
                code: 'HARNESS_SESSION_UNKNOWN_AGENT',
                message: `Unknown agent '${args.config.agent}'. Available agents for this workspace: ${knownAgentNames.join(', ')}`,
              });
            }
          }
          // wsEntry not found — harness hasn't published workspace yet; accept any agent
        }
        // No registry entry — harness not booted yet; accept any agent
      }
    }

    // Merge provided fields into existing lastUsedConfig
    const updatedConfig = {
      ...harnessSession.lastUsedConfig,
      ...(args.config.agent !== undefined ? { agent: args.config.agent } : {}),
      ...(args.config.model !== undefined ? { model: args.config.model } : {}),
      ...(args.config.system !== undefined ? { system: args.config.system } : {}),
      ...(args.config.tools !== undefined ? { tools: args.config.tools } : {}),
    };

    await ctx.db.patch(args.harnessSessionRowId, {
      lastUsedConfig: updatedConfig,
      lastActiveAt: Date.now(),
    });
  },
});

// ─── getSession ───────────────────────────────────────────────────────────────

/**
 * Fetch a single harness session by its backend row ID.
 */
export const getSession = query({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { harnessSession } = await getSessionWithAccess(
      ctx,
      args.sessionId,
      args.harnessSessionRowId
    );
    return harnessSession;
  },
});

// ─── listPendingSessionsForMachine ───────────────────────────────────────────

/**
 * Query pending harness sessions for a machine (for daemon subscription).
 *
 * Returns all `chatroom_harnessSessions` rows where:
 * - `status === 'pending'`
 * - `harnessSessionId` is not yet set (not yet associated with a spawned process)
 * - The session's workspace belongs to the given machine
 *
 * Used by the daemon to detect new sessions opened from the webapp UI and
 * automatically orchestrate harness boot + session association.
 *
 * Returns [] on auth failure (same pattern as getPendingPromptsForMachine).
 */
export const listPendingSessionsForMachine = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) return [];

    // Look up all workspaces for this machine owned by the authenticated user
    const workspaces = await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_machine', (q) => q.eq('machineId', args.machineId))
      .collect();

    if (workspaces.length === 0) return [];

    const workspaceIds = new Set(workspaces.map((w) => w._id));

    // Gather pending sessions for each workspace in parallel
    const sessionGroups = await Promise.all(
      [...workspaceIds].map((workspaceId) =>
        ctx.db
          .query('chatroom_harnessSessions')
          .withIndex('by_workspace_status', (q) =>
            q.eq('workspaceId', workspaceId).eq('status', 'pending')
          )
          .collect()
      )
    );

    // Flatten and filter to sessions that are not yet associated with a harness process
    return sessionGroups
      .flat()
      .filter((s) => s.harnessSessionId === undefined || s.harnessSessionId === null);
  },
});

// ─── listSessionsByWorkspace ──────────────────────────────────────────────────

/**
 * List all harness sessions for a workspace, ordered by creation time ascending.
 * Optionally filter by status.
 */
export const listSessionsByWorkspace = query({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
    status: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('spawning'),
        v.literal('active'),
        v.literal('idle'),
        v.literal('closed'),
        v.literal('failed')
      )
    ),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    // Verify the workspace exists and the caller has access via chatroom membership
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: `Workspace ${args.workspaceId} not found`,
      });
    }
    await requireChatroomAccess(ctx, args.sessionId, workspace.chatroomId);

    if (args.status !== undefined) {
      return ctx.db
        .query('chatroom_harnessSessions')
        .withIndex('by_workspace_status', (q) =>
          q.eq('workspaceId', args.workspaceId).eq('status', args.status!)
        )
        .order('asc')
        .collect();
    }

    return ctx.db
      .query('chatroom_harnessSessions')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
      .order('asc')
      .collect();
  },
});
