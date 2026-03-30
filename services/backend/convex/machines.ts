/** Convex functions for machine registration, agent config, and remote command dispatch. */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { validateSession } from './auth/cliSessionAuth';
import { agentHarnessValidator } from './schema';
import { agentStopReasonValidator } from '../src/domain/entities/agent';
import { buildTeamRoleKey, deleteStaleTeamAgentConfigs } from './utils/teamRoleKey';
import { transitionAgentStatus } from '../src/domain/usecase/agent/transition-agent-status';
import { ensureOnlyAgentForRole } from '../src/domain/usecase/agent/ensure-only-agent-for-role';
import { getAgentConfigForStart } from '../src/domain/usecase/agent/get-agent-config-for-start';
import { listChatroomAgentOverview } from '../src/domain/usecase/agent/list-chatroom-agent-overview';
import { startAgent as startAgentUseCase } from '../src/domain/usecase/agent/start-agent';
import { stopAgent as stopAgentUseCase } from '../src/domain/usecase/agent/stop-agent';
import { getAgentStatusForChatroom } from '../src/domain/usecase/chatroom/get-agent-statuses';
import { agentExited as agentExitedUseCase } from '../src/domain/usecase/agent/agent-exited';
import { getAssignedTasksForMachine } from '../src/domain/usecase/machine/get-assigned-tasks';
import { onAgentExited } from '../src/events/agent/on-agent-exited';

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

/** Sets or clears the user-defined alias for a machine. */
export const setMachineAlias = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    alias: v.optional(v.string()), // undefined or empty string to clear
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }
    const machine = await getOwnedMachine(ctx, args.machineId, auth.user._id);

    // Normalize: empty string or whitespace-only = clear alias
    const normalizedAlias = args.alias?.trim() || undefined;

    // Validate length
    if (normalizedAlias && normalizedAlias.length > 64) {
      throw new Error('Machine alias must be 64 characters or fewer');
    }

    await ctx.db.patch('chatroom_machines', machine._id, {
      alias: normalizedAlias,
    });

    return { success: true };
  },
});

/**
 * Patch mutable capabilities on an already-registered machine.
 * Used by the daemon's periodic refresh loop — only updates fields that
 * can change at runtime (harnesses, models). Fails if the machine has
 * not been registered via `register` first.
 */
export const refreshCapabilities = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
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

    const existing = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    if (!existing) {
      throw new Error('Machine not registered. Run `chatroom machine start` first.');
    }
    if (existing.userId !== user._id) {
      throw new Error('Machine is registered to a different user');
    }

    await ctx.db.patch('chatroom_machines', existing._id, {
      availableHarnesses: args.availableHarnesses,
      harnessVersions: args.harnessVersions,
      availableModels: args.availableModels,
      lastSeenAt: Date.now(),
    });
  },
});

// ============================================================================
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
        alias: m.alias,
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

/** Returns daemon connectivity status for a specific machine. Used by the webapp to detect daemon presence via Convex instead of localhost HTTP. */
export const getDaemonStatus = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      return { connected: false, lastSeenAt: null };
    }

    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    if (!machine || machine.userId !== auth.user._id) {
      return { connected: false, lastSeenAt: null };
    }

    return {
      connected: machine.daemonConnected,
      lastSeenAt: machine.lastSeenAt,
    };
  },
});

