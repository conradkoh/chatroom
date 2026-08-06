import type { ConvexClient } from 'convex/browser';

import type { AgenticQuerySubscriptionSession } from './start-subscriptions.js';
import type { AgenticPendingOpenSession } from './types.js';
import { api } from '../../../../api.js';
import type { BoundHarness } from '../../../../v2/domain/entities/bound-harness.js';
import type {
  SessionRepository,
  JournalFactory,
  SessionHandle,
} from '../../../../v2/domain/usecase/open-harness-session.js';
import { openPendingHarnessSession } from '../shared-harness/open-pending-session.js';

export type AgenticQuerySessionSubscriberDeps = {
  activeSessions: Map<string, SessionHandle>;
  harnesses: Map<string, BoundHarness>;
  sessionRepository: SessionRepository;
  journalFactory: JournalFactory;
};

async function processPendingAgenticQuerySessionRows(
  daemonSession: AgenticQuerySubscriptionSession,
  deps: AgenticQuerySessionSubscriberDeps,
  pendingSessions: AgenticPendingOpenSession[] | null,
  inFlight?: Set<string>
): Promise<void> {
  if (!pendingSessions || pendingSessions.length === 0) return;

  for (const session of pendingSessions) {
    const rowId = session.runId;
    if (inFlight?.has(rowId)) continue;
    if (inFlight) inFlight.add(rowId);
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
    ).finally(() => {
      if (inFlight) inFlight.delete(rowId);
    });
  }
}

export async function processPendingAgenticQuerySessions(
  daemonSession: AgenticQuerySubscriptionSession,
  deps: AgenticQuerySessionSubscriberDeps,
  pendingSessions?: AgenticPendingOpenSession[] | null
): Promise<void> {
  const sessions =
    pendingSessions ??
    ((await daemonSession.backend.query(api.daemon.agenticQuery.runs.pendingForMachine, {
      sessionId: daemonSession.sessionId,
      machineId: daemonSession.machineId,
    })) as AgenticPendingOpenSession[] | null);

  await processPendingAgenticQuerySessionRows(daemonSession, deps, sessions);
}

export function startSessionSubscriber(
  daemonSession: AgenticQuerySubscriptionSession,
  wsClient: ConvexClient,
  deps: AgenticQuerySessionSubscriberDeps
): { stop: () => void } {
  const inFlight = new Set<string>();

  const unsub = wsClient.onUpdate(
    api.daemon.agenticQuery.runs.pendingForMachine,
    { sessionId: daemonSession.sessionId, machineId: daemonSession.machineId },
    (pendingSessions: AgenticPendingOpenSession[] | null) => {
      void processPendingAgenticQuerySessionRows(daemonSession, deps, pendingSessions, inFlight);
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
