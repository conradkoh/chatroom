/**
 * Circuit Breaker for Agent Restarts
 *
 * Shared circuit breaker logic extracted from ensureAgentHandler.
 * Prevents infinite restart loops by tracking recent agent exits
 * and blocking restarts when too many exits occur in a short window.
 *
 * State transitions:
 * - CLOSED → OPEN when exits ≥ MAX_EXITS in WINDOW
 * - OPEN → HALF-OPEN when cool-down elapsed
 * - HALF-OPEN → CLOSED when agent calls get-next-task (handled in participants.join)
 */

import {
  CIRCUIT_BREAKER_MAX_EXITS,
  CIRCUIT_WINDOW_MS,
  CIRCUIT_COOLDOWN_MS,
} from '../../../../config/reliability';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export type CircuitStatus = 'closed' | 'open';

export async function checkCircuitBreaker(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  config: {
    _id: Id<'chatroom_teamAgentConfigs'>;
    role: string;
    machineId?: string;
    circuitState?: string;
    circuitOpenedAt?: number;
  }
): Promise<CircuitStatus> {
  const now = Date.now();
  const { circuitState, circuitOpenedAt } = config;

  if (circuitState === 'open') {
    if (circuitOpenedAt && now - circuitOpenedAt >= CIRCUIT_COOLDOWN_MS) {
      await ctx.db.patch(config._id, { circuitState: 'half-open' });
      return 'closed';
    }
    return 'open';
  }

  if (circuitState === 'half-open') {
    return 'closed';
  }

  const windowStart = now - CIRCUIT_WINDOW_MS;
  const recentEvents = await ctx.db
    .query('chatroom_eventStream')
    .withIndex('by_chatroomId_role', (q) =>
      q.eq('chatroomId', chatroomId).eq('role', config.role)
    )
    .order('desc')
    .take(CIRCUIT_BREAKER_MAX_EXITS + 5);

  const recentExits = recentEvents.filter(
    (e) =>
      e.type === 'agent.exited' &&
      e.timestamp >= windowStart &&
      e.stopReason !== 'user.stop' &&
      e.stopReason !== 'daemon.respawn' &&
      e.stopReason !== 'platform.team_switch'
  );

  if (recentExits.length >= CIRCUIT_BREAKER_MAX_EXITS) {
    await ctx.db.patch(config._id, { circuitState: 'open', circuitOpenedAt: now });
    if (config.machineId) {
      await ctx.db.insert('chatroom_eventStream', {
        type: 'agent.circuitOpen',
        chatroomId,
        role: config.role,
        machineId: config.machineId,
        reason: `${CIRCUIT_BREAKER_MAX_EXITS} exits in ${CIRCUIT_WINDOW_MS / 60_000} minutes`,
        timestamp: now,
      });
    }
    return 'open';
  }

  return 'closed';
}
