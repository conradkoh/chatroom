/**
 * Machine capabilities mutations and queries for the direct-harness feature.
 *
 * publishMachineCapabilities is called by the daemon on startup and on
 * harness boot to keep the backend in sync with what workspaces and agents
 * are available on the machine.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from '../../_generated/server.js';
import { requireDirectHarnessWorkers } from './helpers.js';
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
      await ctx.db.patch(existing._id, {
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
