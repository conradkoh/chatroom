/**
 * Runtime feature flags for the backend.
 *
 * ⚠️  DO NOT import this from the webapp (`apps/webapp/`).
 *     The webapp renders UI unconditionally for released features.
 */

export const featureFlags = {
  observedSyncEnabled: false,
  disableLogin: false,
  /** Direct-harness sessions feature. Always on; kill-switch via requireDirectHarnessWorkers helper. */
  directHarnessWorkers: true,
};
