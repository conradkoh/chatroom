import type { OutboundEvent } from '../../../../domain/entities/outbound-event.js';
import { createAgentLifecyclePublisher } from '../../../convex/publishers/agent-lifecycle.js';
import type { ConvexPublisherDeps } from '../../../convex/publishers/publisher-deps.js';
import type { Publisher } from '../../../convex/publishers/publisher.js';
import { getTierForOutboundEvent, SyncTier } from '../../sync-policy.js';

const DEFAULT_T1_FLUSH_WINDOW_MS = 5_000;

export type AgentLifecycleProjector = Publisher & {
  flush(): Promise<void>;
};

export type AgentLifecycleProjectorDeps = ConvexPublisherDeps & {
  t1FlushWindowMs?: number;
};

function isT1Event(event: OutboundEvent): boolean {
  return getTierForOutboundEvent(event.type) === SyncTier.T1;
}

/**
 * Project agent status lifecycle events to Convex:
 * - T3 lifecycle status events project immediately via the shared publisher.
 * - T1 batched events (session id churn) are coalesced within a flush window
 *   and flushed together, keeping per-tick Convex mutation churn low.
 */
export function createAgentLifecycleProjector(
  deps: AgentLifecycleProjectorDeps
): AgentLifecycleProjector {
  const t1FlushWindowMs = deps.t1FlushWindowMs ?? DEFAULT_T1_FLUSH_WINDOW_MS;
  const immediate = createAgentLifecyclePublisher(deps);
  const buffer: OutboundEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const batch = buffer.splice(0, buffer.length);
    if (batch.length === 0) return;
    for (const event of batch) {
      await immediate.publish(event);
    }
  };

  const scheduleFlush = (): void => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, t1FlushWindowMs);
    timer.unref?.();
  };

  return {
    async publish(event: OutboundEvent): Promise<void> {
      if (!isT1Event(event)) {
        await immediate.publish(event);
        return;
      }
      buffer.push(event);
      scheduleFlush();
    },
    flush,
  };
}
