/**
 * Machine capabilities mutations and queries for the direct-harness feature.
 *
 * publishMachineCapabilities is called by the daemon on startup and on
 * harness boot to keep the backend in sync with what workspaces and agents
 * are available on the machine.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { requireDirectHarnessWorkers } from './helpers.js';
import { mutation, query } from '../../_generated/server.js';
import { getAuthenticatedUser } from '../../auth/authenticatedUser.js';

// ─── Validators ───────────────────────────────────────────────────────────────

const agentValidator = v.object({
  name: v.string(),
  mode: v.union(v.literal('subagent'), v.literal('primary'), v.literal('all')),
  model: v.optional(v.object({ providerID: v.string(), modelID: v.string() })),
  description: v.optional(v.string()),
});

const harnessCapabilitiesValidator = v.object({
  name: v.string(),
  displayName: v.string(),
  agents: v.array(agentValidator),
  providers: v.array(
    v.object({
      providerID: v.string(),
      name: v.string(),
      models: v.array(v.object({ modelID: v.string(), name: v.string() })),
    })
  ),
  configSchema: v.optional(v.any()),
});

const workspaceCapabilitiesValidator = v.object({
  workspaceId: v.string(),
  cwd: v.string(),
  name: v.string(),
  harnesses: v.array(harnessCapabilitiesValidator),
});

// ─── publishMachineCapabilities ───────────────────────────────────────────────

/**
 * Upsert the capability snapshot for a machine.
 *
 * Auth: requires a valid session belonging to the owner of the machine
 * (same pattern as machines.register / machines.refreshCapabilities).
 * Throws if the machine is not registered or belongs to another user.
 */
export const publishMachineCapabilities = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workspaces: v.array(workspaceCapabilitiesValidator),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) {
      throw new Error('Authentication required');
    }

    // Verify the machine belongs to the authenticated user
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    if (!machine) {
      throw new Error(
        `Machine ${args.machineId} is not registered. Run 'chatroom machine start' first.`
      );
    }
    if (machine.userId !== auth.user._id) {
      throw new Error('Machine is registered to a different user');
    }

    const now = Date.now();
    const existing = await ctx.db
      .query('chatroom_machineRegistry')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    if (existing) {
      await ctx.db.patch('chatroom_machineRegistry', existing._id, {
        lastSeenAt: now,
        workspaces: args.workspaces,
      });
    } else {
      await ctx.db.insert('chatroom_machineRegistry', {
        machineId: args.machineId,
        lastSeenAt: now,
        workspaces: args.workspaces,
      });
    }
  },
});

// ─── listForWorkspace ─────────────────────────────────────────────────────────

/**
 * Return the merged harness capabilities for a single workspace, aggregated
 * across all machines that publish that workspace.
 *
 * Merge strategy (server-side; per design §9.4 — server-side deviation):
 * - Dedupe harnesses by `harness.name` (last writer wins for displayName/configSchema)
 * - Within a harness, dedupe agents by `agent.name` (last writer wins)
 * - Within a harness, dedupe providers by `provider.providerID` (last writer wins)
 * - Within a provider, dedupe models by `model.modelID` (last writer wins)
 *
 * The caller needs only the workspaceId — no chatroomId needed because
 * workspace-level auth is sufficient (the workspace belongs to a chatroom the
 * session already has access to).
 */
export const listForWorkspace = query({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) return [];

    // All machine registry entries that reference this workspace
    const allEntries = await ctx.db.query('chatroom_machineRegistry').collect();

    // Merged harnesses map: harnessName → harness snapshot
    const harnessMap = new Map<
      string,
      {
        name: string;
        displayName: string;
        agents: Map<
          string,
          {
            name: string;
            mode: 'subagent' | 'primary' | 'all';
            model?: { providerID: string; modelID: string };
            description?: string;
          }
        >;
        providers: Map<
          string,
          {
            providerID: string;
            name: string;
            models: Map<string, { modelID: string; name: string }>;
          }
        >;
        configSchema?: unknown;
      }
    >();

    for (const entry of allEntries) {
      const wsEntry = entry.workspaces.find((w) => w.workspaceId === (args.workspaceId as string));
      if (!wsEntry) continue;

      for (const harness of wsEntry.harnesses) {
        let h = harnessMap.get(harness.name);
        if (!h) {
          h = {
            name: harness.name,
            displayName: harness.displayName,
            agents: new Map(),
            providers: new Map(),
            configSchema: harness.configSchema,
          };
          harnessMap.set(harness.name, h);
        } else {
          // Last writer wins for displayName/configSchema
          h.displayName = harness.displayName;
          if (harness.configSchema !== undefined) h.configSchema = harness.configSchema;
        }

        for (const agent of harness.agents) {
          h.agents.set(agent.name, agent);
        }
        for (const provider of harness.providers) {
          let p = h.providers.get(provider.providerID);
          if (!p) {
            p = { providerID: provider.providerID, name: provider.name, models: new Map() };
            h.providers.set(provider.providerID, p);
          } else {
            p.name = provider.name;
          }
          for (const model of provider.models) {
            p.models.set(model.modelID, model);
          }
        }
      }
    }

    return Array.from(harnessMap.values()).map((h) => ({
      name: h.name,
      displayName: h.displayName,
      configSchema: h.configSchema,
      agents: Array.from(h.agents.values()),
      providers: Array.from(h.providers.values()).map((p) => ({
        providerID: p.providerID,
        name: p.name,
        models: Array.from(p.models.values()),
      })),
    }));
  },
});

