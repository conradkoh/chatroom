/**
 * Dependency interfaces for the worker resume command.
 */

import type { DirectHarnessSpawner } from '../../../domain/direct-harness/index.js';

export interface WorkerResumeDeps {
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
   * Optional injection for testing — overrides the resumeWorker implementation.
   */
  readonly resumeWorkerImpl?: typeof import('../../../application/direct-harness/resume-worker.js').resumeWorker;
}
