/**
 * Development-only internal mutations.
 *
 * These are NOT exposed to the web or daemon callers. They are invoked locally
 * via `convex run --internal dev:cleanup` to clean up state, seed data, or
 * migrate schemas during development.
 *
 * Usage:
 *   cd services/backend
 *   npx convex run --internal dev:cleanup
 *
 * Or from the repo root:
 *   pnpm dev:convex
 */

import { internalMutation } from './_generated/server.js';

// ─── cleanup ──────────────────────────────────────────────────────────────────

/**
 * Clean up internal state from deprecated implementations.
 *
 * Run this after schema migrations or when old data needs purging:
 *   cd services/backend && npx convex run dev:cleanup
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const cleanup: any = internalMutation({
  handler: async () => {
    // TODO: add cleanup logic as needed
  },
});
