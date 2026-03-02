/** Convex functions for machine registration, agent config, and remote command dispatch. */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { validateSession } from './auth/cliSessionAuth';
import { startAgent as startAgentUseCase } from '../src/domain/usecase/agent/start-agent';
import { stopAgent as stopAgentUseCase } from '../src/domain/usecase/agent/stop-agent';
import { ensureOnlyAgentForRole } from '../src/domain/usecase/agent/ensure-only-agent-for-role';
import { onAgentExited as onAgentExitedEvent } from '../src/events/agent/on-agent-exited';

// ─── Shared Helpers ──────────────────────────────────────────────────

/** Validates an absolute working directory path, rejecting unsafe characters. */
function validateWorkingDir(workingDir: string): void {
  if (!workingDir || workingDir.trim().length === 0) {
    throw new Error('Working directory cannot be empty');
  }

  if (workingDir.length > 1024) {
    throw new Error('Working directory path is too long (max 1024 characters)');
  }

  // Must be an absolute path
  if (!workingDir.startsWith('/')) {
    throw new Error('Working directory must be an absolute path (starting with /)');
  }

  // Reject null bytes
  if (workingDir.includes('\0')) {
    throw new Error('Working directory contains invalid characters (null byte)');
  }

  // Reject newlines / carriage returns
  if (/[\n\r]/.test(workingDir)) {
    throw new Error('Working directory must not contain newlines');
  }

  // Reject shell metacharacters that could enable injection
  // These have no legitimate use in directory paths
  const shellMetaChars = /[;|&$`(){}<>!#~\\]/;
  if (shellMetaChars.test(workingDir)) {
    throw new Error(
      'Working directory contains disallowed characters. ' +
        'Only alphanumeric characters, hyphens, underscores, dots, slashes, and spaces are allowed.'
    );
  }
}

/** Discriminated union of authentication results from getAuthenticatedUser. */
type AuthResult =
  | { isAuthenticated: true; user: Doc<'users'> }
  | { isAuthenticated: false; user: null };

/** Returns the authenticated user from a session, or null if unauthenticated. */
async function getAuthenticatedUser(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
): Promise<AuthResult> {
  const result = await validateSession(ctx, sessionId);
  if (!result.valid) {
    return { isAuthenticated: false, user: null };
  }
  const user = await ctx.db.get('users', result.userId);
  if (!user) {
    return { isAuthenticated: false, user: null };
  }
  return { isAuthenticated: true, user };
}

/**
 * Look up a machine by its machineId. Throws if not found.
 */
async function getMachineByMachineId(ctx: QueryCtx | MutationCtx, machineId: string) {
  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  if (!machine) {
    throw new Error('Machine not found');
  }
  return machine;
}

/**
 * Look up a machine and verify ownership. Throws if not found or not owned.
 */
async function getOwnedMachine(
  ctx: QueryCtx | MutationCtx,
  machineId: string,
  userId: Id<'users'>
) {
  const machine = await getMachineByMachineId(ctx, machineId);
  if (machine.userId !== userId) {
    throw new Error('Machine is registered to a different user');
  }
  return machine;
}

// Agent harness type validator (shared across functions)
const agentHarnessValidator = v.union(v.literal('opencode'), v.literal('pi'));

// ============================================================================
// MACHINE REGISTRATION
// ============================================================================

/** Registers or updates a machine record for the current user. */
// Harness version validator
const harnessVersionValidator = v.object({
  version: v.string(),
  major: v.number(),
});

export const register = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    hostname: v.string(),
    os: v.string(),
    availableHarnesses: v.array(agentHarnessValidator),
    harnessVersions: v.optional(v.record(v.string(), harnessVersionValidator)),
    availableModels: v.optional(v.record(v.string(), v.array(v.string()))),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }
    const user = auth.user;
    const now = Date.now();

    // Check if machine already exists
    const existing = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    if (existing) {
      // Verify ownership
      if (existing.userId !== user._id) {
        throw new Error('Machine is registered to a different user');
      }

      // Update existing machine
      await ctx.db.patch('chatroom_machines', existing._id, {
        hostname: args.hostname,
        os: args.os,
        availableHarnesses: args.availableHarnesses,
        harnessVersions: args.harnessVersions,
        availableModels: args.availableModels,
        lastSeenAt: now,
      });

      return { machineId: args.machineId, isNew: false };
    }

    // Create new machine registration
    await ctx.db.insert('chatroom_machines', {
      machineId: args.machineId,
      userId: user._id,
      hostname: args.hostname,
      os: args.os,
      availableHarnesses: args.availableHarnesses,
      harnessVersions: args.harnessVersions,
      availableModels: args.availableModels,
      registeredAt: now,
      lastSeenAt: now,
      daemonConnected: false,
    });

    return { machineId: args.machineId, isNew: true };
  },
});

// ============================================================================
// AGENT CONFIG MANAGEMENT
// ============================================================================

/** Upserts the agent configuration (harness, model, workingDir) for a machine+chatroom+role. */
export const updateAgentConfig = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    agentType: agentHarnessValidator,
    workingDir: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }
    const user = auth.user;
    await getOwnedMachine(ctx, args.machineId, user._id);

    // Sanitize workingDir before storing
    validateWorkingDir(args.workingDir);

    // Verify chatroom exists and user has access
    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom) {
      throw new Error('Chatroom not found');
    }

    if (chatroom.ownerId !== user._id) {
      throw new Error('Not authorized to access this chatroom');
    }

    const now = Date.now();

    // Check if config already exists
    const existing = await ctx.db
      .query('chatroom_machineAgentConfigs')
      .withIndex('by_machine_chatroom_role', (q) =>
        q.eq('machineId', args.machineId).eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .first();

    // Preserve existing model if the new value is undefined (e.g. get-next-task doesn't pass model)
    const resolvedModel = args.model ?? existing?.model;

    if (existing) {
      // Update existing config
      await ctx.db.patch('chatroom_machineAgentConfigs', existing._id, {
        agentType: args.agentType,
        workingDir: args.workingDir,
        model: resolvedModel,
        updatedAt: now,
      });
    } else {
      // Create new config
      await ctx.db.insert('chatroom_machineAgentConfigs', {
        machineId: args.machineId,
        chatroomId: args.chatroomId,
        role: args.role,
        agentType: args.agentType,
        workingDir: args.workingDir,
        model: resolvedModel,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

// ============================================================================
// QUERIES
// ============================================================================

/**
 * List all machines for the current user.
 */
export const listMachines = query({
  args: {
    ...SessionIdArg,
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      return { machines: [] };
    }
    const user = auth.user;

    const machines = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_userId', (q) => q.eq('userId', user._id))
      .collect();

    return {
      machines: machines.map((m) => ({
        machineId: m.machineId,
        hostname: m.hostname,
        os: m.os,
        availableHarnesses: m.availableHarnesses,
        harnessVersions: m.harnessVersions ?? {},
        availableModels: m.availableModels ?? {},
        daemonConnected: m.daemonConnected,
        lastSeenAt: m.lastSeenAt,
        registeredAt: m.registeredAt,
      })),
    };
  },
});

/** Returns agent configs for a chatroom, enriched with machine details. */
export const getAgentConfigs = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      return { configs: [] };
    }
    const user = auth.user;

    // Verify chatroom access
    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom || chatroom.ownerId !== user._id) {
      return { configs: [] };
    }

    // Get the user's machines for ownership filtering
    const userMachines = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_userId', (q) => q.eq('userId', user._id))
      .collect();
    const userMachineMap = new Map(userMachines.map((m) => [m.machineId, m]));

    const allConfigs = await ctx.db
      .query('chatroom_machineAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Filter to only configs for machines the user owns
    const userConfigs = allConfigs.filter((c) => userMachineMap.has(c.machineId));

    // Enrich configs with machine details (already fetched)
    const configsWithMachine = userConfigs.map((config) => {
      const machine = userMachineMap.get(config.machineId);
      return {
        machineId: config.machineId,
        hostname: machine?.hostname ?? 'Unknown',
        role: config.role,
        agentType: config.agentType,
        workingDir: config.workingDir,
        model: config.model,
        daemonConnected: machine?.daemonConnected ?? false,
        availableHarnesses: machine?.availableHarnesses ?? [],
        updatedAt: config.updatedAt,
        spawnedAgentPid: config.spawnedAgentPid,
        spawnedAt: config.spawnedAt,
      };
    });

    return { configs: configsWithMachine };
  },
});

/** Returns pending agent.requestStart, agent.requestStop, and daemon.ping events for a machine. */
export const getCommandEvents = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. Auth check
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) return { events: [] };

    // 2. Machine ownership check
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    if (!machine || machine.userId !== auth.user._id) return { events: [] };

    const now = Date.now();

    // 3. Fetch agent.requestStart events — deadline-filtered (not cursor-filtered)
    //    Ensures valid commands issued before a daemon restart are not skipped.
    const startEvents = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_machineId_type', (q) =>
        q.eq('machineId', args.machineId).eq('type', 'agent.requestStart')
      )
      .filter((q) => q.gt(q.field('deadline'), now))
      .order('asc')
      .collect();

    // 4. Fetch agent.requestStop events — deadline-filtered (not cursor-filtered)
    const stopEvents = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_machineId_type', (q) =>
        q.eq('machineId', args.machineId).eq('type', 'agent.requestStop')
      )
      .filter((q) => q.gt(q.field('deadline'), now))
      .order('asc')
      .collect();

    // 5. Fetch all daemon.ping events — no cursor, session dedup handled by daemon
    const pingEvents = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_machineId_type', (q) =>
        q.eq('machineId', args.machineId).eq('type', 'daemon.ping')
      )
      .order('asc')
      .collect();

    // 6. Merge and sort by _creationTime ascending
    const all = [...startEvents, ...stopEvents, ...pingEvents].sort((a, b) =>
      a._creationTime < b._creationTime ? -1 : 1
    );

    return { events: all };
  },
});

/** Returns the daemon.pong event for a machine that came after a given ping event. */
export const getDaemonPongEvent = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    afterEventId: v.optional(v.id('chatroom_eventStream')),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) return null;

    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    if (!machine || machine.userId !== auth.user._id) return null;

    const pongEvents = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_machineId_type', (q) =>
        q.eq('machineId', args.machineId).eq('type', 'daemon.pong')
      )
      .order('asc')
      .collect();

    const matching = args.afterEventId
      ? pongEvents.filter((e) => e._id > args.afterEventId!)
      : pongEvents;

    return matching.length > 0 ? matching[matching.length - 1] : null;
  },
});

/** Returns the latest event stream entry for a given chatroom+role, or null. */
export const getLatestAgentEvent = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Auth check
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) return null;

    // Verify chatroom access
    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom) return null;

    // Fetch the latest event for this chatroom+role using the index
    const event = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroomId_role', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .order('desc')
      .first();

    return event ?? null;
  },
});

/** Returns a map of role → latest event type for all specified roles in a chatroom. */
export const getLatestAgentEventsForChatroom = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    roles: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Auth check
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) return {};

    // Verify chatroom access
    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom) return {};

    // Fetch latest event for each role in parallel
    const results = await Promise.all(
      args.roles.map(async (role) => {
        const event = await ctx.db
          .query('chatroom_eventStream')
          .withIndex('by_chatroomId_role', (q) =>
            q.eq('chatroomId', args.chatroomId).eq('role', role)
          )
          .order('desc')
          .first();
        return { role, event: event ?? null };
      })
    );

    // Build role → latestEventType map (omit roles with no events)
    const eventMap: Record<string, string> = {};
    for (const { role, event } of results) {
      if (event !== null) {
        eventMap[role] = event.type;
      }
    }

    return eventMap;
  },
});

// ============================================================================
// COMMAND MANAGEMENT
// ============================================================================

/** Updates daemon connection status (connected or disconnected). */
export const updateDaemonStatus = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    connected: v.boolean(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }
    const user = auth.user;
    const machine = await getOwnedMachine(ctx, args.machineId, user._id);

    await ctx.db.patch('chatroom_machines', machine._id, {
      daemonConnected: args.connected,
      lastSeenAt: Date.now(),
    });

    return { success: true };
  },
});

/** Clears daemon status, spawned agent records, and participant records for a machine in one transaction. */
export const daemonShutdown = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }
    const machine = await getOwnedMachine(ctx, args.machineId, auth.user._id);

    // 1. Set daemon as disconnected
    await ctx.db.patch('chatroom_machines', machine._id, {
      daemonConnected: false,
      lastSeenAt: Date.now(),
    });

    // 2. Clear all spawnedAgent records for this machine
    const agentConfigs = await ctx.db
      .query('chatroom_machineAgentConfigs')
      .withIndex('by_machine_chatroom_role', (q) => q.eq('machineId', args.machineId))
      .collect();

    const now = Date.now();
    for (const config of agentConfigs) {
      if (config.spawnedAgentPid != null) {
        await ctx.db.patch('chatroom_machineAgentConfigs', config._id, {
          spawnedAgentPid: undefined,
          spawnedAt: undefined,
          updatedAt: now,
        });
      }
    }

    // 3. Delete participant records for agents on this machine
    for (const config of agentConfigs) {
      const participant = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', config.chatroomId).eq('role', config.role)
        )
        .unique();
      if (participant) {
        await ctx.db.delete('chatroom_participants', participant._id);
      }
    }

    return { clearedAgents: agentConfigs.length };
  },
});

/** Updates lastSeenAt for liveness detection; sets daemonConnected to true. */
export const daemonHeartbeat = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }
    const user = auth.user;
    const machine = await getOwnedMachine(ctx, args.machineId, user._id);

    await ctx.db.patch('chatroom_machines', machine._id, {
      lastSeenAt: Date.now(),
      daemonConnected: true, // Self-healing: recover from transient disconnect (Plan 026)
    });

    return { success: true };
  },
});

/** Dispatches a start-agent, stop-agent, or ping command to a machine on behalf of the user. */
export const sendCommand = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    type: v.union(
      v.literal('start-agent'),
      v.literal('stop-agent'),
      v.literal('ping'),
      v.literal('status')
    ),
    payload: v.optional(
      v.object({
        chatroomId: v.optional(v.id('chatroom_rooms')),
        role: v.optional(v.string()),
        model: v.optional(v.string()),
        // For first-time starts when no agent config exists:
        agentHarness: v.optional(agentHarnessValidator),
        workingDir: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }
    const user = auth.user;
    const machine = await getOwnedMachine(ctx, args.machineId, user._id);

    // Sanitize workingDir if provided in the payload
    if (args.payload?.workingDir) {
      validateWorkingDir(args.payload.workingDir);
    }

    // ── start-agent: resolve defaults then delegate to use case ────────
    if (args.type === 'start-agent' && args.payload?.chatroomId && args.payload?.role) {
      // Read existing config for fallback values when payload is incomplete
      const existingConfig = await ctx.db
        .query('chatroom_machineAgentConfigs')
        .withIndex('by_machine_chatroom_role', (q) =>
          q
            .eq('machineId', args.machineId)
            .eq('chatroomId', args.payload!.chatroomId!)
            .eq('role', args.payload!.role!)
        )
        .first();

      const resolvedModel = args.payload.model ?? existingConfig?.model;
      const resolvedHarness = (args.payload.agentHarness ?? existingConfig?.agentType) as
        | 'opencode'
        | 'pi'
        | undefined;
      const resolvedWorkingDir = args.payload.workingDir ?? existingConfig?.workingDir;

      if (!resolvedModel || !resolvedHarness || !resolvedWorkingDir) {
        throw new Error(
          'Cannot start agent: model, agentHarness, and workingDir are required. ' +
            'Provide them in the payload or ensure an existing config exists.'
        );
      }

      await startAgentUseCase(
        ctx,
        {
          machineId: args.machineId,
          chatroomId: args.payload.chatroomId,
          role: args.payload.role,
          userId: user._id,
          model: resolvedModel,
          agentHarness: resolvedHarness,
          workingDir: resolvedWorkingDir,
          reason: 'user-start',
        },
        machine
      );
      return {};
    }

    // ── stop-agent: delegate to use case ────────────────────────────────
    if (args.type === 'stop-agent' && args.payload?.chatroomId && args.payload?.role) {
      await stopAgentUseCase(ctx, {
        machineId: args.machineId,
        chatroomId: args.payload.chatroomId,
        role: args.payload.role,
        userId: user._id,
        reason: 'user-stop',
      });
      return {};
    }

    // ── ping / status: emit daemon.ping event to stream ───────────────
    const now = Date.now();
    const pingEventId = await ctx.db.insert('chatroom_eventStream', {
      type: 'daemon.ping',
      machineId: args.machineId,
      timestamp: now,
    });

    return { eventId: pingEventId };
  },
});

/** Records the PID of a spawned agent process in the machine agent config. */
export const updateSpawnedAgent = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    pid: v.optional(v.number()), // null to clear
    model: v.optional(v.string()), // Save model alongside PID for config persistence
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }
    await getOwnedMachine(ctx, args.machineId, auth.user._id);

    // Find the agent config
    const config = await ctx.db
      .query('chatroom_machineAgentConfigs')
      .withIndex('by_machine_chatroom_role', (q) =>
        q.eq('machineId', args.machineId).eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .first();

    if (!config) {
      throw new Error('Agent config not found');
    }

    const now = Date.now();

    // Update the spawned agent info (and model if provided)
    await ctx.db.patch('chatroom_machineAgentConfigs', config._id, {
      spawnedAgentPid: args.pid,
      spawnedAt: args.pid ? now : undefined,
      updatedAt: now,
      ...(args.model !== undefined ? { model: args.model } : {}),
    });

    return { success: true };
  },
});

/** Records an agent exit: writes agent.exited event, clears PID, removes participant, and schedules crash recovery if unintentional. */
export const recordAgentExited = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    pid: v.number(),
    intentional: v.boolean(),
    exitCode: v.optional(v.number()),
    signal: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Auth + machine ownership check
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) throw new Error('Authentication required');
    await getOwnedMachine(ctx, args.machineId, auth.user._id);

    const now = Date.now();

    // 2. Write agent.exited event to stream
    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.exited',
      chatroomId: args.chatroomId,
      role: args.role,
      machineId: args.machineId,
      pid: args.pid,
      intentional: args.intentional,
      exitCode: args.exitCode,
      signal: args.signal,
      timestamp: now,
    });

    // 3. Clear spawnedAgentPid from machine agent config
    const config = await ctx.db
      .query('chatroom_machineAgentConfigs')
      .withIndex('by_machine_chatroom_role', (q) =>
        q.eq('machineId', args.machineId).eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .first();
    if (config) {
      await ctx.db.patch('chatroom_machineAgentConfigs', config._id, {
        spawnedAgentPid: undefined,
        spawnedAt: undefined,
        updatedAt: now,
      });
    }

    // 4. Remove participant record so the UI shows the agent as offline
    const participant = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .unique();
    if (participant) {
      await ctx.db.delete('chatroom_participants', participant._id);
    }

    // 5. If unintentional crash, immediately schedule ensure-agent for any active task
    await onAgentExitedEvent(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
      intentional: args.intentional,
    });

    return { success: true };
  },
});

/** Writes a daemon.pong event in response to a daemon.ping event. */
export const ackPing = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    pingEventId: v.id('chatroom_eventStream'),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }

    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    if (!machine || machine.userId !== auth.user._id) {
      throw new Error('Machine not found or not owned by user');
    }

    await ctx.db.insert('chatroom_eventStream', {
      type: 'daemon.pong',
      machineId: args.machineId,
      pingEventId: args.pingEventId,
      timestamp: Date.now(),
    });
  },
});

// ============================================================================
// TEAM AGENT CONFIGS
// Team-level agent configuration for auto-restart decisions
// ============================================================================

/** Builds a unique key scoped to a chatroom+role for use in chatroom_teamAgentConfigs. */
function buildTeamRoleKey(chatroom: Doc<'chatroom_rooms'>, role: string): string {
  return `chatroom_${chatroom._id}#role_${role.toLowerCase()}`;
}

/** Upserts team agent configuration for a chatroom+role and emits an agent.registered event. */
export const saveTeamAgentConfig = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    type: v.union(v.literal('remote'), v.literal('custom')),
    // Remote-specific fields (expected when type === 'remote')
    machineId: v.optional(v.string()),
    agentHarness: v.optional(agentHarnessValidator),
    model: v.optional(v.string()),
    workingDir: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }

    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom) throw new Error('Chatroom not found');
    if (chatroom.ownerId !== auth.user._id) {
      throw new Error('Not authorized to modify team agent configs for this chatroom');
    }

    const teamRoleKey = buildTeamRoleKey(chatroom, args.role);

    // Upsert by teamRoleKey
    const existing = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
      .first();

    const now = Date.now();
    // Preserve existing model if the new value is undefined (e.g. register-agent doesn't pass model)
    const resolvedModel = args.type === 'remote' ? (args.model ?? existing?.model) : undefined;
    // Preserve existing agentHarness if the new value is undefined (e.g. register-agent doesn't pass agentHarness)
    const resolvedAgentHarness =
      args.type === 'remote' ? (args.agentHarness ?? existing?.agentHarness) : undefined;

    const config = {
      teamRoleKey,
      chatroomId: args.chatroomId,
      role: args.role,
      type: args.type,
      machineId: args.type === 'remote' ? args.machineId : undefined,
      agentHarness: resolvedAgentHarness,
      model: resolvedModel,
      workingDir: args.type === 'remote' ? args.workingDir : undefined,
      updatedAt: now,
      desiredState: 'running' as const,
    };

    if (existing) {
      await ctx.db.patch('chatroom_teamAgentConfigs', existing._id, config);
    } else {
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        ...config,
        createdAt: now,
      });
    }

    await ensureOnlyAgentForRole(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
      excludeMachineId: args.type === 'remote' ? args.machineId : undefined,
    });

    // Emit agent.registered event to the event stream
    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.registered',
      chatroomId: args.chatroomId,
      role: args.role,
      agentType: args.type,
      machineId: args.machineId,
      timestamp: now,
    });

    return { success: true };
  },
});

