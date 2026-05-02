/**
 * Runtime feature flags for the backend.
 *
 * Evaluated at module load time in each runtime environment:
 * - Convex serverless functions (backend)
 * - Daemon (CLI) — imports this for daemon-side guards
 *
 * ⚠️  DO NOT import this from the webapp (`apps/webapp/`).
 *     The webapp uses its own NEXT_PUBLIC_* env vars to mirror these gates,
 *     because Next.js and Convex evaluate process.env at different times.
 */

/**
 * Whether this runtime is a Convex production deployment.
 *
 * Uses the CONVEX_DEPLOYMENT env var set by Convex's deploy tooling:
 *   - 'prod:...'  → production deploy  → guarded features are DISABLED
 *   - 'dev:...'   → cloud dev deploy   → guarded features are ENABLED
 *   - 'local:...' → local dev server   → guarded features are ENABLED
 *   - undefined   → vitest / CLI       → guarded features are ENABLED
 *
 * This prevents accidentally enabling experimental features in production
 * while keeping them available for development and preview environments.
 */
const isConvexProdDeployment = (process.env.CONVEX_DEPLOYMENT ?? '').startsWith('prod:');

export const featureFlags = {
  observedSyncEnabled: false,
  disableLogin: false,
  /**
   * Enables direct-harness sessions: chatroom_harnessSessions,
   * chatroom_harnessSessionMessages, chatroom_machineRegistry, chatroom_pendingPrompts.
   * Backend mutations + queries throw when disabled, keeping the feature dark in prod.
   *
   * Gated via CONVEX_DEPLOYMENT env var:
   *   - prod:*    → false (never in production without explicit override)
   *   - dev:*     → true  (cloud dev deployment)
   *   - local:*   → true  (local dev server)
   *   - undefined → true  (test environments / CLI context)
   *
   * Webapp: mirror with NEXT_PUBLIC_DIRECT_HARNESS_ENABLED env var.
   * Both MUST be consistent per environment.
   */
  directHarnessWorkers: !isConvexProdDeployment,
};
