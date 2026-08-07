import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export type SubscriberHandle = { stop(): Promise<void> };

interface PendingOpenSession {
  runId: string;
}

export function startAgenticQuerySessionSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  const seen = new Set<string>();

  const unsub = deps.wsClient.onUpdate(
    api.daemon.agenticQuery.runs.pendingForMachine,
    { sessionId: deps.sessionId, machineId: deps.machineId },
    // fallow-ignore-next-line complexity
    (pendingSessions: PendingOpenSession[] | null) => {
      if (!pendingSessions?.length) return;
      for (const session of pendingSessions) {
        if (session == null || typeof session !== 'object' || !('runId' in session)) continue;
        if (seen.has(session.runId)) continue;
        seen.add(session.runId);
        onEvent({ type: 'agentic-query.session-opened', sessionId: session.runId });
      }
    },
    (err: unknown) => {
      console.warn(
        `[daemon] agentic-query-session subscriber error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  );

  return {
    async stop() {
      unsub();
    },
  };
}
