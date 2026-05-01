/**
 * Barrel re-export for the domain/direct-harness module.
 *
 * Import from this barrel for convenience:
 *   import type { HarnessWorker, DirectHarnessSpawner } from '../domain/direct-harness/index.js';
 */

export type {
  WorkerId,
  ChatroomId,
  HarnessSessionId,
  WorkerStatus,
  HarnessWorker,
} from './harness-worker.js';

export type {
  DirectHarnessSessionEvent,
  DirectHarnessSession,
} from './direct-harness-session.js';

export type {
  SpawnOptions,
  DirectHarnessSpawner,
} from './direct-harness-spawner.js';

export type {
  FlushContext,
  FlushStrategy,
  MessageStreamChunk,
  MessageStreamTransport,
  MessageStreamSink,
  MessageStreamSinkWarning,
} from './message-stream/index.js';
