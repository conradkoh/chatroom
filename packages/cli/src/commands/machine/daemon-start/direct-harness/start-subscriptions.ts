/**
 * Boots direct-harness WS subscribers and lifecycle manager.
 * Called from startCommandLoopEffect when featureFlags.directHarnessWorkers is true.
 */

import type { ConvexClient } from 'convex/browser';

import { drainPendingHarnessCommands, type CommandSubscriberDeps } from './command-subscriber.js';
import { startCommandSubscriber } from './command-subscriber.js';
import { HarnessLifecycleManager } from './harness-lifecycle-manager.js';
import { drainPendingHarnessMessages, startMessageSubscriber } from './prompt-subscriber.js';
import { processPendingHarnessSessions, startSessionSubscriber } from './session-subscriber.js';
import type { ActiveSession } from './session-subscriber.js';
import { closeAllMachineHarnessSessionsOnShutdown } from './shutdown-sessions.js';
import { api } from '../../../../api.js';
import type { BackendOps } from '../../../../infrastructure/deps/index.js';
import { ConvexCapabilitiesPublisher } from '../../../../infrastructure/repos/convex-capabilities-publisher.js';
import { ConvexOutputRepository } from '../../../../infrastructure/repos/convex-output-repository.js';
import { ConvexSessionRepository } from '../../../../infrastructure/repos/convex-session-repository.js';
import { BufferedJournalFactory } from '../../../../infrastructure/repos/journal-factory.js';
import type { BoundHarness } from '../../../../v2/domain/entities/bound-harness.js';
import {
  registerDirectHarnessInboundHandler,
  unregisterDirectHarnessInboundHandler,
} from '../../../../v2/entry/direct-harness-inbound-registry.js';
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
  closeSessionsOnShutdown: () => Promise<void>;
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

  const commandDeps: CommandSubscriberDeps = {
    lifecycleManager,
    publisher: new ConvexCapabilitiesPublisher({
      backend: session.backend,
      sessionId: session.sessionId,
    }),
    activeSessions,
    sessionRepository,
  };

  registerDirectHarnessInboundHandler(async (event) => {
    switch (event.type) {
      case 'direct-harness.prompt':
        await drainPendingHarnessMessages(session, sharedDeps);
        break;
      case 'direct-harness.session-opened':
        await processPendingHarnessSessions(session, sharedDeps);
        break;
      case 'direct-harness.command':
        await drainPendingHarnessCommands(session, commandDeps);
        break;
    }
  });

  const wrapStop = (stop: () => void) => () => {
    unregisterDirectHarnessInboundHandler();
    stop();
  };

  const pendingPromptSubscriptionHandle = startMessageSubscriber(session, wsClient, sharedDeps);
  const pendingHarnessSessionSubscriptionHandle = startSessionSubscriber(
    session,
    wsClient,
    sharedDeps
  );

  const commandSubscriptionHandle = startCommandSubscriber(session, wsClient, commandDeps);

  return {
    pendingPromptSubscriptionHandle: { stop: wrapStop(pendingPromptSubscriptionHandle.stop) },
    pendingHarnessSessionSubscriptionHandle: {
      stop: wrapStop(pendingHarnessSessionSubscriptionHandle.stop),
    },
    commandSubscriptionHandle: { stop: wrapStop(commandSubscriptionHandle.stop) },
    lifecycleManager,
    closeSessionsOnShutdown: async () => {
      unregisterDirectHarnessInboundHandler();
      await closeAllMachineHarnessSessionsOnShutdown(session, {
        lifecycleManager,
        activeSessions,
        sessionRepository,
      });
    },
  };
}
