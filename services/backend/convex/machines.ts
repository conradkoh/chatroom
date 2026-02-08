/**
 * Machine Management Module
 *
 * Handles machine registration, agent config sync, and remote command dispatch.
 * Enables users to remotely start agents on their registered machines.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

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
 * Get authenticated user from session. Throws if session is invalid.
 */
async function getAuthenticatedUser(ctx: any, sessionId: string) {
  const result = await validateSession(ctx, sessionId);
  if (!result.valid) {
    throw new Error('Authentication required');
  }
  const user = await ctx.db.get('users', result.userId);
  if (!user) {
    throw new Error('User not found');
  }
  return user;
}

/**
 * Get authenticated user from session. Returns null if invalid.
 */
async function getAuthenticatedUserOptional(ctx: any, sessionId: string) {
  try {
    return await getAuthenticatedUser(ctx, sessionId);
  } catch {
    return null;
  }
}

/**
 * Look up a machine by its machineId. Throws if not found.
 */
async function getMachineByMachineId(ctx: any, machineId: string) {
  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q: any) => q.eq('machineId', machineId))
    .first();
  if (!machine) {
    throw new Error('Machine not found');
  }
  return machine;
}

/**
 * Look up a machine and verify ownership. Throws if not found or not owned.
 */
async function getOwnedMachine(ctx: any, machineId: string, userId: any) {
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
    const user = await getAuthenticatedUser(ctx, args.sessionId);
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
    const user = await getAuthenticatedUser(ctx, args.sessionId);
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

    if (existing) {
      // Update existing config
      await ctx.db.patch('chatroom_machineAgentConfigs', existing._id, {
        agentType: args.agentType,
        workingDir: args.workingDir,
        model: args.model,
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
        model: args.model,
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
    const user = await getAuthenticatedUserOptional(ctx, args.sessionId);
    if (!user) {
      return { machines: [] };
    }

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
    const user = await getAuthenticatedUserOptional(ctx, args.sessionId);
    if (!user) {
      return { configs: [] };
    }

    // Verify chatroom access
    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom || chatroom.ownerId !== user._id) {
      return { configs: [] };
    }

    const configs = await ctx.db
      .query('chatroom_machineAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Get machine details for each config
    const configsWithMachine = await Promise.all(
      configs.map(async (config) => {
        const machine = await ctx.db
          .query('chatroom_machines')
          .withIndex('by_machineId', (q) => q.eq('machineId', config.machineId))
          .first();

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
      })
    );

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
    const user = await getAuthenticatedUserOptional(ctx, args.sessionId);
    if (!user) {
      return { commands: [] };
    }

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
    const user = await getAuthenticatedUser(ctx, args.sessionId);
    const machine = await getOwnedMachine(ctx, args.machineId, user._id);

    await ctx.db.patch('chatroom_machines', machine._id, {
      daemonConnected: args.connected,
      lastSeenAt: Date.now(),
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
    const user = await getAuthenticatedUser(ctx, args.sessionId);
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
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx, args.sessionId);
    await getOwnedMachine(ctx, args.machineId, user._id);

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

    // Update the spawned agent info
    await ctx.db.patch('chatroom_machineAgentConfigs', config._id, {
      spawnedAgentPid: args.pid,
      spawnedAt: args.pid ? now : undefined,
      updatedAt: now,
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
    const user = await getAuthenticatedUser(ctx, args.sessionId);

    const command = await ctx.db.get('chatroom_machineCommands', args.commandId);
    if (!command) {
      throw new Error('Command not found');
    }

    await getOwnedMachine(ctx, command.machineId, user._id);

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
// AGENT PREFERENCES
// Chatroom-level preferences for agent start defaults
// ============================================================================

/**
 * Get agent start preferences for a chatroom.
 * Returns the current user's preferences for the given chatroom.
 */
export const getAgentPreferences = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUserOptional(ctx, args.sessionId);
    if (!user) return null;

    const prefs = await ctx.db
      .query('chatroom_agentPreferences')
      .withIndex('by_chatroom_user', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('userId', user._id)
      )
      .first();

    if (!prefs) return null;

    return {
      machineId: prefs.machineId,
      harnessByRole: prefs.harnessByRole,
      modelByRole: prefs.modelByRole,
    };
  },
});

/**
 * Update agent start preferences for a chatroom.
 * Called each time a user starts an agent from the UI to remember their selections.
 */
export const updateAgentPreferences = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    machineId: v.optional(v.string()),
    role: v.optional(v.string()),
    harness: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx, args.sessionId);
    const now = Date.now();

    // Find existing preferences
    const existing = await ctx.db
      .query('chatroom_agentPreferences')
      .withIndex('by_chatroom_user', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('userId', user._id)
      )
      .first();

    if (existing) {
      // Update existing preferences
      const updates: Record<string, unknown> = { updatedAt: now };

      if (args.machineId !== undefined) {
        updates.machineId = args.machineId;
      }

      // Update harness for specific role
      if (args.role && args.harness) {
        const harnessByRole = { ...(existing.harnessByRole ?? {}), [args.role]: args.harness };
        updates.harnessByRole = harnessByRole;
      }

      // Update model for specific role
      if (args.role && args.model) {
        const modelByRole = { ...(existing.modelByRole ?? {}), [args.role]: args.model };
        updates.modelByRole = modelByRole;
      }

      await ctx.db.patch('chatroom_agentPreferences', existing._id, updates);
    } else {
      // Create new preferences
      await ctx.db.insert('chatroom_agentPreferences', {
        chatroomId: args.chatroomId,
        userId: user._id,
        machineId: args.machineId,
        harnessByRole: args.role && args.harness ? { [args.role]: args.harness } : undefined,
        modelByRole: args.role && args.model ? { [args.role]: args.model } : undefined,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});
