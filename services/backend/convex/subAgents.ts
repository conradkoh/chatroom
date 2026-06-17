import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { agentHarnessValidator } from './schema';
import { completeSubAgent as completeSubAgentUseCase } from '../src/domain/usecase/sub-agent/complete-sub-agent';
import { spawnSubAgent as spawnSubAgentUseCase } from '../src/domain/usecase/sub-agent/spawn-sub-agent';

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Get all sub-agent instances for a chatroom.
 */
export const listSubAgents = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const instances = await ctx.db
      .query('chatroom_subAgentInstances')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    return instances;
  },
});

/**
 * Get a specific sub-agent instance by ID.
 */
export const getSubAgentInstance = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const instance = await ctx.db
      .query('chatroom_subAgentInstances')
      .withIndex('by_chatroom_instance', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('instanceId', args.instanceId)
      )
      .first();

    return instance;
  },
});

/**
 * Get sub-agent config for a specific type in a chatroom.
 */
export const getSubAgentConfig = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    subAgentType: v.union(v.literal('codemapper')),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const config = await ctx.db
      .query('chatroom_subAgentConfigs')
      .withIndex('by_chatroom_type', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('subAgentType', args.subAgentType)
      )
      .first();

    return config;
  },
});

/**
 * List all sub-agent configs for a chatroom.
 */
export const listSubAgentConfigs = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const configs = await ctx.db
      .query('chatroom_subAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    return configs;
  },
});

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Configure a sub-agent type for a chatroom.
 */
export const configureSubAgent = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    subAgentType: v.literal('codemapper'),
    machineId: v.string(),
    model: v.string(),
    agentHarness: agentHarnessValidator,
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const now = Date.now();

    // Check if config already exists
    const existing = await ctx.db
      .query('chatroom_subAgentConfigs')
      .withIndex('by_chatroom_type', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('subAgentType', args.subAgentType)
      )
      .first();

    if (existing) {
      // Update existing config
      await ctx.db.patch('chatroom_subAgentConfigs', existing._id, {
        machineId: args.machineId,
        model: args.model,
        agentHarness: args.agentHarness,
        workingDir: args.workingDir,
        updatedAt: now,
      });

      return existing._id;
    }

    // Create new config
    const configId = await ctx.db.insert('chatroom_subAgentConfigs', {
      chatroomId: args.chatroomId,
      subAgentType: args.subAgentType,
      machineId: args.machineId,
      model: args.model,
      agentHarness: args.agentHarness,
      workingDir: args.workingDir,
      createdAt: now,
      updatedAt: now,
    });

    return configId;
  },
});

/**
 * Spawn a new sub-agent instance.
 *
 * Creates an instance record, starts the agent (via daemon), and returns
 * the instanceId and role immediately.
 */
export const spawnSubAgent = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    subAgentType: v.union(v.literal('codemapper')),
    codemapName: v.string(),
    briefing: v.string(),
    parentRole: v.string(),
    machineId: v.optional(v.string()),
    taskId: v.optional(v.id('chatroom_tasks')),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // machineId is required for sub-agent spawn — must be provided by caller
    if (!args.machineId) {
      throw new ConvexError({
        code: 'SUB_AGENT_MACHINE_NOT_FOUND',
        message: 'Machine ID is required for sub-agent spawn',
      });
    }

    const result = await spawnSubAgentUseCase({
      ctx,
      chatroomId: args.chatroomId,
      parentRole: args.parentRole,
      subAgentType: args.subAgentType,
      codemapName: args.codemapName,
      briefing: args.briefing,
      machineId: args.machineId,
      taskId: args.taskId,
    });

    return result;
  },
});

/**
 * Complete (or fail) a sub-agent instance.
 *
 * Updates the instance status and optionally persists the codemap content.
 */
export const completeSubAgent = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    instanceId: v.string(),
    status: v.union(v.literal('completed'), v.literal('failed')),
    codemapContent: v.optional(v.string()),
    codemapName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const result = await completeSubAgentUseCase({
      ctx,
      chatroomId: args.chatroomId,
      instanceId: args.instanceId,
      status: args.status,
      codemapContent: args.codemapContent,
      codemapName: args.codemapName,
    });

    return result;
  },
});
