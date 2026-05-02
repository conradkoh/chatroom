import { internalMutation } from './_generated/server';
import { DAEMON_HEARTBEAT_TTL_MS } from '../config/reliability';

/**
 * Cron job that transitions online machines to offline when their heartbeat expires.
 * Only scans machines with status === "online" (via by_status index).
 * Skips writes if the machine is already offline (write suppression).
 */
export const transitionOfflineMachines = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Only scan online machines — offline ones don't need checking
    const onlineMachines = await ctx.db
      .query('chatroom_machineStatus')
      .withIndex('by_status', (q) => q.eq('status', 'online'))
      .collect();

    for (const machineStatus of onlineMachines) {
      // Check liveness data
      const liveness = await ctx.db
        .query('chatroom_machineLiveness')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineStatus.machineId))
        .first();

      // If no liveness record or heartbeat has expired, transition to offline
      const isExpired =
        !liveness || liveness.lastSeenAt + DAEMON_HEARTBEAT_TTL_MS < now;

      if (isExpired) {
        // Status is "online" (we queried by_status), so this is a real transition
        await ctx.db.patch("chatroom_machineStatus", machineStatus._id, {
          status: 'offline',
          lastTransitionAt: now,
        });
      }
    }
  },
});
