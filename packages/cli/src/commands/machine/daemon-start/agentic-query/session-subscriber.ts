import type { ConvexClient } from 'convex/browser';

import type { AgenticQuerySubscriptionSession } from './start-subscriptions.js';
import type { AgenticPendingOpenSession } from './types.js';
import { api } from '../../../../api.js';
import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import type { SessionRepository } from '../../../../domain/direct-harness/ports/session-repository.js';
import type {
  JournalFactory,
  SessionHandle,
} from '../../../../domain/direct-harness/usecases/open-session.js';
import { openPendingHarnessSession } from '../shared-harness/open-pending-session.js';

type SubscriberDeps = {
  activeSessions: Map<string, SessionHandle>;
  harnesses: Map<string, BoundHarness>;
  sessionRepository: SessionRepository;
  journalFactory: JournalFactory;
};

export function startSessionSubscriber(
  daemonSession: AgenticQuerySubscriptionSession,
  wsClient: ConvexClient,
  deps: SubscriberDeps
): { stop: () => void } {
  const inFlight = new Set<string>();

  const unsub = wsClient.onUpdate(
    api.daemon.agenticQuery.runs.pendingForMachine,
    { sessionId: daemonSession.sessionId, machineId: daemonSession.machineId },
    (pendingSessions: AgenticPendingOpenSession[] | null) => {
      if (!pendingSessions || pendingSessions.length === 0) return;

      for (const session of pendingSessions) {
        const rowId = session.runId;
        if (inFlight.has(rowId)) continue;
        inFlight.add(rowId);
        void openPendingHarnessSession(
          daemonSession,
          deps,
          {
            rowId: session.runId,
            workspaceId: session.workspaceId,
            harnessName: session.harnessName,
            lastUsedConfig: session.lastUsedConfig,
          },
          { logPrefix: '[agentic-query]', handleProviderIdEvents: false }
        ).finally(() => inFlight.delete(rowId));
      }
    },
    (err: unknown) => {
      console.warn(
        '[agentic-query] Session subscription error:',
        err instanceof Error ? err.message : String(err)
      );
    }
  );

  return { stop: unsub };
}