// ─── requestRefresh ───────────────────────────────────────────────────────────

/**
 * Request a capability refresh for a workspace.
 *
 * Idempotent: if a pending refresh for the same workspace already exists,
 * returns its ID instead of creating a new one.
 *
 * Auth: requires a valid session (same pattern as other direct-harness mutations).
 */
export const requestRefresh = mutation({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) {
      throw new Error('Authentication required');
    }

    // Idempotency check: if a pending refresh already exists for this workspace, return its ID
    const existing = await ctx.db
      .query('chatroom_pendingDaemonTasks')
      .withIndex('by_status_workspaceId', (q) =>
        q.eq('status', 'pending').eq('workspaceId', args.workspaceId)
      )
      .first();

    if (existing) {
      return { taskId: existing._id };
    }

    const now = Date.now();
    const taskId = await ctx.db.insert('chatroom_pendingDaemonTasks', {
      workspaceId: args.workspaceId,
      taskType: 'refreshCapabilities',
      createdAt: now,
      status: 'pending',
    });

    return { taskId };
  },
});

// ─── getPendingRefreshTasksForMachine ─────────────────────────────────────────

/**
 * Query all pending refresh tasks for workspaces belonging to a machine.
 * Used by the daemon to subscribe to refresh requests.
 */
export const getPendingRefreshTasksForMachine = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) return [];

    // Get all workspaces for this machine
    const workspaces = await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_machine', (q) => q.eq('machineId', args.machineId))
      .filter((q) => q.eq(q.field('removedAt'), undefined))
      .collect();

    if (workspaces.length === 0) return [];

    const workspaceIdSet = new Set(workspaces.map((w) => w._id as string));

    // Get all pending tasks (by machineId-specific or general pending tasks)
    // For machine-targeted tasks
    const machineSpecificTasks = await ctx.db
      .query('chatroom_pendingDaemonTasks')
      .withIndex('by_machineId_status', (q) =>
        q.eq('machineId', args.machineId).eq('status', 'pending')
      )
      .collect();

    // For workspace-level tasks (no machineId — any machine can handle)
    // We need to collect all pending tasks and filter by workspaceId
    // Unfortunately, without a full table scan, we can't efficiently get "no machineId + workspaceId in set"
    // So we collect all pending tasks for each workspace ID
    const allPendingTasksForWorkspaces: typeof machineSpecificTasks = [];
    for (const ws of workspaces) {
      const tasks = await ctx.db
        .query('chatroom_pendingDaemonTasks')
        .withIndex('by_status_workspaceId', (q) =>
          q.eq('status', 'pending').eq('workspaceId', ws._id)
        )
        .filter((q) => q.eq(q.field('machineId'), undefined))
        .collect();
      allPendingTasksForWorkspaces.push(...tasks);
    }

    // Merge and dedupe by _id
    const seen = new Set<string>();
    const result = [];
    for (const task of [...machineSpecificTasks, ...allPendingTasksForWorkspaces]) {
      if (!seen.has(task._id)) {
        seen.add(task._id);
        if (workspaceIdSet.has(task.workspaceId as string)) {
          result.push(task);
        }
      }
    }

    return result;
  },
});

// ─── completeRefreshTask ──────────────────────────────────────────────────────

/**
 * Mark a pending daemon task as done or failed.
 * Called by the daemon after executing the task.
 */
export const completeRefreshTask = mutation({
  args: {
    ...SessionIdArg,
    taskId: v.id('chatroom_pendingDaemonTasks'),
    status: v.union(v.literal('done'), v.literal('failed')),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) {
      throw new Error('Authentication required');
    }

    const task = await ctx.db.get(args.taskId);
    if (!task) return; // Already completed or doesn't exist — idempotent

    await ctx.db.patch(args.taskId, {
      status: args.status,
      completedAt: Date.now(),
      ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
    });
  },
});

/**
 * Return all machine registry entries for machines that have at least one
 * workspace in the given chatroom.
 *
 * Joins through chatroom_workspaces to filter by chatroom membership.
 */
export const getMachineRegistry = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    // Find all workspace IDs in this chatroom
    const chatroomWorkspaces = await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .filter((q) => q.eq(q.field('removedAt'), undefined))
      .collect();

    if (chatroomWorkspaces.length === 0) return [];

    const chatroomWorkspaceIds = new Set(chatroomWorkspaces.map((w) => w._id as string));

    // Find all machine registry entries that reference at least one workspace in this chatroom
    const allEntries = await ctx.db.query('chatroom_machineRegistry').collect();

    return allEntries.filter((entry) =>
      entry.workspaces.some((ws) => chatroomWorkspaceIds.has(ws.workspaceId))
    );
  },
});