/** Returns machine-level agent configs for a chatroom, enriched with machine details. */
export const getMachineAgentConfigs = query({
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
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Filter to only configs for the CURRENT team and machines the user owns.
    // Stale configs from old teams (after a team switch) must be excluded to
    // prevent the UI from seeing spawnedAgentPid on old-team configs.
    const currentTeamId = chatroom.teamId;
    const userConfigs = allConfigs.filter((c) => {
      if (!c.machineId || !userMachineMap.has(c.machineId)) return false;
      // Only include configs for the current team
      if (currentTeamId && c.teamRoleKey) {
        return c.teamRoleKey.includes(`#team_${currentTeamId}#`);
      }
      return true;
    });

    const configsWithMachine = userConfigs.map((config) => {
      const machine = userMachineMap.get(config.machineId!);
      return {
        machineId: config.machineId!,
        hostname: machine?.hostname ?? 'Unknown',
        alias: machine?.alias,
        role: config.role,
        agentType: config.agentHarness,
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

    // 6. Fetch daemon.gitRefresh events — session dedup handled by daemon, idempotent
    const gitRefreshEvents = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_machineId_type', (q) =>
        q.eq('machineId', args.machineId).eq('type', 'daemon.gitRefresh')
      )
      .order('asc')
      .collect();

    // 5b. Local action events (open-vscode, open-finder, etc.)
    const localActionEvents = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_machineId_type', (q) =>
        q.eq('machineId', args.machineId).eq('type', 'daemon.localAction')
      )
      .order('asc')
      .collect();

    // 7. Merge and sort by _creationTime ascending
    const all = [...startEvents, ...stopEvents, ...pingEvents, ...gitRefreshEvents, ...localActionEvents].sort((a, b) =>
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

/**
 * @deprecated Frontend now reads agent status from participant.lastStatus.
 * Retained for backward compatibility and debugging.
 * Returns the latest event stream entry for a given chatroom+role, or null.
 */
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

/**
 * @deprecated Frontend now reads agent status from participant.lastStatus.
 * Retained for backward compatibility and debugging.
 * Returns a map of role → latest event type for all specified roles in a chatroom.
 */
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

    // Fetch latest event + team config for each role in parallel
    const results = await Promise.all(
      args.roles.map(async (role) => {
        const event = await ctx.db
          .query('chatroom_eventStream')
          .withIndex('by_chatroomId_role', (q) =>
            q.eq('chatroomId', args.chatroomId).eq('role', role)
          )
          .order('desc')
          .first();
        let teamConfig: Doc<'chatroom_teamAgentConfigs'> | null = null;
        if (chatroom?.teamId) {
          const teamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, role);
          teamConfig = await ctx.db
            .query('chatroom_teamAgentConfigs')
            .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
            .first();
        }
        return {
          role,
          event: event ?? null,
          desiredState: teamConfig?.desiredState ?? null,
        };
      })
    );

    // Build role → { latestEventType, desiredState } map
    // Roles with no events are omitted from the map.
    const eventMap: Record<string, { eventType: string; desiredState: string | null }> = {};
    for (const { role, event, desiredState } of results) {
      if (event !== null) {
        eventMap[role] = { eventType: event.type, desiredState };
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

/**
 * Dispatches a local action (open-vscode, open-finder, open-github-desktop) to a machine
 * via the Convex event stream, avoiding direct localhost HTTP calls from the browser.
 * This fixes Safari's mixed-content blocking of http://localhost from HTTPS pages.
 */
export const sendLocalAction = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    action: v.union(
      v.literal('open-vscode'),
      v.literal('open-finder'),
      v.literal('open-github-desktop')
    ),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }
    const user = auth.user;
    await getOwnedMachine(ctx, args.machineId, user._id);

    validateWorkingDir(args.workingDir);

    await ctx.db.insert('chatroom_eventStream', {
      type: 'daemon.localAction',
      machineId: args.machineId,
      action: args.action,
      workingDir: args.workingDir,
      timestamp: Date.now(),
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
        // For stop-agent: optional reason (defaults to 'user.stop')
        reason: v.optional(agentStopReasonValidator),
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
      const cmdChatroom = await ctx.db.get('chatroom_rooms', args.payload.chatroomId);
      let existingConfig: Doc<'chatroom_teamAgentConfigs'> | null = null;
      if (cmdChatroom?.teamId) {
        const teamRoleKey = buildTeamRoleKey(
          cmdChatroom._id,
          cmdChatroom.teamId,
          args.payload.role
        );
        existingConfig = await ctx.db
          .query('chatroom_teamAgentConfigs')
          .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
          .first();
      }

      const resolvedModel =
        args.payload.model ??
        (existingConfig?.type === 'remote' ? existingConfig.model : undefined);
      const resolvedHarness =
        args.payload.agentHarness ??
        (existingConfig?.type === 'remote' ? existingConfig.agentHarness : undefined);
      const resolvedWorkingDir =
        args.payload.workingDir ??
        (existingConfig?.type === 'remote' ? existingConfig.workingDir : undefined);

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
          reason: 'user.start',
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
        reason: args.payload.reason ?? 'user.stop',
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
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }
    await getOwnedMachine(ctx, args.machineId, auth.user._id);

    // Find the agent config
    const spawnChatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!spawnChatroom?.teamId) {
      throw new Error('Chatroom has no teamId — cannot look up agent config');
    }
    const spawnTeamRoleKey = buildTeamRoleKey(spawnChatroom._id, spawnChatroom.teamId, args.role);
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', spawnTeamRoleKey))
      .first();

    if (!config || config.machineId !== args.machineId) {
      throw new Error('Agent config not found');
    }

    const now = Date.now();

    await ctx.db.patch('chatroom_teamAgentConfigs', config._id, {
      spawnedAgentPid: args.pid,
      spawnedAt: args.pid ? now : undefined,
      updatedAt: now,
      ...(args.model !== undefined ? { model: args.model } : {}),
    });

    // Write agent.started event and increment restart metric when a new agent is spawning
    if (args.pid != null) {
      // 1. Write agent.started event to event stream
      const harness = config.agentHarness ?? 'opencode';
      const configWorkingDir = config.workingDir ?? '/unknown';
      await ctx.db.insert('chatroom_eventStream', {
        type: 'agent.started',
        chatroomId: args.chatroomId,
        role: args.role,
        machineId: args.machineId,
        agentHarness: harness,
        model: args.model ?? config.model ?? 'unknown',
        workingDir: configWorkingDir,
        pid: args.pid,
        reason: args.reason,
        timestamp: now,
      });

      await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.started');

      // 2. Upsert restart metric for this hour bucket
      const model = args.model ?? config.model ?? 'unknown';
      const agentType = harness as string;
      const workingDir = configWorkingDir;
      const hourBucket = Math.floor(now / 3_600_000) * 3_600_000;

      const existingMetric = await ctx.db
        .query('chatroom_agentRestartMetrics')
        .withIndex('by_machine_role_hour', (q) =>
          q.eq('machineId', args.machineId).eq('role', args.role).eq('hourBucket', hourBucket)
        )
        .filter((q) =>
          q.and(
            q.eq(q.field('chatroomId'), args.chatroomId),
            q.eq(q.field('model'), model),
            q.eq(q.field('workingDir'), workingDir),
            q.eq(q.field('agentType'), agentType)
          )
        )
        .first();

      if (existingMetric) {
        await ctx.db.patch('chatroom_agentRestartMetrics', existingMetric._id, {
          count: existingMetric.count + 1,
        });
      } else {
        await ctx.db.insert('chatroom_agentRestartMetrics', {
          machineId: args.machineId,
          role: args.role,
          chatroomId: args.chatroomId,
          workingDir,
          model,
          agentType,
          hourBucket,
          count: 1,
        });
      }
    }

    return { success: true };
  },
});

/** Records an agent exit: emits agent.exited event, clears PID, removes participant, and schedules crash recovery if unintentional. */
export const recordAgentExited = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    pid: v.number(),
    stopReason: v.optional(v.string()),
    stopSignal: v.optional(v.string()),
    exitCode: v.optional(v.number()),
    signal: v.optional(v.string()),
    agentHarness: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Auth + machine ownership check
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) throw new Error('Authentication required');
    await getOwnedMachine(ctx, args.machineId, auth.user._id);

    // 2. Delegate to the agentExited use case (event insert + PID-gated cleanup + participant update)
    await agentExitedUseCase(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
      machineId: args.machineId,
      pid: args.pid,
      stopReason: args.stopReason,
      exitCode: args.exitCode,
      signal: args.signal,
      stopSignal: args.stopSignal,
      agentHarness: args.agentHarness,
    });

    // 3. Trigger crash recovery (no-op hook for future observability)
    await onAgentExited(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
      stopReason: args.stopReason,
      agentHarness: args.agentHarness,
    });

    return { success: true };
  },
});

