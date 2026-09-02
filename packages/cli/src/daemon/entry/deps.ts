import { createPublisherRegistry, type PublisherRegistry } from './publisher-registry.js';
import type { BackendOps } from '../../infrastructure/deps/index.js';
import type { PersistenceStore } from '../infrastructure/persistence/index.js';
import { createStreamHub, type StreamHub } from '../local-web/server/stream-hub.js';

export type DaemonDeps = {
  publishers: PublisherRegistry;
  persistence?: PersistenceStore | undefined;
  streamHub: StreamHub;
};

export function createDaemonDeps(
  opts: {
    persistence?: PersistenceStore | undefined;
    streamHub?: StreamHub | undefined;
    backend?: BackendOps | undefined;
    sessionId?: string | undefined;
    machineId?: string | undefined;
    logEvent?:( (event: Record<string, unknown>) => Promise<void>) | undefined;
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
