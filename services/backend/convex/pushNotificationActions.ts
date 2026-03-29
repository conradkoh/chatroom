'use node';

/**
 * Web Push Send Action
 *
 * Convex action that sends push notifications using the `web-push` npm package.
 * Must be in a separate file with 'use node' directive to access Node.js APIs.
 *
 * Called by the message handoff flow to notify users of new activity.
 */

import webpush from 'web-push';
import { v } from 'convex/values';

import { internalAction } from './_generated/server';
import { internal } from './_generated/api';

/**
 * Sends a push notification to all subscriptions for a given user.
 *
 * Handles expired subscriptions gracefully by removing them (410 Gone).
 * Non-blocking: errors for individual subscriptions don't prevent others
 * from being notified.
 */
export const sendPushToUser = internalAction({
  args: {
    userId: v.id('users'),
    title: v.string(),
    body: v.string(),
    tag: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    const vapidSubject = process.env.VAPID_SUBJECT ?? 'mailto:admin@chatroom.app';

    if (!vapidPublicKey || !vapidPrivateKey) {
      // Push not configured — silently skip
      return;
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    // Fetch all subscriptions for this user
    const subscriptions = await ctx.runQuery(
      internal.pushNotifications.getSubscriptionsForUser,
      { userId: args.userId }
    );

    if (subscriptions.length === 0) return;

    const payload = JSON.stringify({
      title: args.title,
      body: args.body,
      tag: args.tag ?? 'chatroom-push',
      url: args.url,
    });

    // Send to all subscriptions in parallel
    const results = await Promise.allSettled(
      subscriptions.map(async (sub: { endpoint: string; p256dh: string; auth: string }) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            payload,
            { TTL: 60 } // Notification expires after 60 seconds
          );
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;

          // 404 or 410 means the subscription is no longer valid
          if (statusCode === 404 || statusCode === 410) {
            await ctx.runMutation(
              internal.pushNotifications.removeExpiredSubscription,
              { endpoint: sub.endpoint }
            );
          }

          throw err; // Re-throw so Promise.allSettled captures it as rejected
        }
      })
    );

    // Log summary (visible in Convex dashboard logs)
    const succeeded = results.filter((r: PromiseSettledResult<void>) => r.status === 'fulfilled').length;
    const failed = results.filter((r: PromiseSettledResult<void>) => r.status === 'rejected').length;
    if (failed > 0) {
      console.log(
        `[Push] Sent ${succeeded}/${subscriptions.length} push notifications for user ${args.userId} (${failed} failed)`
      );
    }
  },
});
