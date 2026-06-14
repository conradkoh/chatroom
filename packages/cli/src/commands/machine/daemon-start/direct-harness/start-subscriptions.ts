/**
 * Boots direct-harness WS subscribers and lifecycle manager.
 * Called from startCommandLoopEffect when featureFlags.directHarnessWorkers is true.
 */

import type { ConvexClient } from 'convex/browser';

import { startCommandSubscriber } from './command-subscriber.js';
import { HarnessLifecycleManager } from './harness-lifecycle-manager.js';
import { startMessageSubscriber } from './prompt-subscriber.js';
import { startSessionSubscriber } from './session-subscriber.js';
import type { ActiveSession } from './session-subscriber.js';
import { api } from '../../../../api.js';
import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import type { BackendOps } from '../../../../infrastructure/deps/index.js';
import { ConvexCapabilitiesPublisher } from '../../../../infrastructure/repos/convex-capabilities-publisher.js';
import { ConvexOutputRepository } from '../../../../infrastructure/repos/convex-output-repository.js';
import { ConvexSessionRepository } from '../../../../infrastructure/repos/convex-session-repository.js';
import { BufferedJournalFactory } from '../../../../infrastructure/repos/journal-factory.js';
import type { SessionId } from '../types.js';

export interface DirectHarnessSubscriptionSession {
  sessionId: SessionId;
  machineId: string;
  backend: BackendOps;
  convexUrl: string;
}

export interface DirectHarnessSubscriptionHandles {
  pendingPromptSubscriptionHandle: { stop: () => void };
  pendingHarnessSessionSubscriptionHandle: { stop: () => void };
  commandSubscriptionHandle: { stop: () => void };
  lifecycleManager: HarnessLifecycleManager;
}

export function startDirectHarnessSubscriptions(
  session: DirectHarnessSubscriptionSession,
  wsClient: ConvexClient,
  activeSessions: Map<string, ActiveSession>,
  harnesses: Map<string, BoundHarness>
): DirectHarnessSubscriptionHandles {
  const sessionRepository = new ConvexSessionRepository({
    backend: session.backend,
    sessionId: session.sessionId,
  });
  const outputRepository = new ConvexOutputRepository({
    backend: session.backend,
    sessionId: session.sessionId,
  });
  const journalFactory = new BufferedJournalFactory({ outputRepository });

  const sharedDeps = {
    activeSessions,
    harnesses,
    sessionRepository,
    journalFactory,
  };

  const pendingPromptSubscriptionHandle = startMessageSubscriber(session, wsClient, sharedDeps);
  const pendingHarnessSessionSubscriptionHandle = startSessionSubscriber(
    session,
    wsClient,
    sharedDeps
  );

  const lifecycleManager = new HarnessLifecycleManager(
    harnesses,
    activeSessions,
    async (workspaceId) =>
      session.backend.query(api.workspaces.getWorkspaceById, {
        sessionId: session.sessionId,
        workspaceId,
      }),
    session.convexUrl
  );
  lifecycleManager.startMonitoring();

  const commandSubscriptionHandle = startCommandSubscriber(session, wsClient, {
    lifecycleManager,
    publisher: new ConvexCapabilitiesPublisher({
      backend: session.backend,
      sessionId: session.sessionId,
    }),
  });

  return {
    pendingPromptSubscriptionHandle,
    pendingHarnessSessionSubscriptionHandle,
    commandSubscriptionHandle,
    lifecycleManager,
  };
}
