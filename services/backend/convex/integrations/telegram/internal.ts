/**
 * Telegram Bot Internal — Convex mutations for Telegram integration.
 *
 * These run in the Convex runtime (NOT Node.js) and handle DB operations.
 * Actions that call external APIs are in api.ts.
 */

import { v } from 'convex/values';

import { internalMutation } from '../../_generated/server';

// ─── Internal Mutations ───────────────────────────────────────────────────────

/**
 * Update the webhook URL and secret on an integration record.
 * Called internally by registerWebhook action.
 */
export const updateWebhookRegistration = internalMutation({
  args: {
    integrationId: v.id('chatroom_integrations'),
    webhookUrl: v.string(),
    webhookSecret: v.string(),
  },
  handler: async (ctx, args) => {
    const integration = await ctx.db.get("chatroom_integrations", args.integrationId);
    if (!integration) return;

    await ctx.db.patch("chatroom_integrations", args.integrationId, {
      config: {
        ...integration.config,
        webhookUrl: args.webhookUrl || undefined,
        webhookSecret: args.webhookSecret,
      },
      updatedAt: Date.now(),
    });
  },
});
