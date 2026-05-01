/**
 * worker spawn — spawn a new direct-harness worker for a chatroom.
 */

import type { WorkerSpawnDeps } from './deps.js';
import { spawnWorker } from '../../../application/direct-harness/spawn-worker.js';
import { getMachineId } from '../../../infrastructure/machine/index.js';
import { getSessionId } from '../../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../../infrastructure/convex/client.js';
import { defaultHarnessFactory } from '../harness-registry.js';
import { openCodeChunkExtractor } from './opencode-chunk-extractor.js';

// ─── Public interface ─────────────────────────────────────────────────────────

export type { WorkerSpawnDeps } from './deps.js';

export interface WorkerSpawnOptions {
  chatroomId: string;
  role: string;
  /** Harness to use. Default: 'opencode-sdk'. */
  harness?: string;
  cwd?: string;
}

// ─── Default Deps Factory ─────────────────────────────────────────────────────

async function createDefaultDeps(): Promise<WorkerSpawnDeps> {
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
 * Spawn a new worker for the given chatroom using the specified harness.
 * Prints the workerId and harnessSessionId to stdout on success.
 */
export async function workerSpawn(
  options: WorkerSpawnOptions,
  deps?: WorkerSpawnDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const { chatroomId, role, harness: harnessName = 'opencode-sdk', cwd } = options;

  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    console.error('❌ Not authenticated. Please run: chatroom auth login');
    process.exit(1);
    return;
  }

  const machineId = getMachineId();
  if (!machineId) {
    console.error('❌ Machine not registered. Please run: chatroom daemon start');
    process.exit(1);
    return;
  }

  const spawnFn = d.spawnWorkerImpl ?? spawnWorker;
  const harness = d.harnessFactory(harnessName);

  // Pick the right chunk extractor for the selected harness.
  // For now only opencode-sdk is supported; future harnesses get their own extractor.
  const chunkExtractor = openCodeChunkExtractor;

  const worker = await spawnFn(
    { backend: d.backend, sessionId, harness, chunkExtractor },
    { chatroomId, machineId, role, cwd }
  );

  d.stdout(`workerId: ${worker.workerId}`);
  d.stdout(`harnessSessionId: ${worker.harnessSessionId}`);

  // The harness process runs detached — we do NOT close the worker here.
  // The session metadata is persisted in FileSessionMetadataStore so a future
  // 'worker resume' can reattach without re-spawning.
  process.exit(0);
}
