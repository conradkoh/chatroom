import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export type SubscriberHandle = { stop(): Promise<void> };

interface PendingEnhancerJob {
  jobId: string;
}

export function startEnhancerJobSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  const seen = new Set<string>();

  const unsub = deps.wsClient.onUpdate(
    api.daemon.enhancer.index.pendingForMachine,
    { sessionId: deps.sessionId, machineId: deps.machineId },
    // fallow-ignore-next-line complexity
    (jobs: PendingEnhancerJob[] | null) => {
      if (!jobs?.length) return;
      for (const job of jobs) {
        if (job == null || typeof job !== 'object' || !('jobId' in job)) continue;
        if (seen.has(job.jobId)) continue;
        seen.add(job.jobId);
        onEvent({ type: 'enhancer.job-assigned', jobId: job.jobId });
      }
    },
    (err: unknown) => {
      console.warn(
        `[v2] enhancer-job subscriber error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  );

  return {
    async stop() {
      unsub();
    },
  };
}
