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

const workspaceCapabilitiesValidator = v.object({
  workspaceId: v.string(),
  cwd: v.string(),
  name: v.string(),
  agents: v.array(agentValidator),
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

// ─── getMachineRegistry ───────────────────────────────────────────────────────

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
