/**
 * Subscribes to pending harness sessions via Convex WS and orchestrates
 * harness boot + session open via the shared openPendingHarnessSession helper.
 *
 * Unlike the CLI `session open` command (which uses the domain `openSession`
 * use case end-to-end), this subscriber processes sessions that were already
 * created by the webapp. The backend row exists — we just need to spawn the
 * harness, open a session on it, wire the journal, and associate the IDs.
 */

import type { ConvexClient } from 'convex/browser';

import type { DirectHarnessSession } from './command-subscriber.js';
import { api } from '../../../../api.js';
import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import type { SessionRepository } from '../../../../domain/direct-harness/ports/session-repository.js';
import type {
  JournalFactory,
  SessionHandle,
} from '../../../../domain/direct-harness/usecases/open-session.js';
import { openPendingHarnessSession } from '../shared-harness/open-pending-session.js';

export type ActiveSession = SessionHandle;

export interface SessionSubscriberDeps {
  readonly activeSessions: Map<string, ActiveSession>;
  readonly harnesses: Map<string, BoundHarness>;
  readonly sessionRepository: SessionRepository;
  readonly journalFactory: JournalFactory;
}

export interface SessionSubscriberHandle {
  stop(): void;
}

interface PendingSession {
  _id: string;
  workspaceId: string;
  opencode?: {
    harnessName?: string;
    lastUsedConfig?: { agent: string; model?: { providerID: string; modelID: string } };
  };
}

export function startSessionSubscriber(
  daemonSession: DirectHarnessSession,
  wsClient: ConvexClient,
  deps: SessionSubscriberDeps
): SessionSubscriberHandle {
  const inFlight = new Set<string>();

  const unsub = wsClient.onUpdate(
    api.daemon.directHarness.sessions.listPendingSessionsForMachine,
    {
      sessionId: daemonSession.sessionId,
      machineId: daemonSession.machineId,
    },
    (pendingSessions: PendingSession[] | null) => {
      if (!pendingSessions || pendingSessions.length === 0) return;

      for (const session of pendingSessions) {
        const rowId = session._id;
        if (inFlight.has(rowId)) continue;
        inFlight.add(rowId);
        void (async () => {
          const harnessName = session.opencode?.harnessName ?? 'opencode-sdk';
          const agent = session.opencode?.lastUsedConfig?.agent ?? 'build';
          const model = session.opencode?.lastUsedConfig?.model;
          await openPendingHarnessSession(
            daemonSession,
            deps,
            {
              rowId: session._id,
              workspaceId: session.workspaceId,
              harnessName,
              lastUsedConfig: { agent, ...(model ? { model } : {}) },
            },
            { logPrefix: '[direct-harness]', handleProviderIdEvents: true }
          );
        })().finally(() => inFlight.delete(rowId));
      }
    },
    (err: unknown) => {
      console.warn(
        '[direct-harness] Session subscription error:',
        err instanceof Error ? err.message : String(err)
      );
    }
  );

  return { stop: unsub };
}
