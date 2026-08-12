import type { AgenticQuerySubscriptionSession } from './start-subscriptions.js';
import type { AgenticPendingOpenSession } from './types.js';
import { api } from '../../../api.js';
import type { BoundHarness } from '../../domain/entities/bound-harness.js';
import type {
  SessionRepository,
  JournalFactory,
  SessionHandle,
} from '../../domain/usecase/open-harness-session.js';
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
  pendingSessions: AgenticPendingOpenSession[] | null
): Promise<void> {
  if (!pendingSessions || pendingSessions.length === 0) return;

  for (const session of pendingSessions) {
    await openPendingHarnessSession(
      daemonSession,
      deps,
      {
        rowId: session.runId,
        workspaceId: session.workspaceId,
        harnessName: session.harnessName,
        lastUsedConfig: session.lastUsedConfig,
      },
      { logPrefix: '[agentic-query]', handleProviderIdEvents: false }
    );
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