/** Returns all team-level agent configurations for a chatroom. */
export const getTeamAgentConfigs = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) return [];
    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom || chatroom.ownerId !== auth.user._id) return [];

    return await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
  },
});

// ─── Agent Preferences ────────────────────────────────────────────────────────

/** Upserts the user's preferred remote agent configuration (machine, harness, model, workingDir) for a chatroom+role. */
export const saveAgentPreference = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    machineId: v.string(),
    agentHarness: agentHarnessValidator,
    model: v.optional(v.string()),
    workingDir: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }

    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom) throw new Error('Chatroom not found');
    if (chatroom.ownerId !== auth.user._id) {
      throw new Error('Not authorized to save agent preferences for this chatroom');
    }

    const existing = await ctx.db
      .query('chatroom_agentPreferences')
      .withIndex('by_userId_chatroom_role', (q) =>
        q.eq('userId', auth.user._id).eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .first();

    const now = Date.now();
    const pref = {
      userId: auth.user._id,
      chatroomId: args.chatroomId,
      role: args.role,
      machineId: args.machineId,
      agentHarness: args.agentHarness,
      model: args.model,
      workingDir: args.workingDir,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch('chatroom_agentPreferences', existing._id, pref);
    } else {
      await ctx.db.insert('chatroom_agentPreferences', { ...pref, createdAt: now });
    }

    return { success: true };
  },
});

