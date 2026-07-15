import type { ConvexClient } from 'convex/browser';
import type { ActiveSession } from '../direct-harness/session-subscriber.js';
import { api } from '../../../../api.js';
import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import type { AgenticQuerySubscriptionSession } from './start-subscriptions.js';

interface SubscriberDeps {
  activeSessions: Map<string, ActiveSession>;
  harnesses: Map<string, BoundHarness>;
}

export function startSessionSubscriber(
  _session: AgenticQuerySubscriptionSession,
  wsClient: ConvexClient,
  deps: SubscriberDeps
): { stop: () => void } {
  const handle = wsClient.onUpdate(
    api.daemon.agenticQuery.sessions.pendingForMachine,
    { sessionId: _session.sessionId, machineId: _session.machineId },
    async (pendingSessions) => {
      if (!pendingSessions || !Array.isArray(pendingSessions)) return;

      // Session opening is handled by the shared direct-harness session subscriber
      // which opens all pending sessions regardless of purpose.
      // This subscription keeps the Convex query alive and logs agentic sessions.
      const count = pendingSessions.length;
      if (count > 0) {
        console.log(`[agentic-query] ${count} pending session(s) detected`);
      }
    }
  );

  return { stop: handle };
}
