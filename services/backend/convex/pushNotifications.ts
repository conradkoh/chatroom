/**
 * Web Push Notification System
 *
 * Manages push subscriptions (stored per user/browser) and sends push
 * notifications via the Web Push API when agents hand off to the user.
 *
 * Architecture:
 * - Mutations: subscribe/unsubscribe for push notification endpoints
 * - Action: sends push notifications using the `web-push` npm package
 * - Internal mutation: cleans up expired/invalid subscriptions
 */

import { v } from 'convex/values';

import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { validateSession } from './auth/cliSessionAuth';

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Returns the VAPID public key so the client can subscribe to push notifications.
 *
 * The public key is stored as an environment variable (VAPID_PUBLIC_KEY).
 * Returns null if push notifications are not configured.
 */
export const getVapidPublicKey = query({
  args: {},
  handler: async (): Promise<string | null> => {
    return process.env.VAPID_PUBLIC_KEY ?? null;
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Stores or refreshes a push subscription for the authenticated user.
 *
 * If a subscription with the same endpoint already exists, it is updated
 * (keys may change on browser refresh). Otherwise a new row is inserted.
 */
export const subscribe = mutation({
  args: {
    ...SessionIdArg,
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) {
      throw new Error('Authentication required');
    }

    const now = Date.now();

    // Check for existing subscription with this endpoint
    const existing = await ctx.db
      .query('chatroom_pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', args.endpoint))
      .first();

    if (existing) {
      // Update keys and refresh timestamp
      await ctx.db.patch('chatroom_pushSubscriptions', existing._id, {
        userId: session.userId,
        p256dh: args.p256dh,
        auth: args.auth,
        createdAt: now,
      });
    } else {
      await ctx.db.insert('chatroom_pushSubscriptions', {
        userId: session.userId,
        endpoint: args.endpoint,
        p256dh: args.p256dh,
        auth: args.auth,
        createdAt: now,
      });
    }
  },
});

/**
 * Removes a push subscription by endpoint.
 *
 * Called when the user explicitly unsubscribes, or when a subscription
 * becomes invalid (410 Gone response from push service).
 */
export const unsubscribe = mutation({
  args: {
    ...SessionIdArg,
    endpoint: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) return;

    const existing = await ctx.db
      .query('chatroom_pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', args.endpoint))
      .first();

    if (existing && existing.userId === session.userId) {
      await ctx.db.delete('chatroom_pushSubscriptions', existing._id);
    }
  },
});

/**
 * Internal mutation to remove expired/invalid subscriptions.
 * Called by the sendPush action when a push endpoint returns 404 or 410.
 */
export const removeExpiredSubscription = internalMutation({
  args: {
    endpoint: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const existing = await ctx.db
      .query('chatroom_pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', args.endpoint))
      .first();

    if (existing) {
      await ctx.db.delete('chatroom_pushSubscriptions', existing._id);
    }
  },
});

// ─── Internal Query ───────────────────────────────────────────────────────────

/**
 * Internal query to fetch all push subscriptions for a user.
 * Used by the sendPush action.
 */
export const getSubscriptionsForUser = internalQuery({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('chatroom_pushSubscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .collect();
  },
});
