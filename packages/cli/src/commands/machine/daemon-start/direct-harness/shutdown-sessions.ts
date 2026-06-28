/**
 * Gracefully close all direct-harness sessions owned by this machine on daemon shutdown.
 *
 * Active sessions flush journals and close live harness handles; idle sessions resume
 * briefly to close the harness process; pending sessions are marked closed in Convex.
 */

import {
  closeHarnessSession,
  type CommandSubscriberDeps,
  type DirectHarnessSession,
} from './command-subscriber.js';
import type { HarnessLifecycleManager } from './harness-lifecycle-manager.js';
import type { ActiveSession } from './session-subscriber.js';
import { api } from '../../../../api.js';
import type { SessionRepository } from '../../../../domain/direct-harness/ports/session-repository.js';

export interface DirectHarnessShutdownDeps {
  readonly lifecycleManager: HarnessLifecycleManager;
  readonly activeSessions: Map<string, ActiveSession>;
  readonly sessionRepository: SessionRepository;
}

async function listHarnessSessionIdsForShutdown(session: DirectHarnessSession): Promise<string[]> {
  const ids = new Set<string>();

  const managed = await session.backend.query(
    api.daemon.directHarness.turns.getMachineHarnessSessions,
    {
      sessionId: session.sessionId,
      machineId: session.machineId,
    }
  );
  for (const row of managed) {
    ids.add(row.harnessSessionId);
  }

  const pending = await session.backend.query(
    api.daemon.directHarness.sessions.listPendingSessionsForMachine,
    {
      sessionId: session.sessionId,
      machineId: session.machineId,
    }
  );
  for (const row of pending) {
    ids.add(row._id);
  }

  return [...ids];
}

/** Close every non-terminal harness session for this machine. Best-effort per session. */
// fallow-ignore-next-line complexity
export async function closeAllMachineHarnessSessionsOnShutdown(
  session: DirectHarnessSession,
  deps: DirectHarnessShutdownDeps
): Promise<void> {
  const commandDeps: CommandSubscriberDeps = {
    lifecycleManager: deps.lifecycleManager,
    publisher: {} as CommandSubscriberDeps['publisher'],
    activeSessions: deps.activeSessions,
    sessionRepository: deps.sessionRepository,
  };

  const harnessSessionIds = await listHarnessSessionIdsForShutdown(session);
  if (harnessSessionIds.length === 0) return;

  console.log(
    `[direct-harness] Closing ${harnessSessionIds.length} harness session(s) on daemon shutdown...`
  );

  for (const harnessSessionId of harnessSessionIds) {
    try {
      await session.backend.mutation(api.daemon.directHarness.turns.markOrphanTurnsFailed, {
        sessionId: session.sessionId,
        machineId: session.machineId,
        harnessSessionId,
      });
    } catch {
      // Best-effort — continue closing the session row
    }

    try {
      await closeHarnessSession(session, commandDeps, harnessSessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[direct-harness] Failed to close session ${harnessSessionId} on shutdown: ${message}`
      );
      try {
        await deps.sessionRepository.markClosed(harnessSessionId);
      } catch {
        // Best-effort fallback
      }
    }
  }
}
