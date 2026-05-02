export const featureFlags = {
  observedSyncEnabled: false,
  disableLogin: false,
  /**
   * Enables direct-harness sessions: chatroom_harnessSessions,
   * chatroom_harnessSessionMessages, chatroom_machineRegistry, chatroom_pendingPrompts.
   * Backend mutations + queries throw when disabled, keeping the feature dark in prod.
   *
   * dev/preview: true   — safe to experiment
   * prod:        false  — explicit user decision required to enable in production
   */
  directHarnessWorkers: true,
};
