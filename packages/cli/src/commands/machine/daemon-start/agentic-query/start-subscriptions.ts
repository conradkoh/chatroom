import type { ConvexClient } from 'convex/browser';

import { startPromptSubscriber } from './prompt-subscriber.js';
import { startSessionSubscriber } from './session-subscriber.js';
import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import { ConvexAgenticQueryOutputRepository } from '../../../../infrastructure/repos/convex-agentic-query-output-repository.js';
import { ConvexAgenticQueryRunRepository } from '../../../../infrastructure/repos/convex-agentic-query-run-repository.js';
import { BufferedJournalFactory } from '../../../../infrastructure/repos/journal-factory.js';
import type { ActiveSession } from '../direct-harness/session-subscriber.js';
import type { HarnessWorkerSession } from '../shared-harness/types.js';

export interface AgenticQuerySubscriptionSession extends HarnessWorkerSession {
  machineId: string;
}

export interface AgenticQuerySubscriptionHandles {
  pendingPromptSubscriptionHandle: { stop: () => void };
  pendingHarnessSessionSubscriptionHandle: { stop: () => void };
}

export function startAgenticQuerySubscriptions(
  session: AgenticQuerySubscriptionSession,
  wsClient: ConvexClient,
  activeSessions: Map<string, ActiveSession>,
  harnesses: Map<string, BoundHarness>
): AgenticQuerySubscriptionHandles {
  const sessionRepository = new ConvexAgenticQueryRunRepository({
    backend: session.backend,
    sessionId: session.sessionId,
  });
  const outputRepository = new ConvexAgenticQueryOutputRepository({
    backend: session.backend,
    sessionId: session.sessionId,
  });
  const journalFactory = new BufferedJournalFactory({ outputRepository });

  const deps = { activeSessions, harnesses, sessionRepository, journalFactory };

  const pendingPromptSubscriptionHandle = startPromptSubscriber(session, wsClient, deps);
  const pendingHarnessSessionSubscriptionHandle = startSessionSubscriber(session, wsClient, deps);

  return {
    pendingPromptSubscriptionHandle,
    pendingHarnessSessionSubscriptionHandle,
  };
}