/** Emits an agent.registered event to the event stream when an agent registers via the CLI. */
export const recordAgentRegistered = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    agentType: v.union(v.literal('remote'), v.literal('custom')),
    machineId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }

    // Verify chatroom access
    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom || chatroom.ownerId !== auth.user._id) {
      throw new Error('Chatroom not found or access denied');
    }

    const now = Date.now();
    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.registered',
      chatroomId: args.chatroomId,
      role: args.role,
      agentType: args.agentType,
      machineId: args.machineId,
      timestamp: now,
    });
    await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.registered');

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

/**
 * Requests an immediate git state refresh for a workspace.
 *
 * Inserts a daemon.gitRefresh event into chatroom_eventStream.
 * The daemon receives it via its live WebSocket subscription and responds
 * by re-running pushGitState for the specified workspace.
 */
export const requestGitRefresh = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }
    const user = auth.user;
    await getOwnedMachine(ctx, args.machineId, user._id);

    await ctx.db.insert('chatroom_eventStream', {
      type: 'daemon.gitRefresh',
      machineId: args.machineId,
      workingDir: args.workingDir,
      timestamp: Date.now(),
    });
  },
});

// ============================================================================
// TEAM AGENT CONFIGS
// Team-level agent configuration for auto-restart decisions
// ============================================================================

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

    if (!chatroom.teamId) {
      throw new ConvexError('Chatroom has no teamId — cannot build agent config key');
    }
    const teamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, args.role);

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
      await deleteStaleTeamAgentConfigs(ctx, teamRoleKey);
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
    await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.registered', 'running');

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

