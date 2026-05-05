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
 * Return harness capabilities for a workspace.
 *
 * First checks the machine registry (populated when a harness boots) for rich
 * agent/provider details. Falls back to the machine's registered availableHarnesses
 * when no harness has booted yet — this lets users start a session even before
 * the first harness boots (agents/providers will be discovered during boot).
 *
 * @deprecated Web-facing endpoint — being replaced by daemon-orchestrated capability lifecycle.
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

    // Look up the workspace to find its owning machine
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) return [];

    // 1. Try the machine registry (rich agent/provider details from a booted harness)
    const registryEntry = await ctx.db
      .query('chatroom_machineRegistry')
      .withIndex('by_machineId', (q) => q.eq('machineId', workspace.machineId))
      .first();

    if (registryEntry) {
      const wsEntry = registryEntry.workspaces.find(
        (w) => w.workspaceId === (args.workspaceId as string)
      );
      if (wsEntry && (wsEntry.harnesses?.length ?? 0) > 0) {
        return (wsEntry.harnesses ?? []).map((h) => ({
          name: h.name,
          displayName: h.displayName,
          configSchema: h.configSchema,
          agents: h.agents,
          providers: h.providers,
        }));
      }
    }

    // 2. Fallback: use the machine's availableHarnesses from registration.
    //    Agents and providers are empty — they'll be discovered when the
    //    harness boots during the first session.
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', workspace.machineId))
      .first();

    if (!machine || !machine.availableHarnesses || machine.availableHarnesses.length === 0) {
      return [];
    }

    return machine.availableHarnesses.map((name) => ({
      name,
      displayName:
        name === 'opencode-sdk'
          ? 'Opencode'
          : name.charAt(0).toUpperCase() + name.slice(1),
      agents: [],
      providers: [],
    }));
  },
});






