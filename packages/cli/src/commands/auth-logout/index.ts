/**
 * Auth logout command
 * Clears CLI authentication
 * Phase 5: Migrated to Effect-TS services with typed error handling.
 */

import { Effect, Layer } from 'effect';

import { AuthLogoutService } from './auth-logout-service.js';
import type { AuthLogoutDeps } from './deps.js';
import {
  clearAuthData,
  getAuthFilePath,
  isAuthenticated,
} from '../../infrastructure/auth/storage.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { AuthLogoutDeps } from './deps.js';

// ─── Domain errors ─────────────────────────────────────────────────────────

export type AuthLogoutError = { readonly _tag: 'ClearFailed' };

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

/**
 * Build Effect Layer from AuthLogoutDeps (for backward-compat with tests)
 */
function layerFromDeps(deps: AuthLogoutDeps): Layer.Layer<AuthLogoutService> {
  return Layer.succeed(AuthLogoutService, {
    isAuthenticated: () => Effect.promise(() => deps.session.isAuthenticated()),
    clearAuthData: () => Effect.promise(() => deps.session.clearAuthData()),
    getAuthFilePath: () => Effect.sync(() => deps.session.getAuthFilePath()),
  });
}

// ─── Effect Programs ───────────────────────────────────────────────────────

/**
 * Pure Effect program — no process.exit, no console.error inside.
 */
// fallow-ignore-next-line unused-export
export const authLogoutEffect = (): Effect.Effect<void, AuthLogoutError, AuthLogoutService> =>
  Effect.gen(function* () {
    const authService = yield* AuthLogoutService;

    // Check if authenticated
    const authenticated = yield* authService.isAuthenticated();

    if (!authenticated) {
      // Not an error, just informational
      yield* Effect.sync(() => {
        console.log(`ℹ️  Not currently authenticated.`);
      });
      return;
    }

    // Clear auth data
    const cleared = yield* authService.clearAuthData();

    if (!cleared) {
      return yield* Effect.fail<AuthLogoutError>({ _tag: 'ClearFailed' });
    }

    // Get file path and print success
    const filePath = yield* authService.getAuthFilePath();

    yield* Effect.sync(() => {
      console.log(`✅ Logged out successfully.`);
      console.log(`   Removed: ${filePath}`);
    });
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 */
function handleAuthLogoutError(err: AuthLogoutError): Effect.Effect<void> {
  return Effect.sync(() => {
    if (err._tag === 'ClearFailed') {
      console.error(`❌ Failed to clear authentication data.`);
      process.exit(1);
    }
  });
}

// ─── Entry Point (public API — unchanged signature) ──────────────────────

export async function authLogout(deps?: AuthLogoutDeps): Promise<void> {
  const d = deps ?? createDefaultDeps();
  const layer = layerFromDeps(d);

  await Effect.runPromise(
    authLogoutEffect().pipe(
      Effect.catchAll((err) => handleAuthLogoutError(err)),
      Effect.provide(layer)
    )
  );
}
