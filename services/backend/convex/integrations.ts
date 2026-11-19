import { v, ConvexError } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { omitUndefined } from './lib/omitUndefined';
import {
  normalizeIntegrationDetail,
  type IntegrationDetailField,
} from '../src/domain/entities/integration-details';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Throws VALIDATION_ERROR for over-limit input; returns undefined for unset. */
function requireIntegrationDetail(field: IntegrationDetailField, raw: string): string | undefined {
  const result = normalizeIntegrationDetail(field, raw);
  if (!result.ok) {
    throw new ConvexError({
      code: 'VALIDATION_ERROR',
      field: result.field,
      maxLength: result.maxLength,
      message: result.message,
    });
  }
  return result.value;
}

/**
 * Build the name/description patch for `update`: only provided fields appear in
 * the result, and an empty input maps to an explicit `undefined` so `ctx.db.patch`
 * removes the key from the stored document.
 */
function buildIntegrationDetailPatch(
  name: string | undefined,
  description: string | undefined
): { name?: string | undefined; description?: string | undefined } {
  const patch: { name?: string | undefined; description?: string | undefined } = {};
  if (name !== undefined) patch.name = requireIntegrationDetail('name', name);
  if (description !== undefined)
    patch.description = requireIntegrationDetail('description', description);
  return patch;
}

/** Redact a bot token for safe display — show only last 4 chars. */
function redactBotToken(token?: string): string | undefined {
  if (!token) return undefined;
  if (token.length <= 4) return '••••';
  return '•'.repeat(token.length - 4) + token.slice(-4);
}

/** Redact sensitive fields from an integration record for frontend display. */
function redactIntegration(integration: Doc<'chatroom_integrations'>) {
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
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

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
    const integration = await ctx.db.get('chatroom_integrations', args.integrationId);
    if (!integration) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Integration not found',
      });
    }

    await requireChatroomAccess(ctx, args.sessionId, integration.chatroomId);

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
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate session and chatroom ownership
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const name = args.name === undefined ? undefined : requireIntegrationDetail('name', args.name);
    const description =
      args.description === undefined
        ? undefined
        : requireIntegrationDetail('description', args.description);

    const now = Date.now();

    const integrationId = await ctx.db.insert(
      'chatroom_integrations',
      omitUndefined({
        chatroomId: args.chatroomId,
        platform: args.platform,
        config: args.config,
        enabled: args.enabled ?? true,
        name,
        description,
        createdAt: now,
        updatedAt: now,
      })
    );

    return integrationId;
  },
});

/**
 * Update an existing integration's config, enabled status, name or description.
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
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get('chatroom_integrations', args.integrationId);
    if (!existing) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Integration not found',
      });
    }

    // Validate session and chatroom ownership
    await requireChatroomAccess(ctx, args.sessionId, existing.chatroomId);

    // Validate both before writing anything (no partial write on a validation error).
    const detailPatch = buildIntegrationDetailPatch(args.name, args.description);

    await ctx.db.patch('chatroom_integrations', args.integrationId, {
      ...(args.config !== undefined ? { config: args.config } : {}),
      ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
      ...detailPatch, // an explicit undefined value removes the field
      updatedAt: Date.now(),
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
    const existing = await ctx.db.get('chatroom_integrations', args.integrationId);
    if (!existing) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Integration not found',
      });
    }

    // Validate session and chatroom ownership
    await requireChatroomAccess(ctx, args.sessionId, existing.chatroomId);

    await ctx.db.delete('chatroom_integrations', args.integrationId);

    return { success: true };
  },
});
