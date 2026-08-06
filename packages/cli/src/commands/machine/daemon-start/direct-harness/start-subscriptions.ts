/**
 * Boots direct-harness workers (lifecycle manager + inbound registry).
 * WS subscribers removed in U13 — v2 direct-harness subscribers are sole listeners.
 */

import { drainPendingHarnessCommands, type CommandSubscriberDeps } from './command-processor.js';
import { HarnessLifecycleManager } from './harness-lifecycle-manager.js';
import { drainPendingHarnessMessages } from './prompt-drain.js';
import { processPendingHarnessSessions } from './session-processor.js';
import type { ActiveSession } from './session-processor.js';
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
  lifecycleManager: HarnessLifecycleManager;
  closeSessionsOnShutdown: () => Promise<void>;
  stop: () => void;
}

export function startDirectHarnessSubscriptions(
  session: DirectHarnessSubscriptionSession,
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

  return {
    lifecycleManager,
    closeSessionsOnShutdown: async () => {
      unregisterDirectHarnessInboundHandler();
      await closeAllMachineHarnessSessionsOnShutdown(session, {
        lifecycleManager,
        activeSessions,
        sessionRepository,
      });
    },
    stop: () => {
      unregisterDirectHarnessInboundHandler();
      lifecycleManager.stopMonitoring();
    },
  };
}