/** Returns the model visibility filters for a machine+harness combination, or null if unconfigured. */
export const getMachineModelFilters = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    agentHarness: agentHarnessValidator,
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
    agentHarness: agentHarnessValidator,
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

/** Returns the remote agent running status for every chatroom owned by the authenticated user. */
export const listRemoteAgentRunningStatus = query({
  args: { ...SessionIdArg },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) return [];

    const userMachines = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_userId', (q) => q.eq('userId', auth.user._id))
      .collect();
    const userMachineIds = new Set(userMachines.map((m) => m.machineId));

    const userChatrooms = await ctx.db
      .query('chatroom_rooms')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', auth.user._id))
      .collect();

    const results = await Promise.all(
      userChatrooms.map(async (room) => {
        const configs = await ctx.db
          .query('chatroom_teamAgentConfigs')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', room._id))
          .collect();

        const userConfigs = configs.filter((c) => c.machineId && userMachineIds.has(c.machineId));

        const runningConfigs = userConfigs
          .filter((c) => c.spawnedAgentPid != null)
          .map((c) => ({ machineId: c.machineId!, role: c.role }));

        const remoteAgentStatus: 'running' | 'stopped' | 'none' =
          userConfigs.length === 0 ? 'none' : runningConfigs.length > 0 ? 'running' : 'stopped';

        return {
          chatroomId: room._id as Id<'chatroom_rooms'>,
          remoteAgentStatus,
          runningConfigs,
        };
      })
    );

    return results;
  },
});

/** Returns hourly agent restart counts grouped by harness+model for the given machine/role and time range.
 *
 * Scope modes (mutually exclusive; checked in order):
 *   1. chatroomId provided  → "this chatroom" scope
 *   2. workingDir provided  → "workspace" scope (machineId + workingDir)
 *   3. neither              → "machine-wide" scope (all chatrooms for machineId + role)
 *
 * Returns array sorted by hourBucket ascending. Each element:
 *   { hourBucket: number, byHarnessModel: Record<string, number> }
 *   where hourBucket is the UTC ms timestamp of the start of the hour.
 *   Keys are formatted as "agentType/model" (e.g. "pi/claude-sonnet").
 */
export const getAgentRestartMetrics = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    role: v.string(),
    chatroomId: v.optional(v.id('chatroom_rooms')),
    workingDir: v.optional(v.string()),
    startTime: v.number(),
    endTime: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) return [];

    let startHour = Math.floor(args.startTime / 3_600_000) * 3_600_000;
    const endHour = Math.floor(args.endTime / 3_600_000) * 3_600_000;

    const maxRange = 720 * 3_600_000; // 30 days
    if (endHour - startHour > maxRange) {
      startHour = endHour - maxRange;
    }

    let rows: Doc<'chatroom_agentRestartMetrics'>[];

    if (args.chatroomId != null) {
      rows = await ctx.db
        .query('chatroom_agentRestartMetrics')
        .withIndex('by_chatroom_role_hour', (q) =>
          q.eq('chatroomId', args.chatroomId!).eq('role', args.role).gte('hourBucket', startHour)
        )
        .filter((q) =>
          q.and(q.eq(q.field('machineId'), args.machineId), q.lte(q.field('hourBucket'), endHour))
        )
        .collect();
    } else if (args.workingDir != null) {
      rows = await ctx.db
        .query('chatroom_agentRestartMetrics')
        .withIndex('by_workspace_role_hour', (q) =>
          q
            .eq('machineId', args.machineId)
            .eq('workingDir', args.workingDir!)
            .eq('role', args.role)
            .gte('hourBucket', startHour)
        )
        .filter((q) => q.lte(q.field('hourBucket'), endHour))
        .collect();
    } else {
      rows = await ctx.db
        .query('chatroom_agentRestartMetrics')
        .withIndex('by_machine_role_hour', (q) =>
          q.eq('machineId', args.machineId).eq('role', args.role).gte('hourBucket', startHour)
        )
        .filter((q) => q.lte(q.field('hourBucket'), endHour))
        .collect();
    }

    const bucketMap = new Map<number, Record<string, number>>();
    for (const row of rows) {
      const existing = bucketMap.get(row.hourBucket) ?? {};
      const key = `${row.agentType ?? 'unknown'}/${row.model}`;
      existing[key] = (existing[key] ?? 0) + row.count;
      bucketMap.set(row.hourBucket, existing);
    }

    return Array.from(bucketMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([hourBucket, byHarnessModel]) => ({ hourBucket, byHarnessModel }));
  },
});

