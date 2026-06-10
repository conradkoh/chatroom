/**
 * Auth status command
 * Shows current authentication status and local machine info
 * Phase 3: Migrated to Effect-TS services with typed error handling.
 */

import { Effect, Layer } from 'effect';

import { AuthSessionService } from './auth-status-service.js';
import type { AuthStatusDeps } from './deps.js';
import { api } from '../../api.js';
import {
  loadAuthData,
  getAuthFilePath,
  isAuthenticated,
} from '../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../infrastructure/convex/client.js';
import { loadMachineConfig } from '../../infrastructure/machine/index.js';
import { BackendService, BackendServiceLive } from '../../infrastructure/services/index.js';
import { getVersion } from '../../version.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { AuthStatusDeps } from './deps.js';

// ─── Domain errors ─────────────────────────────────────────────────────────

export type AuthStatusError =
  | { readonly _tag: 'NotAuthenticated' }
  | { readonly _tag: 'SessionLoadError'; readonly cause: Error }
  | { readonly _tag: 'BackendError'; readonly cause: Error };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<AuthStatusDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      query: (endpoint, args) => client.query(endpoint, args),
    },
    session: {
      loadAuthData,
      getAuthFilePath,
      isAuthenticated,
    },
    getVersion,
    loadMachineConfig,
  };
}

/**
 * Build Effect Layer from AuthStatusDeps (for backward-compat with tests)
 */
function layerFromDeps(deps: AuthStatusDeps): Layer.Layer<BackendService | AuthSessionService> {
  return Layer.mergeAll(
    BackendServiceLive({
      query: deps.backend.query,
      mutation: () => Promise.reject(new Error('mutations not used in auth-status')),
    }),
    Layer.succeed(AuthSessionService, {
      loadAuthData: () =>
        Effect.tryPromise({
          try: () => deps.session.loadAuthData(),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        }),
      getAuthFilePath: () => Effect.sync(() => deps.session.getAuthFilePath()),
      isAuthenticated: () => Effect.promise(() => deps.session.isAuthenticated()),
      getVersion: () => Effect.sync(() => deps.getVersion()),
      loadMachineConfig: () => Effect.promise(() => deps.loadMachineConfig()),
    })
  );
}

// ─── Effect Programs ───────────────────────────────────────────────────────

/**
 * Pure Effect program — no process.exit, no console.error inside.
 * All errors are typed; caller decides how to handle them.
 */
// fallow-ignore-next-line unused-export
export const authStatusEffect = (): Effect.Effect<
  void,
  AuthStatusError,
  BackendService | AuthSessionService
> =>
  Effect.gen(function* () {
    const authSession = yield* AuthSessionService;

    // Print header
    yield* Effect.sync(() => {
      console.log(`\n${'═'.repeat(50)}`);
      console.log(`🔐 AUTHENTICATION STATUS`);
      console.log(`${'═'.repeat(50)}`);
    });

    // Load auth data
    const authData = yield* authSession
      .loadAuthData()
      .pipe(Effect.mapError((cause): AuthStatusError => ({ _tag: 'SessionLoadError', cause })));

    // Check authentication
    const authenticated = yield* authSession.isAuthenticated();

    if (!authenticated || !authData) {
      yield* Effect.sync(() => {
        console.log(`\n❌ Not authenticated`);
        console.log(`\n   Run: chatroom auth login`);
      });
      return yield* Effect.fail<AuthStatusError>({ _tag: 'NotAuthenticated' });
    }

    // Display auth info
    const authFilePath = yield* authSession.getAuthFilePath();
    const version = yield* authSession.getVersion();

    yield* Effect.sync(() => {
      console.log(`\n📁 Auth file: ${authFilePath}`);
      console.log(`📅 Created: ${authData.createdAt}`);
      if (authData.deviceName) {
        console.log(`💻 Device: ${authData.deviceName}`);
      }
      console.log(`📦 CLI Version: ${version}`);
      console.log(`\n⏳ Validating session...`);
    });

    // Validate session with backend
    const backend = yield* BackendService;
    const validation = yield* backend
      .query<{ valid: boolean; userName?: string; reason?: string }>(api.cliAuth.validateSession, {
        sessionId: authData.sessionId,
      })
      .pipe(Effect.mapError((cause): AuthStatusError => ({ _tag: 'BackendError', cause })));

    // Display validation result
    yield* Effect.sync(() => {
      if (validation.valid) {
        console.log(`\n✅ Session is valid`);
        if (validation.userName) {
          console.log(`👤 User: ${validation.userName}`);
        }
      } else {
        console.log(`\n❌ Session is invalid: ${validation.reason}`);
        console.log(`\n   Run: chatroom auth login`);
      }
    });

    // Display machine info
    const machineConfig = yield* authSession.loadMachineConfig();

    yield* Effect.sync(() => {
      if (machineConfig) {
        console.log(`\n🖥️  Machine: ${machineConfig.hostname}`);
        console.log(`   ID: ${machineConfig.machineId}`);
        if (machineConfig.availableHarnesses.length > 0) {
          console.log(`   Harnesses: ${machineConfig.availableHarnesses.join(', ')}`);
        }
      } else {
        console.log(`\n🖥️  Machine: not registered`);
        console.log(`   Run \`chatroom machine start\` to register this machine.`);
      }
    });
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 * This is the ONLY place process.exit is called in the Effect pipeline.
 */
function handleAuthStatusError(err: AuthStatusError): Effect.Effect<void> {
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      // Already printed message in the Effect pipeline - just return without exiting
      // The original auth-status command did not exit on not authenticated
      return;
    }
    if (err._tag === 'SessionLoadError') {
      console.error(`❌ Could not load auth data: ${err.cause.message}`);
      process.exit(1);
    } else {
      console.log(`\n⚠️  Could not validate session: ${err.cause.message}`);
      console.log(`   Session may still be valid. Try running a command.`);
      // Don't exit for backend errors during validation
    }
  });
}

// ─── Entry Point (public API — unchanged signature) ──────────────────────

/**
 * Display auth status with backend validation
 * Runs the Effect and converts typed errors to process.exit + console.error.
 */
export async function authStatus(deps?: AuthStatusDeps): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = layerFromDeps(d);

  await Effect.runPromise(
    authStatusEffect().pipe(
      Effect.catchAll((err) => handleAuthStatusError(err)),
      Effect.provide(layer)
    )
  );
}
