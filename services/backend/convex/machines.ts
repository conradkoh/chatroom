/**
 * Machine Management Module
 *
 * Handles machine registration, agent config sync, and remote command dispatch.
 * Enables users to remotely start agents on their registered machines.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { validateSession } from './auth/cliSessionAuth';

// ─── Shared Helpers ──────────────────────────────────────────────────

/**
 * Validate a working directory path to prevent shell injection and path traversal.
 *
 * Rejects:
 * - Non-absolute paths (must start with /)
 * - Null bytes (\0)
 * - Shell metacharacters (;, |, &, $, `, (, ), {, }, <, >, !, #, ~)
 * - Command substitution patterns ($(...), `...`)
 * - Newlines and carriage returns
 * - Excessively long paths (>1024 chars)
 *
 * Note: The CLI daemon also validates that the directory exists on the local
 * filesystem before spawning an agent, providing defense-in-depth.
 */
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

/**
 * Authentication result returned by getAuthenticatedUser.
 *
 * Uses a discriminated union so callers can narrow the type:
 *   const auth = await getAuthenticatedUser(ctx, sessionId);
 *   if (!auth.isAuthenticated) return ...;  // handle gracefully
 *   auth.user;  // TypeScript narrows to Doc<'users'>
 */
type AuthResult =
  | { isAuthenticated: true; user: Doc<'users'> }
  | { isAuthenticated: false; user: null };

/**
 * Get authenticated user from session.
 *
 * Returns a value object instead of throwing, allowing callers to handle
 * auth failures gracefully (e.g., return empty data for queries, or
 * throw their own error for mutations).
 */
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
const agentHarnessValidator = v.literal('opencode');

// ============================================================================
// MACHINE REGISTRATION
// ============================================================================

/**
 * Register or update a machine.
 *
 * Called by CLI on every wait-for-task startup.
 * Creates new machine record or updates existing one.
 */
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
    availableModels: v.optional(v.array(v.string())),
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

/**
 * Update agent configuration for a chatroom+role on a machine.
 *
 * Called by CLI when wait-for-task starts.
 * Stores the working directory and agent type for remote restarts.
 */
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

    // Preserve existing model if the new value is undefined (e.g. wait-for-task doesn't pass model)
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
        availableModels: m.availableModels ?? [],
        daemonConnected: m.daemonConnected,
        lastSeenAt: m.lastSeenAt,
        registeredAt: m.registeredAt,
      })),
    };
  },
});

/**
 * Get agent configs for a specific chatroom.
 * Shows which machines have configs for which roles.
 */
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

/**
 * Get pending commands for a machine (daemon subscribes to this).
 */
export const getPendingCommands = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      return { commands: [] };
    }
    const user = auth.user;

    // Verify machine ownership
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    if (!machine || machine.userId !== user._id) {
      return { commands: [] };
    }

    // Get pending commands
    const commands = await ctx.db
      .query('chatroom_machineCommands')
      .withIndex('by_machineId_status', (q) =>
        q.eq('machineId', args.machineId).eq('status', 'pending')
      )
      .collect();

    // Ensure FIFO processing order
    commands.sort((a, b) => a.createdAt - b.createdAt);

    return {
      commands: commands.map((cmd) => ({
        _id: cmd._id,
        type: cmd.type,
        payload: cmd.payload,
        createdAt: cmd.createdAt,
      })),
    };
  },
});

/**
 * Get the status of a specific command.
 * Used by the frontend to reactively watch ping/command results.
 */
export const getCommandStatus = query({
  args: {
    ...SessionIdArg,
    commandId: v.id('chatroom_machineCommands'),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) return null;

    const command = await ctx.db.get('chatroom_machineCommands', args.commandId);
    if (!command) return null;

    // Verify the user owns the machine
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', command.machineId))
      .first();
    if (!machine || machine.userId !== auth.user._id) return null;

    return {
      status: command.status,
      result: command.result,
      type: command.type,
      createdAt: command.createdAt,
      processedAt: command.processedAt,
    };
  },
});

// ============================================================================
// COMMAND MANAGEMENT
// ============================================================================

/**
 * Update daemon connection status.
 * Called by daemon on connect/disconnect.
 */
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