/** Returns total agent restart counts for the last 1h and 24h,
 *  scoped to a specific chatroom + role + machineId.
 *  Used for the compact inline stats row shown per agent in the panel.
 */
export const getAgentRestartSummary = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    role: v.string(),
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) return { count1h: 0, count24h: 0 };

    const now = Date.now();
    const since1h = Math.floor((now - 3_600_000) / 3_600_000) * 3_600_000;
    const since24h = Math.floor((now - 24 * 3_600_000) / 3_600_000) * 3_600_000;

    // Query rows for chatroom + role starting from 24h ago
    const rows = await ctx.db
      .query('chatroom_agentRestartMetrics')
      .withIndex('by_chatroom_role_hour', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role).gte('hourBucket', since24h)
      )
      .filter((q) => q.eq(q.field('machineId'), args.machineId))
      .collect();

    let count1h = 0;
    let count24h = 0;
    for (const row of rows) {
      count24h += row.count;
      if (row.hourBucket >= since1h) {
        count1h += row.count;
      }
    }

    return { count1h, count24h };
  },
});

/** Returns restart summary for an agent role within a chatroom, aggregated across all machines. */
export const getAgentRestartSummaryByRole = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) return { count1h: 0, count24h: 0 };

    const now = Date.now();
    const since1h = Math.floor((now - 3_600_000) / 3_600_000) * 3_600_000;
    const since24h = Math.floor((now - 24 * 3_600_000) / 3_600_000) * 3_600_000;

    // Query rows for chatroom + role starting from 24h ago (all machines)
    const rows = await ctx.db
      .query('chatroom_agentRestartMetrics')
      .withIndex('by_chatroom_role_hour', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role).gte('hourBucket', since24h)
      )
      .collect();

    let count1h = 0;
    let count24h = 0;
    for (const row of rows) {
      count24h += row.count;
      if (row.hourBucket >= since1h) {
        count1h += row.count;
      }
    }

    return { count1h, count24h };
  },
});

/** Returns restart summaries for multiple agent roles within a chatroom, aggregated across all machines.
 * This batch query allows parent components to fetch all restart stats in a single subscription
 * instead of N subscriptions for N visible InlineAgentCard components.
 */
export const getAgentRestartSummariesByRoles = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    roles: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      return args.roles.map((role) => ({ role, count1h: 0, count24h: 0 }));
    }

    const now = Date.now();
    const since1h = Math.floor((now - 3_600_000) / 3_600_000) * 3_600_000;
    const since24h = Math.floor((now - 24 * 3_600_000) / 3_600_000) * 3_600_000;

    // Query each role individually and aggregate (parallel queries are automatic in Convex)
    // This is more efficient than N separate useSessionQuery calls in the frontend.
    const roleCounts = new Map<string, { count1h: number; count24h: number }>();

    for (const role of args.roles) {
      const rows = await ctx.db
        .query('chatroom_agentRestartMetrics')
        .withIndex('by_chatroom_role_hour', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('role', role).gte('hourBucket', since24h)
        )
        .collect();

      let count1h = 0;
      let count24h = 0;
      for (const row of rows) {
        count24h += row.count;
        if (row.hourBucket >= since1h) {
          count1h += row.count;
        }
      }
      roleCounts.set(role, { count1h, count24h });
    }

    // Return summaries for all requested roles (missing roles get 0 counts)
    return args.roles.map((role) => ({
      role,
      ...(roleCounts.get(role) ?? { count1h: 0, count24h: 0 }),
    }));
  },
});

// ============================================================================
// NEW QUERIES — Phase 3 (use-case wrappers)
// ============================================================================

