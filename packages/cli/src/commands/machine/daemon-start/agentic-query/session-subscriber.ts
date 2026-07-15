import type { ConvexClient } from 'convex/browser';

import { api } from '../../../../api.js';
import type { BackendOps } from '../../../../infrastructure/deps/index.js';
import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import type { ActiveSession } from '../direct-harness/session-subscriber.js';
import type { AgenticQuerySubscriptionSession } from './start-subscriptions.js';

export function startSessionSubscriber(
  session: AgenticQuerySubscriptionSession,
  wsClient: ConvexClient,
  _activeSessions: Map<string, ActiveSession>,
  _harnesses: Map<string, BoundHarness>
): { stop: () => void } {
  const handle = wsClient.onUpdate(
    api.daemon.agenticQuery.sessions.pendingForMachine,
    { sessionId: session.sessionId, machineId: session.machineId },
    async (_pendingSessionIds) => {
      // Agentic query session opening will be wired in a follow-up slice.
    }
  );

  return { stop: handle };
}
