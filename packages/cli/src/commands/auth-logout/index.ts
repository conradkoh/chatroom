/**
 * Auth logout command
 * Clears CLI authentication
 */

import type { AuthLogoutDeps } from './deps.js';
import {
  clearAuthData,
  getAuthFilePath,
  isAuthenticated,
} from '../../infrastructure/auth/storage.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { AuthLogoutDeps } from './deps.js';

// ─── Default Deps Factory ──────────────────────────────────────────────────

function createDefaultDeps(): AuthLogoutDeps {
  return {
    session: {
      isAuthenticated,
      clearAuthData,
      getAuthFilePath,
    },
  };
}

// ─── Entry Point ───────────────────────────────────────────────────────────

export async function authLogout(deps?: AuthLogoutDeps): Promise<void> {
  const d = deps ?? createDefaultDeps();

  if (!d.session.isAuthenticated()) {
    console.log(`ℹ️  Not currently authenticated.`);
    return;
  }

  const cleared = d.session.clearAuthData();

  if (cleared) {
    console.log(`✅ Logged out successfully.`);
    console.log(`   Removed: ${d.session.getAuthFilePath()}`);
  } else {
    console.error(`❌ Failed to clear authentication data.`);
    process.exit(1);
    return;
  }
}
