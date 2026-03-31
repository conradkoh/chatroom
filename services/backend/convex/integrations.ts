import { v, ConvexError } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * List all integrations for a chatroom.
 */
export const list = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('chatroom_integrations')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
  },
});

/**
 * Get a single integration by ID.
 */
export const get = query({
  args: {
    ...SessionIdArg,
    integrationId: v.id('chatroom_integrations'),
  },
  handler: async (ctx, args) => {
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Integration not found',
      });
    }
    return integration;
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new chat platform integration for a chatroom.
 */
export const create = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    platform: v.string(),
    config: v.object({
      botToken: v.optional(v.string()),
      chatId: v.optional(v.string()),
      webhookUrl: v.optional(v.string()),
    }),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const integrationId = await ctx.db.insert('chatroom_integrations', {
      chatroomId: args.chatroomId,
      platform: args.platform,
      config: args.config,
      enabled: args.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    });

    return integrationId;
  },
});

/**
 * Update an existing integration's config or enabled status.
 */
export const update = mutation({
  args: {
    ...SessionIdArg,
    integrationId: v.id('chatroom_integrations'),
    config: v.optional(
      v.object({
        botToken: v.optional(v.string()),
        chatId: v.optional(v.string()),
        webhookUrl: v.optional(v.string()),
      })
    ),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.integrationId);
    if (!existing) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Integration not found',
      });
    }

    const now = Date.now();

    await ctx.db.patch(args.integrationId, {
      ...(args.config !== undefined ? { config: args.config } : {}),
      ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
      updatedAt: now,
    });

    return { success: true };
  },
});

/**
 * Delete an integration.
 */
export const remove = mutation({
  args: {
    ...SessionIdArg,
    integrationId: v.id('chatroom_integrations'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.integrationId);
    if (!existing) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Integration not found',
      });
    }

    await ctx.db.delete(args.integrationId);

    return { success: true };
  },
});
