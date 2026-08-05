import type { PublisherRegistry } from './publisher-registry.js';

/** Dependency bag injected into use cases — replaces daemon-layers Effect services. */
export type DaemonDeps = {
  publishers: PublisherRegistry;
  // TODO: machine config, harness ports, persistence
};

export function createDaemonDeps(): DaemonDeps {
  return {
    publishers: { publish: async () => {} },
  };
}