/**
 * Daemon heartbeat — update lastSeenAt for liveness detection.
 * Called periodically by the daemon to prove it is still alive.
 * If the daemon crashes (e.g. SIGKILL), heartbeats stop and the backend
 * can detect the stale daemon via DAEMON_HEARTBEAT_TTL_MS.
 */
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
 * Send a command to a machine (from web UI).
 * Only the machine owner can send commands.
 *
 * For start-agent commands: if no agent config exists for this chatroom/role/machine,
 * the payload must include agentHarness and workingDir to create one on-the-fly.
 */
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

    // For start-agent commands, resolve the agent harness and working directory from config or payload
    let agentHarness: 'opencode' | undefined;
    let resolvedWorkingDir: string | undefined;

    if (args.type === 'start-agent' && args.payload?.chatroomId && args.payload?.role) {
      const config = await ctx.db
        .query('chatroom_machineAgentConfigs')
        .withIndex('by_machine_chatroom_role', (q) =>
          q
            .eq('machineId', args.machineId)
            .eq('chatroomId', args.payload!.chatroomId!)
            .eq('role', args.payload!.role!)
        )
        .first();

      if (config) {
        // Use existing config's agent type (payload agentHarness overrides if provided)
        agentHarness = (args.payload.agentHarness ?? config.agentType) as typeof agentHarness;
        // Resolve working directory: payload overrides config
        resolvedWorkingDir = args.payload.workingDir ?? config.workingDir;

        // Update config if payload provides new values
        const updates: Record<string, unknown> = { updatedAt: Date.now() };
        if (args.payload.agentHarness) updates.agentType = args.payload.agentHarness;
        if (args.payload.workingDir) updates.workingDir = args.payload.workingDir;
        if (args.payload.model !== undefined) updates.model = args.payload.model;
        if (Object.keys(updates).length > 1) {
          await ctx.db.patch('chatroom_machineAgentConfigs', config._id, updates);
        }
      } else if (args.payload.agentHarness && args.payload.workingDir) {
        // No existing config — create one on-the-fly from payload
        agentHarness = args.payload.agentHarness;
        resolvedWorkingDir = args.payload.workingDir;
        await ctx.db.insert('chatroom_machineAgentConfigs', {
          machineId: args.machineId,
          chatroomId: args.payload.chatroomId,
          role: args.payload.role,
          agentType: args.payload.agentHarness,
          workingDir: args.payload.workingDir,
          model: args.payload.model,
          updatedAt: Date.now(),
        });
      } else {
        throw new Error(
          'No agent config found. Provide agentHarness and workingDir to start an agent for the first time.'
        );
      }

      // Verify the harness is available on the machine
      if (!machine.availableHarnesses.includes(agentHarness!)) {
        throw new Error(`Agent harness '${agentHarness}' is not available on this machine`);
      }

      // Validate model is present for start-agent commands
      if (!args.payload.model && !config?.model) {
        console.warn(
          `[sendCommand] start-agent for role "${args.payload.role}" has no model. ` +
            `The daemon will use its default model.`
        );
      }

      // Save team agent config so auto-restart knows this is a remote agent
      const chatroom = await ctx.db.get('chatroom_rooms', args.payload.chatroomId);
      if (chatroom) {
        const teamRoleKey = buildTeamRoleKey(chatroom, args.payload.role);
        const existingTeamConfig = await ctx.db
          .query('chatroom_teamAgentConfigs')
          .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
          .first();

        const teamConfigNow = Date.now();
        // Preserve existing model if the new value is undefined
        const resolvedTeamModel = args.payload.model ?? existingTeamConfig?.model;
        const teamConfig = {
          teamRoleKey,
          chatroomId: args.payload.chatroomId,
          role: args.payload.role,
          type: 'remote' as const,
          machineId: args.machineId,
          agentHarness,
          model: resolvedTeamModel,
          workingDir: resolvedWorkingDir,
          updatedAt: teamConfigNow,
        };

        if (existingTeamConfig) {
          await ctx.db.patch('chatroom_teamAgentConfigs', existingTeamConfig._id, teamConfig);
        } else {
          await ctx.db.insert('chatroom_teamAgentConfigs', {
            ...teamConfig,
            createdAt: teamConfigNow,
          });
        }
      }
    }

    const now = Date.now();

    // Create the command — include workingDir so the daemon can use it
    // without needing a pre-populated local config
    const commandId = await ctx.db.insert('chatroom_machineCommands', {
      machineId: args.machineId,
      type: args.type,
      payload: {
        chatroomId: args.payload?.chatroomId,
        role: args.payload?.role,
        agentHarness,
        model: args.payload?.model,
        workingDir: resolvedWorkingDir,
      },
      status: 'pending',
      sentBy: user._id,
      createdAt: now,
    });

    return { commandId };
  },
});

