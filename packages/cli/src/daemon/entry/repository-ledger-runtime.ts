/**
 * Lazy process-wide holder for the repository ledger service.
 *
 * Command dispatch and daemon boot must share ONE instance so their refreshes
 * coalesce. The service is created on first use, after the daemon session is
 * available.
 */

import { createRepositoryLedgerPorts } from './bridge/repository-ledger-bridge.js';
import type { DaemonSessionServiceShape } from './daemon-services.js';
import {
  createRepositoryLedgerService,
  type RepositoryLedgerService,
} from '../domain/usecase/repository-ledger-service.js';

let service: RepositoryLedgerService | null = null;

/** One service per daemon process: shared coalescing state across boot and command triggers. */
export function getRepositoryLedgerService(
  session: DaemonSessionServiceShape
): RepositoryLedgerService {
  service ??= createRepositoryLedgerService(createRepositoryLedgerPorts(session));
  return service;
}
