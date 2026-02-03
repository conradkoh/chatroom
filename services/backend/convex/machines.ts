/**
 * Machine Management Module
 *
 * Handles machine registration, agent config sync, and remote command dispatch.
 * Enables users to remotely start agents on their registered machines.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { getAuthUser } from '../modules/auth/getAuthUser';

// Agent tool type validator (shared across functions)
const agentToolValidator = v.union(v.literal('opencode'), v.literal('claude'), v.literal('cursor'));

// ============================================================================
// MACHINE REGISTRATION
// ============================================================================

/**
 * Register or update a machine.
 *
 * Called by CLI on every wait-for-task startup.
 * Creates new machine record or updates existing one.
 */
export const register = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    hostname: v.string(),
    os: v.string(),
    availableTools: v.array(agentToolValidator),
  },
  handler: async (ctx, args) => {
    // Verify authenticated user
    const user = await getAuthUser(ctx, args.sessionId);
    if (!user) {
      throw new Error('Authentication required');
    }

    const now = Date.now();

    // Check if machine already exists
    const existing = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    if (existing) {
      // Verify ownership - machine must belong to this user
      if (existing.userId !== user._id) {
        throw new Error('Machine is registered to a different user');
      }

      // Update existing machine
      await ctx.db.patch('chatroom_machines', existing._id, {
        hostname: args.hostname,
        os: args.os,
        availableTools: args.availableTools,
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
      availableTools: args.availableTools,
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
    agentType: agentToolValidator,
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify authenticated user
    const user = await getAuthUser(ctx, args.sessionId);
    if (!user) {
      throw new Error('Authentication required');
    }

    // Verify machine ownership
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    if (!machine) {
      throw new Error('Machine not registered. Call register() first.');
    }

    if (machine.userId !== user._id) {
      throw new Error('Machine is registered to a different user');
    }

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
    const user = await getAuthUser(ctx, args.sessionId);
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
        availableTools: m.availableTools,
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
    const user = await getAuthUser(ctx, args.sessionId);
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
          daemonConnected: machine?.daemonConnected ?? false,
          availableTools: machine?.availableTools ?? [],
          updatedAt: config.updatedAt,
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
    const user = await getAuthUser(ctx, args.sessionId);
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
// COMMAND MANAGEMENT (will be expanded in Phase 5-6)
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
    const user = await getAuthUser(ctx, args.sessionId);
    if (!user) {
      throw new Error('Authentication required');
    }

    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    if (!machine) {
      throw new Error('Machine not found');
    }

    if (machine.userId !== user._id) {
      throw new Error('Not authorized');
    }

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
 */
export const sendCommand = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    type: v.union(v.literal('start-agent'), v.literal('ping'), v.literal('status')),
    payload: v.optional(
      v.object({
        chatroomId: v.optional(v.id('chatroom_rooms')),
        role: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx, args.sessionId);
    if (!user) {
      throw new Error('Authentication required');
    }

    // Verify machine ownership
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    if (!machine) {
      throw new Error('Machine not found');
    }

    if (machine.userId !== user._id) {
      throw new Error('Not authorized to send commands to this machine');
    }

    // For start-agent commands, get the agent config to determine tool
    let agentTool: 'opencode' | 'claude' | 'cursor' | undefined;

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
        agentTool = config.agentType;
      } else {
        throw new Error('No agent config found for this chatroom/role on this machine');
      }

      // Verify the tool is available on the machine
      if (!machine.availableTools.includes(agentTool)) {
        throw new Error(`Agent tool '${agentTool}' is not available on this machine`);
      }
    }

    const now = Date.now();

    // Create the command
    const commandId = await ctx.db.insert('chatroom_machineCommands', {
      machineId: args.machineId,
      type: args.type,
      payload: {
        chatroomId: args.payload?.chatroomId,
        role: args.payload?.role,
        agentTool,
      },
      status: 'pending',
      sentBy: user._id,
      createdAt: now,
    });

    return { commandId };
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
    const user = await getAuthUser(ctx, args.sessionId);
    if (!user) {
      throw new Error('Authentication required');
    }

    const command = await ctx.db.get('chatroom_machineCommands', args.commandId);
    if (!command) {
      throw new Error('Command not found');
    }

    // Verify machine ownership
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', command.machineId))
      .first();

    if (!machine || machine.userId !== user._id) {
      throw new Error('Not authorized');
    }

    const now = Date.now();

    await ctx.db.patch('chatroom_machineCommands', args.commandId, {
      status: args.status,
      result: args.result,
      ...(args.status !== 'processing' ? { processedAt: now } : {}),
    });

    return { success: true };
  },
});
