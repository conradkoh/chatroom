import { createPublisherRegistry, type PublisherRegistry } from './publisher-registry.js';
import type { PersistenceStore } from '../infrastructure/persistence/index.js';

export type DaemonDeps = {
  publishers: PublisherRegistry;
  persistence?: PersistenceStore;
};

export function createDaemonDeps(opts: { persistence?: PersistenceStore } = {}): DaemonDeps {
  return {
    persistence: opts.persistence,
    publishers: createPublisherRegistry({ persistence: opts.persistence }),
  };
}
