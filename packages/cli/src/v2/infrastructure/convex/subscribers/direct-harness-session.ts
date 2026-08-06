import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export type SubscriberHandle = { stop(): Promise<void> };

interface PendingSession {
  _id: string;
}

export function startDirectHarnessSessionSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  const seen = new Set<string>();

  const unsub = deps.wsClient.onUpdate(
    api.daemon.directHarness.sessions.listPendingSessionsForMachine,
    { sessionId: deps.sessionId, machineId: deps.machineId },
    // fallow-ignore-next-line complexity
    (pendingSessions: PendingSession[] | null) => {
      if (!pendingSessions?.length) return;
      for (const session of pendingSessions) {
        if (seen.has(session._id)) continue;
        seen.add(session._id);
        onEvent({
          type: 'direct-harness.session-opened',
          harnessSessionId: session._id,
        });
      }
    },
    (err: unknown) => {
      console.warn(
        `[v2] direct-harness-session subscriber error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  );

  return {
    async stop() {
      unsub();
    },
  };
}
