export const featureFlags = {
  observedSyncEnabled: false,
  disableLogin: false,
  /**
   * Enables direct-harness sessions: chatroom_harnessSessions,
   * chatroom_harnessSessionMessages, chatroom_machineRegistry, chatroom_pendingPrompts.
   * Backend mutations + queries throw when disabled, keeping the feature dark in prod.
   *
   * Resolved per environment at module load:
   *   - production (NODE_ENV === 'production'): false — never active in prod without explicit flip
   *   - dev / preview / test: true — safe to experiment
   *
   * To enable in production intentionally, set directHarnessWorkers: true explicitly.
   */
  directHarnessWorkers: process.env.NODE_ENV !== 'production',
};
