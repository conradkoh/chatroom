/**
 * Barrel re-export for the application/direct-harness module.
 */

export { spawnWorker } from './spawn-worker.js';
export type {
  SpawnWorkerDeps,
  SpawnWorkerOptions,
  SpawnWorkerBackend,
  WorkerHandle,
} from './spawn-worker.js';

export { resumeWorker } from './resume-worker.js';
export type { ResumeWorkerDeps, ResumeWorkerOptions } from './resume-worker.js';
