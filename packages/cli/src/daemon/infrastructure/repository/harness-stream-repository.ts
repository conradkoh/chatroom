import type { HarnessStreamReader } from '../../domain/usecase/list-harness-history.js';
import type { PersistenceStore } from '../persistence/persistence-store.js';

export type HarnessStreamRepository = HarnessStreamReader;

export function createHarnessStreamRepository(
  persistence: PersistenceStore
): HarnessStreamRepository {
  return {
    listLines: (opts) => persistence.listHarnessStreamLines(opts),
  };
}

export function createEmptyHarnessStreamRepository(): HarnessStreamRepository {
  return { listLines: () => [] };
}
