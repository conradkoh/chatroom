import type { ConvexClient } from 'convex/browser';

import { startPromptSubscriber } from './prompt-subscriber.js';
import { startSessionSubscriber } from './session-subscriber.js';
import type { ActiveSession } from '../direct-harness/session-subscriber.js';
import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import type { BackendOps } from '../../../../infrastructure/deps/index.js';
import { ConvexOutputRepository } from '../../../../infrastructure/repos/convex-output-repository.js';
import { ConvexSessionRepository } from '../../../../infrastructure/repos/convex-session-repository.js';
import { BufferedJournalFactory } from '../../../../infrastructure/repos/journal-factory.js';
import type { SessionId } from '../types.js';

export interface AgenticQuerySubscriptionSession {
  sessionId: SessionId;
  machineId: string;
  backend: BackendOps;
  convexUrl: string;
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
  const sessionRepository = new ConvexSessionRepository({
    backend: session.backend,
    sessionId: session.sessionId,
  });
  const outputRepository = new ConvexOutputRepository({
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
