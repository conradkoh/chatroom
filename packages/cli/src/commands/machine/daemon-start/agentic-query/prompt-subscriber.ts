import type { ConvexClient } from 'convex/browser';

import { api } from '../../../../api.js';
import type { BackendOps } from '../../../../infrastructure/deps/index.js';
import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import type { ActiveSession } from '../direct-harness/session-subscriber.js';
import type { AgenticQuerySubscriptionSession } from './start-subscriptions.js';

export function startPromptSubscriber(
  session: AgenticQuerySubscriptionSession,
  wsClient: ConvexClient,
  _activeSessions: Map<string, ActiveSession>,
  _harnesses: Map<string, BoundHarness>
): { stop: () => void } {
  const handle = wsClient.onUpdate(
    api.daemon.agenticQuery.messages.pendingForMachine,
    { sessionId: session.sessionId, machineId: session.machineId },
    async (_batch) => {
      // Agentic query prompt delivery will be wired in a follow-up slice.
      // For now, the messages query is consumed to keep Convex subscription alive.
    }
  );

  return { stop: handle };
}
