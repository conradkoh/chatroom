import { v, ConvexError } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query, internalQuery } from './_generated/server';
import { requireChatroomAccess } from './auth/cliSessionAuth';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Redact a bot token for safe display — show only last 4 chars. */
function redactBotToken(token?: string): string | undefined {
  if (!token) return undefined;
  if (token.length <= 4) return '••••';
  return '•'.repeat(token.length - 4) + token.slice(-4);
}

/** Redact sensitive fields from an integration record for frontend display. */
function redactIntegration(integration: any) {
  return {
    ...integration,
    config: {
      ...integration.config,
      botToken: redactBotToken(integration.config?.botToken),
      // Never expose webhookSecret to frontend
      webhookSecret: undefined,
    },
  };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * List all integrations for a chatroom.
 * Bot tokens are redacted for security.
 */
export const list = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const integrations = await ctx.db
      .query('chatroom_integrations')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    return integrations.map(redactIntegration);
  },
});

/**
 * Get a single integration by ID.
 * Bot token is redacted for security.
 */
export const get = query({
  args: {
    ...SessionIdArg,
    integrationId: v.id('chatroom_integrations'),
  },
  handler: async (ctx, args) => {
    const integration = await ctx.db.get("chatroom_integrations", args.integrationId);
    if (!integration) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Integration not found',
      });
    }
    return redactIntegration(integration);
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new chat platform integration for a chatroom.
 * Requires chatroom ownership.
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
    // Validate session and chatroom ownership
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

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
 * Requires chatroom ownership.
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
    const existing = await ctx.db.get("chatroom_integrations", args.integrationId);
    if (!existing) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Integration not found',
      });
    }

    // Validate session and chatroom ownership
    await requireChatroomAccess(ctx, args.sessionId, existing.chatroomId);

    const now = Date.now();

    await ctx.db.patch("chatroom_integrations", args.integrationId, {
      ...(args.config !== undefined ? { config: args.config } : {}),
      ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
      updatedAt: now,
    });

    return { success: true };
  },
});

/**
 * Delete an integration.
 * Requires chatroom ownership.
 */
export const remove = mutation({
  args: {
    ...SessionIdArg,
    integrationId: v.id('chatroom_integrations'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get("chatroom_integrations", args.integrationId);
    if (!existing) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Integration not found',
      });
    }

    // Validate session and chatroom ownership
    await requireChatroomAccess(ctx, args.sessionId, existing.chatroomId);

    await ctx.db.delete("chatroom_integrations", args.integrationId);

    return { success: true };
  },
});

// ─── Internal functions (for outbound forwarding / internal use) ─────────────

/**
 * Internal query to list active integrations for a chatroom by platform.
 * Used by the outbound forwarding action.
 */
export const listActiveByPlatform = internalQuery({
  args: {
    chatroomId: v.id('chatroom_rooms'),
    platform: v.string(),
  },
  handler: async (ctx, args) => {
    const integrations = await ctx.db
      .query('chatroom_integrations')
      .withIndex('by_chatroom_platform', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('platform', args.platform)
      )
      .collect();

    return integrations.filter((i) => i.enabled);
  },
});
