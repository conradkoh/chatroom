export const featureFlags = {
  observedSyncEnabled: false,
  disableLogin: false,
  /**
   * Enables chatroom_workers + chatroom_workerMessages tables for the
   * single-harness-workers feature. Mutations and queries are no-ops (throw)
   * when this flag is off, keeping the feature fully dark until ready.
   */
  directHarnessWorkers: false,
};
