/**
 * Processes pending harness sessions — harness boot + session open.
 * WS subscription removed in U13 — v2 direct-harness-session subscriber nudges drains.
 */

import type { DirectHarnessSession } from './command-processor.js';
import { api } from '../../../../api.js';
import type { BoundHarness } from '../../../../v2/domain/entities/bound-harness.js';
import type {
  SessionRepository,
  JournalFactory,
  SessionHandle,
} from '../../../../v2/domain/usecase/open-harness-session.js';
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

export async function processPendingHarnessSessions(
  daemonSession: DirectHarnessSession,
  deps: SessionSubscriberDeps
): Promise<void> {
  const pendingSessions = (await daemonSession.backend.query(
    api.daemon.directHarness.sessions.listPendingSessionsForMachine,
    {
      sessionId: daemonSession.sessionId,
      machineId: daemonSession.machineId,
    }
  )) as PendingSession[] | null;

  await processPendingHarnessSessionRows(daemonSession, deps, pendingSessions);
}

async function processPendingHarnessSessionRows(
  daemonSession: DirectHarnessSession,
  deps: SessionSubscriberDeps,
  pendingSessions: PendingSession[] | null
): Promise<void> {
  if (!pendingSessions || pendingSessions.length === 0) return;

  for (const session of pendingSessions) {
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
  }
}
