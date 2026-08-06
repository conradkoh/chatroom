import { drainPendingAgenticQueryMessages } from './prompt-subscriber.js';
import { processPendingAgenticQuerySessions } from './session-subscriber.js';
import { ConvexAgenticQueryOutputRepository } from '../../../../infrastructure/repos/convex-agentic-query-output-repository.js';
import { ConvexAgenticQueryRunRepository } from '../../../../infrastructure/repos/convex-agentic-query-run-repository.js';
import { BufferedJournalFactory } from '../../../../infrastructure/repos/journal-factory.js';
import type { BoundHarness } from '../../../../v2/domain/entities/bound-harness.js';
import {
  registerAgenticQueryInboundHandler,
  unregisterAgenticQueryInboundHandler,
} from '../../../../v2/entry/agentic-query-inbound-registry.js';
import type { ActiveSession } from '../direct-harness/session-subscriber.js';
import type { HarnessWorkerSession } from '../shared-harness/types.js';

export interface AgenticQuerySubscriptionSession extends HarnessWorkerSession {
  machineId: string;
}

export interface AgenticQuerySubscriptionHandles {
  stop: () => void;
}

/** Init agentic-query inbound registry (no WS — v2 subscribers nudge drains). */
export function startAgenticQuerySubscriptions(
  session: AgenticQuerySubscriptionSession,
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

  registerAgenticQueryInboundHandler(async (event) => {
    switch (event.type) {
      case 'agentic-query.prompt':
        await drainPendingAgenticQueryMessages(session, deps);
        break;
      case 'agentic-query.session-opened':
        await processPendingAgenticQuerySessions(session, deps);
        break;
    }
  });

  return {
    stop: () => {
      unregisterAgenticQueryInboundHandler();
    },
  };
}
