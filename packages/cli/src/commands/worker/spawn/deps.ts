/**
 * Dependency interfaces for the worker spawn command.
 */

import type { DirectHarnessSpawner } from '../../../domain/direct-harness/index.js';
import type { SpawnWorkerDeps } from '../../../application/direct-harness/spawn-worker.js';

export interface WorkerSpawnDeps {
  readonly backend: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutation: (endpoint: any, args: any) => Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: (endpoint: any, args: any) => Promise<any>;
  };
  readonly session: {
    getSessionId: () => string | null;
  };
  readonly harnessFactory: (name: string) => DirectHarnessSpawner;
  readonly stdout: (line: string) => void;
  /**
   * Optional injection for testing — overrides the spawnWorker implementation.
   * Defaults to the real spawnWorker from the application layer.
   */
  readonly spawnWorkerImpl?: typeof import('../../../application/direct-harness/spawn-worker.js').spawnWorker;
}

/** Extract the SpawnWorkerDeps subset from WorkerSpawnDeps. */
export function toSpawnWorkerDeps(
  deps: WorkerSpawnDeps,
  sessionId: string,
  harnessName: string
): Omit<SpawnWorkerDeps, 'chunkExtractor'> {
  return {
    backend: deps.backend,
    sessionId,
    harness: deps.harnessFactory(harnessName),
  };
}
