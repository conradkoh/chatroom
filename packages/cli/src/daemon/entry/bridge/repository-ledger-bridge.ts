/**
 * Builds the repository ledger service's ports from the daemon session.
 * Argument mapping only, no logic.
 */

import { api } from '../../../api.js';
import { scanRepositories } from '../../../infrastructure/local-actions/scan-repositories.js';
import type { RepositoryLedgerPorts } from '../../domain/usecase/repository-ledger-service.js';
import { createRepositoryLedgerStore } from '../../infrastructure/local/repository-ledger-store.js';
import type { DaemonSessionServiceShape } from '../daemon-services.js';
import { resolveRepositoryLedgerPath } from '../repository-ledger-path.js';

export function createRepositoryLedgerPorts(
  session: DaemonSessionServiceShape
): RepositoryLedgerPorts {
  return {
    fetchRoots: async () => {
      const result = await session.backend.query(api.machineProjectRoots.list, {
        sessionId: session.sessionId,
        machineId: session.machineId,
      });
      return result.roots.map((root: { path: string }) => root.path);
    },
    scan: (roots) => scanRepositories({ roots }),
    store: createRepositoryLedgerStore(resolveRepositoryLedgerPath(session.machineId)),
    now: () => Date.now(),
  };
}
