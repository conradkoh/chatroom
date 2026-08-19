import { createPublisherRegistry, type PublisherRegistry } from './publisher-registry.js';
import type { BackendOps } from '../../infrastructure/deps/index.js';
import type { PersistenceStore } from '../infrastructure/persistence/index.js';
import { createStreamHub, type StreamHub } from '../local-web/server/stream-hub.js';

export type DaemonDeps = {
  publishers: PublisherRegistry;
  persistence?: PersistenceStore;
  streamHub: StreamHub;
};

export function createDaemonDeps(
  opts: {
    persistence?: PersistenceStore;
    streamHub?: StreamHub;
    backend?: BackendOps;
    sessionId?: string;
    machineId?: string;
    logEvent?: (event: Record<string, unknown>) => Promise<void>;
  } = {}
): DaemonDeps {
  const streamHub = opts.streamHub ?? createStreamHub();
  return {
    persistence: opts.persistence,
    streamHub,
    publishers: createPublisherRegistry({
      persistence: opts.persistence,
      streamHub,
      backend: opts.backend,
      sessionId: opts.sessionId,
      machineId: opts.machineId,
      logEvent: opts.logEvent,
    }),
  };
}