/**
 * Update spawned agent PID (from daemon after spawning).
 * Used to track running agents for stop functionality.
 */
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

/**
 * Acknowledge/complete a command (from daemon).
 */
export const ackCommand = mutation({
  args: {
    ...SessionIdArg,
    commandId: v.id('chatroom_machineCommands'),
    status: v.union(v.literal('processing'), v.literal('completed'), v.literal('failed')),
    result: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }

    const command = await ctx.db.get('chatroom_machineCommands', args.commandId);
    if (!command) {
      throw new Error('Command not found');
    }

    await getOwnedMachine(ctx, command.machineId, auth.user._id);

    const now = Date.now();

    await ctx.db.patch('chatroom_machineCommands', args.commandId, {
      status: args.status,
      result: args.result,
      ...(args.status !== 'processing' ? { processedAt: now } : {}),
    });

    // Cleanup: Remove old completed/failed commands for this machine.
    // Commands older than 1 hour that are no longer pending/processing are
    // safe to delete. This prevents unbounded table growth.
    if (args.status === 'completed' || args.status === 'failed') {
      const oneHourAgo = now - 60 * 60 * 1000;
      const oldCommands = await ctx.db
        .query('chatroom_machineCommands')
        .withIndex('by_machineId_status', (q) =>
          q.eq('machineId', command.machineId).eq('status', args.status)
        )
        .collect();

      // Delete commands older than 1 hour, keep recent ones for debugging
      let deletedCount = 0;
      for (const oldCmd of oldCommands) {
        if (oldCmd.createdAt < oneHourAgo && oldCmd._id !== args.commandId) {
          await ctx.db.delete('chatroom_machineCommands', oldCmd._id);
          deletedCount++;
        }
      }

      if (deletedCount > 0) {
        // Log for debugging — this runs server-side in Convex
        console.log(
          `Cleaned up ${deletedCount} old ${args.status} commands for machine ${command.machineId}`
        );
      }
    }

    return { success: true };
  },
});

// ============================================================================
// TEAM AGENT CONFIGS
// Team-level agent configuration for auto-restart decisions
// ============================================================================

/**
 * Build a unique teamRoleKey from a chatroom and role.
 * Format: team_<teamId>#role_<roleLowerCase>
 */
function buildTeamRoleKey(chatroom: Doc<'chatroom_rooms'>, role: string): string {
  const teamId = chatroom.teamId || chatroom._id;
  return `team_${teamId}#role_${role.toLowerCase()}`;
}

/**
 * Save or update team agent configuration.
 * Called when a user starts (or restarts) an agent to record how it was started.
 * The auto-restart logic uses this to decide whether to auto-restart.
 */
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

    const teamRoleKey = buildTeamRoleKey(chatroom, args.role);

    // Upsert by teamRoleKey
    const existing = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
      .first();

    const now = Date.now();
    // Preserve existing model if the new value is undefined (e.g. register-agent doesn't pass model)
    const resolvedModel = args.type === 'remote' ? (args.model ?? existing?.model) : undefined;

    const config = {
      teamRoleKey,
      chatroomId: args.chatroomId,
      role: args.role,
      type: args.type,
      machineId: args.type === 'remote' ? args.machineId : undefined,
      agentHarness: args.type === 'remote' ? args.agentHarness : undefined,
      model: resolvedModel,
      workingDir: args.type === 'remote' ? args.workingDir : undefined,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch('chatroom_teamAgentConfigs', existing._id, config);
    } else {
      await ctx.db.insert('chatroom_teamAgentConfigs', { ...config, createdAt: now });
    }

    return { success: true };
  },
});

/**
 * Get team agent configs for a chatroom.
 * Returns all team-level agent configurations for the given chatroom.
 */
export const getTeamAgentConfigs = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) return [];

    return await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
  },
});