/** Returns a role-centric view of agent status for a chatroom, merging team + machine configs. */
export const getAgentStatus = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) return null;

    return getAgentStatusForChatroom(ctx, {
      chatroomId: args.chatroomId,
      userId: auth.user._id,
    });
  },
});

/** Returns the data needed to populate the "Start Agent" form for a specific role. */
export const getAgentStartConfig = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) return null;

    return getAgentConfigForStart(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
      userId: auth.user._id,
    });
  },
});

/** Returns a per-chatroom summary of agent status for all chatrooms owned by the user. */
export const listAgentOverview = query({
  args: {
    ...SessionIdArg,
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) return [];

    return listChatroomAgentOverview(ctx, {
      userId: auth.user._id,
    });
  },
});

// ============================================================================
// DAEMON TASK MONITOR
// Used by the daemon to subscribe to all tasks assigned to roles on this machine.
// ============================================================================

/**
 * Returns all active tasks for chatrooms where this machine has remote agent configs.
 * Used by the daemon's task monitor to decide when to start/restart agents.
 *
 * For each active task, includes:
 * - Task info (taskId, chatroomId, status, assignedTo, updatedAt, createdAt)
 * - Relevant agent config (machineId, agentHarness, model, workingDir, spawnedAgentPid, desiredState, circuitState)
 */
export const getAssignedTasks = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) return { tasks: [] };

    return getAssignedTasksForMachine(ctx, {
      machineId: args.machineId,
      userId: auth.user._id,
    });
  },
});

// ============================================================================
// DAEMON OBSERVABILITY EVENTS
// Emitted by the daemon to report agent lifecycle events to the event stream.
// ============================================================================

/** Emits an agent.startFailed event when the daemon fails to spawn an agent. */
export const emitAgentStartFailed = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) throw new Error('Authentication required');
    await getOwnedMachine(ctx, args.machineId, auth.user._id);

    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.startFailed',
      chatroomId: args.chatroomId,
      role: args.role,
      machineId: args.machineId,
      error: args.error,
      timestamp: Date.now(),
    });

    // Update participant status so the UI reflects the failure
    await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.startFailed', 'stopped');

    // Reset desiredState to 'stopped' so AgentRoleView.state doesn't stay stuck at 'starting'
    const failedChatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (failedChatroom?.teamId) {
      const failedTeamRoleKey = buildTeamRoleKey(
        failedChatroom._id,
        failedChatroom.teamId,
        args.role
      );
      const failedConfig = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', failedTeamRoleKey))
        .first();
      if (failedConfig) {
        await ctx.db.patch('chatroom_teamAgentConfigs', failedConfig._id, {
          desiredState: 'stopped',
          updatedAt: Date.now(),
        });
      }
    }

    return { success: true };
  },
});

/** Emits an agent.restartLimitReached event when crash loop protection triggers. */
export const emitRestartLimitReached = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    restartCount: v.number(),
    windowMs: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) throw new Error('Authentication required');
    await getOwnedMachine(ctx, args.machineId, auth.user._id);

    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.restartLimitReached',
      chatroomId: args.chatroomId,
      role: args.role,
      machineId: args.machineId,
      restartCount: args.restartCount,
      windowMs: args.windowMs,
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Clears spawnedAgentPid on ALL teamAgentConfigs for a machine.
 * Called by the daemon on startup — since the daemon just started fresh,
 * no agents are running on this machine. Stale PIDs from before the restart
 * must be cleared to prevent the UI from showing dead agents as "running".
 *
 * Also updates participant lastStatus to 'agent.exited' for any configs
 * that had a PID, so the UI status label is correct.
 */
export const clearAllSpawnedPids = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) throw new Error('Authentication required');
    await getOwnedMachine(ctx, args.machineId, auth.user._id);

    // Find all configs for this machine that have a spawnedAgentPid
    const allConfigs = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .collect();

    const now = Date.now();
    let clearedCount = 0;

    for (const config of allConfigs) {
      if (config.spawnedAgentPid != null) {
        await ctx.db.patch('chatroom_teamAgentConfigs', config._id, {
          spawnedAgentPid: undefined,
          spawnedAt: undefined,
          updatedAt: now,
        });

        // Update participant status so the UI doesn't show "STARTING" or "WORKING"
        await transitionAgentStatus(ctx, config.chatroomId, config.role, 'agent.exited', undefined);

        clearedCount++;
      }
    }

    return { clearedCount };
  },
});
