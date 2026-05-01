/**
 * worker resume — reattach to an existing direct-harness worker session.
 */

import type { WorkerResumeDeps } from './deps.js';
import { resumeWorker } from '../../../application/direct-harness/resume-worker.js';
import { getMachineId } from '../../../infrastructure/machine/index.js';
import { getSessionId } from '../../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../../infrastructure/convex/client.js';
import { defaultHarnessFactory } from '../harness-registry.js';
import { openCodeChunkExtractor } from '../spawn/opencode-chunk-extractor.js';

// ─── Public interface ─────────────────────────────────────────────────────────

export type { WorkerResumeDeps } from './deps.js';

export interface WorkerResumeOptions {
  workerId: string;
  harnessSessionId: string;
  /** Harness to use. Default: 'opencode-sdk'. */
  harness?: string;
}

// ─── Default Deps Factory ─────────────────────────────────────────────────────

async function createDefaultDeps(): Promise<WorkerResumeDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
      query: (endpoint, args) => client.query(endpoint, args),
    },
    session: { getSessionId },
    harnessFactory: defaultHarnessFactory,
    stdout: (line) => process.stdout.write(line + '\n'),
  };
}

// ─── Command implementation ───────────────────────────────────────────────────

/**
 * Resume an existing worker by reattaching to its harness session.
 * Prints a confirmation line to stdout on success.
 */
export async function workerResume(
  options: WorkerResumeOptions,
  deps?: WorkerResumeDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const { workerId, harnessSessionId, harness: harnessName = 'opencode-sdk' } = options;

  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    console.error('❌ Not authenticated. Please run: chatroom auth login');
    process.exit(1);
    return;
  }

  const resumeFn = d.resumeWorkerImpl ?? resumeWorker;
  const harness = d.harnessFactory(harnessName);

  const worker = await resumeFn(
    { backend: d.backend, sessionId, harness, chunkExtractor: openCodeChunkExtractor },
    { workerId, harnessSessionId }
  );

  d.stdout(`resumed workerId: ${worker.workerId}`);
  d.stdout(`harnessSessionId: ${worker.harnessSessionId}`);

  process.exit(0);
}