/** Returns the user's preferred agent configurations for all roles in a chatroom. */
export const getAgentPreferences = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) return [];
    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom || chatroom.ownerId !== auth.user._id) return [];

    return await ctx.db
      .query('chatroom_agentPreferences')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .filter((q) => q.eq(q.field('userId'), auth.user._id))
      .collect();
  },
});

/** Returns the model visibility filters for a machine+harness combination, or null if unconfigured. */
export const getMachineModelFilters = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    agentHarness: v.union(v.literal('opencode'), v.literal('pi')),
  },
  handler: async (ctx, args) => {
    const filter = await ctx.db
      .query('chatroom_machineModelFilters')
      .withIndex('by_machine_harness', (q) =>
        q.eq('machineId', args.machineId).eq('agentHarness', args.agentHarness)
      )
      .unique();
    return filter ?? null;
  },
});

/** Upserts model visibility filters (hidden models/providers) for a machine+harness combination. */
export const upsertMachineModelFilters = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    agentHarness: v.union(v.literal('opencode'), v.literal('pi')),
    hiddenModels: v.array(v.string()),
    hiddenProviders: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('chatroom_machineModelFilters')
      .withIndex('by_machine_harness', (q) =>
        q.eq('machineId', args.machineId).eq('agentHarness', args.agentHarness)
      )
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch('chatroom_machineModelFilters', existing._id, {
        hiddenModels: args.hiddenModels,
        hiddenProviders: args.hiddenProviders,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('chatroom_machineModelFilters', {
        machineId: args.machineId,
        agentHarness: args.agentHarness,
        hiddenModels: args.hiddenModels,
        hiddenProviders: args.hiddenProviders,
        updatedAt: now,
      });
    }
  },
});
