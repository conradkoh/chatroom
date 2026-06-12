/**
 * Auth login command
 * Implements device authorization flow for CLI authentication.
 * Phase 10: Migrated to Effect-TS services with typed error handling.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { Effect, Layer } from 'effect';

import { AuthLoginEnvService } from './auth-login-service.js';
import type { AuthLoginDeps } from './deps.js';
import { api } from '../../api.js';
import {
  saveAuthData,
  getDeviceName,
  getCliVersion,
  isAuthenticated,
  getAuthFilePath,
  getSessionId,
} from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import { BackendService, BackendServiceLive } from '../../infrastructure/services/index.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { AuthLoginDeps } from './deps.js';

// ─── Domain errors ─────────────────────────────────────────────────────────

export type AuthLoginError =
  | { readonly _tag: 'AlreadyAuthenticated' }
  | { readonly _tag: 'DeviceSessionCreateFailed'; readonly cause: Error }
  | { readonly _tag: 'LoginTimeout' }
  | { readonly _tag: 'SaveFailed'; readonly cause: Error };

// Poll interval for checking auth status
const AUTH_POLL_INTERVAL_MS = 2000;

// Production URLs
const PRODUCTION_CONVEX_URL = 'https://chatroom-cloud.duskfare.com';
const PRODUCTION_WEBAPP_URL = 'https://chatroom.duskfare.com';

interface AuthLoginOptions {
  force?: boolean;
}

/**
 * Open URL in the default browser (production implementation)
 */
async function openBrowser(url: string): Promise<void> {
  const { spawn } = await import('node:child_process');

  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
    } else if (platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
      child.unref();
    } else {
      // Linux and others
      const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
    }
  } catch {
    // If opening browser fails, user can manually visit the URL
    console.log(`\n⚠️  Could not open browser automatically.`);
    console.log(`   Please visit the URL manually.`);
  }
}

/**
 * Create the default production dependencies.
 */
export function createDefaultDeps(): AuthLoginDeps {
  return {
    backend: {
      mutation: async (endpoint, args) => {
        const client = await getConvexClient();
        return client.mutation(endpoint, args);
      },
      query: async (endpoint, args) => {
        const client = await getConvexClient();
        return client.query(endpoint, args);
      },
    },
    auth: {
      isAuthenticated,
      getAuthFilePath,
      saveAuthData,
      getDeviceName,
      getCliVersion,
      getSessionId,
    },
    browser: {
      open: openBrowser,
    },
    clock: {
      now: () => Date.now(),
      delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
    process: {
      env: process.env as Record<string, string | undefined>,
      platform: process.platform,
      exit: (code) => process.exit(code),
      stdoutWrite: (text) => process.stdout.write(text),
    },
  };
}

/**
 * Get the webapp URL for the auth page.
 *
 * For production Convex URL, uses production webapp.
 * For non-production Convex URL, requires CHATROOM_WEB_URL to be set explicitly.
 */
export function getWebAppUrl(d: AuthLoginDeps): string {
  const convexUrl = getConvexUrl();

  // Production Convex → Production webapp
  if (convexUrl === PRODUCTION_CONVEX_URL) {
    return PRODUCTION_WEBAPP_URL;
  }

  // Non-production: require explicit CHATROOM_WEB_URL
  const webAppUrlOverride = d.process.env.CHATROOM_WEB_URL;
  if (webAppUrlOverride) {
    return webAppUrlOverride;
  }

  // Error: non-production Convex URL without CHATROOM_WEB_URL
  console.error(`\n${'═'.repeat(50)}`);
  console.error(`❌ CHATROOM_WEB_URL Required`);
  console.error(`${'═'.repeat(50)}`);
  console.error(`\nYou are using a non-production Convex backend:`);
  console.error(`   CHATROOM_CONVEX_URL=${convexUrl}`);
  console.error(`\nTo authenticate with a local/dev backend, you must also set`);
  console.error(`the webapp URL where the auth page is hosted:`);
  console.error(`\n   CHATROOM_WEB_URL=http://localhost:3000 \\`);
  console.error(`   CHATROOM_CONVEX_URL=${convexUrl} \\`);
  console.error(`   chatroom auth login`);
  console.error(`\n${'═'.repeat(50)}\n`);
  d.process.exit(1);
  return ''; // unreachable in production, needed for type safety in tests
}

// ─── Layer Factory ─────────────────────────────────────────────────────────

/**
 * Build Effect layers from AuthLoginDeps (backward-compat bridge for existing entry point).
 */
function layerFromDeps(deps: AuthLoginDeps): Layer.Layer<BackendService | AuthLoginEnvService> {
  return Layer.mergeAll(
    BackendServiceLive({
      mutation: deps.backend.mutation,
      query: deps.backend.query,
    }),
    Layer.succeed(AuthLoginEnvService, {
      isAuthenticated: () => Effect.promise(() => deps.auth.isAuthenticated()),
      getAuthFilePath: () => Effect.sync(() => deps.auth.getAuthFilePath()),
      saveAuthData: (data) =>
        Effect.tryPromise({
          try: () => deps.auth.saveAuthData(data),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        }),
      getDeviceName: () => Effect.promise(() => deps.auth.getDeviceName()),
      getCliVersion: () => Effect.sync(() => deps.auth.getCliVersion()),
      getSessionId: () => Effect.promise(() => deps.auth.getSessionId()),
      openBrowser: (url) => Effect.promise(() => deps.browser.open(url)),
      now: () => Effect.sync(() => deps.clock.now()),
      delay: (ms) => Effect.promise(() => deps.clock.delay(ms)),
      env: () => Effect.sync(() => deps.process.env),
      stdoutWrite: (text) =>
        Effect.sync(() => {
          deps.process.stdoutWrite(text);
        }),
    })
  );
}

// ─── Effect Program ────────────────────────────────────────────────────────

/**
 * Pure Effect program — no process.exit inside.
 * All errors are typed; caller (handleAuthLoginError) decides how to handle them.
 */
// fallow-ignore-next-line unused-export
export const authLoginEffect = (
  options: AuthLoginOptions
): Effect.Effect<void, AuthLoginError, BackendService | AuthLoginEnvService> =>
  Effect.gen(function* () {
    const envService = yield* AuthLoginEnvService;
    const backend = yield* BackendService;

    // 1. Check if already authenticated (skip if force)
    const authenticated = yield* envService.isAuthenticated();
    if (authenticated && !options.force) {
      const sessionId = yield* envService.getSessionId();
      if (sessionId) {
        const authFilePath = yield* envService.getAuthFilePath();

        // Validate session against backend; trust local file on network failure
        const keepAuthenticated = yield* backend
          .query<{ valid: boolean; reason?: string }>(api.cliAuth.validateSession, { sessionId })
          .pipe(
            Effect.match({
              onFailure: (_e) => {
                console.log(`✅ Already authenticated (could not verify with backend).`);
                console.log(`   Auth file: ${authFilePath}`);
                console.log(`\n   Use --force to re-authenticate.`);
                return true;
              },
              onSuccess: (v) => {
                if (v.valid) {
                  console.log(`✅ Already authenticated.`);
                  console.log(`   Auth file: ${authFilePath}`);
                  console.log(`\n   Use --force to re-authenticate.`);
                  return true;
                }
                // Session invalid on backend — fall through to re-authenticate
                if (v.reason === 'Session expired') {
                  console.log(`\n⚠️  Your session has expired. Re-authenticating automatically...`);
                } else {
                  console.log(
                    `\n⚠️  Session is no longer valid (${v.reason}). Re-authenticating...`
                  );
                }
                return false;
              },
            })
          );

        if (keepAuthenticated) {
          return yield* Effect.fail<AuthLoginError>({ _tag: 'AlreadyAuthenticated' });
        }
      }
    }

    // 2. Get device info
    const deviceName = yield* envService.getDeviceName();
    const cliVersion = yield* envService.getCliVersion();
    const convexUrl = getConvexUrl();

    yield* Effect.sync(() => {
      console.log(`\n${'═'.repeat(50)}`);
      console.log(`🔐 CHATROOM CLI AUTHENTICATION`);
      console.log(`${'═'.repeat(50)}`);
      console.log(`\nDevice: ${deviceName}`);
      console.log(`CLI Version: ${cliVersion}`);
      if (convexUrl !== PRODUCTION_CONVEX_URL) {
        console.log(`\n📍 Environment: Custom`);
        console.log(`   Convex URL: ${convexUrl}`);
      }
      console.log(`\n⏳ Creating authentication request...`);
    });

    // 3. Create auth request
    const authRequest = yield* backend
      .mutation<{ requestId: string; expiresAt: number }>(api.cliAuth.createAuthRequest, {
        deviceName,
        cliVersion,
      })
      .pipe(
        Effect.mapError((cause): AuthLoginError => ({ _tag: 'DeviceSessionCreateFailed', cause }))
      );

    const { requestId, expiresAt } = authRequest;

    // 4. Compute web app URL from env
    const envData = yield* envService.env();
    const webAppUrl = (() => {
      if (convexUrl === PRODUCTION_CONVEX_URL) {
        return PRODUCTION_WEBAPP_URL;
      }
      const override = envData.CHATROOM_WEB_URL;
      if (override) return override;
      // Configuration defect — non-production backend without CHATROOM_WEB_URL
      throw new Error('CHATROOM_WEB_URL is required for non-production backends');
    })();

    const nowMs = yield* envService.now();
    yield* Effect.sync(() => {
      const expiresInSeconds = Math.round((expiresAt - nowMs) / 1000);
      console.log(`\n✅ Auth request created`);
      console.log(`   Request ID: ${requestId.substring(0, 8)}...`);
      console.log(`   Expires in: ${expiresInSeconds} seconds`);
    });

    const authUrl = `${webAppUrl}/cli-auth?request=${requestId}`;
    yield* Effect.sync(() => {
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`📱 AUTHORIZATION REQUIRED`);
      console.log(`${'─'.repeat(50)}`);
      console.log(`\nOpening browser for authorization...`);
      console.log(`\nIf the browser doesn't open, visit this URL:`);
      console.log(`\n  ${authUrl}`);
      console.log(`\n${'─'.repeat(50)}`);
    });

    // 5. Open browser
    yield* envService.openBrowser(authUrl);

    yield* Effect.sync(() => {
      console.log(`\n⏳ Waiting for authorization...`);
      console.log(`   (Press Ctrl+C to cancel)\n`);
    });

    // 6. Poll for approval
    const nowForPolls = yield* envService.now();
    const maxPolls = Math.ceil((expiresAt - nowForPolls) / AUTH_POLL_INTERVAL_MS);

    let pollCount = 0;
    let pollingDone = false;

    while (!pollingDone) {
      pollCount++;

      type StatusResponse = { status: string; sessionId?: string };

      const statusResult = yield* backend
        .query<StatusResponse>(api.cliAuth.getAuthRequestStatus, { requestId })
        .pipe(
          Effect.catchAll((e) => {
            const err = e instanceof Error ? e : new Error(String(e));
            console.error(`\n⚠️  Error polling for authorization: ${err.message}`);
            return Effect.succeed({ status: 'error', sessionId: undefined } as StatusResponse);
          })
        );

      if (statusResult.status === 'approved' && statusResult.sessionId) {
        // Save auth data
        const authFilePath = yield* envService.getAuthFilePath();
        yield* envService
          .saveAuthData({
            sessionId: statusResult.sessionId as unknown as SessionId,
            createdAt: new Date().toISOString(),
            deviceName,
            cliVersion,
          })
          .pipe(Effect.mapError((cause): AuthLoginError => ({ _tag: 'SaveFailed', cause })));

        yield* Effect.sync(() => {
          console.log(`\n${'═'.repeat(50)}`);
          console.log(`✅ AUTHENTICATION SUCCESSFUL`);
          console.log(`${'═'.repeat(50)}`);
          console.log(`\nSession stored at: ${authFilePath}`);
          console.log(`\nYou can now use chatroom commands.`);
        });

        pollingDone = true;
        break;
      }

      if (statusResult.status === 'denied') {
        yield* Effect.sync(() => {
          console.log(`\n❌ Authorization denied by user.`);
        });
        return yield* Effect.fail<AuthLoginError>({ _tag: 'LoginTimeout' });
      }

      if (statusResult.status === 'expired' || statusResult.status === 'not_found') {
        yield* Effect.sync(() => {
          console.log(`\n❌ Authorization request expired.`);
          console.log(`   Please try again: chatroom auth login`);
        });
        return yield* Effect.fail<AuthLoginError>({ _tag: 'LoginTimeout' });
      }

      // Still pending — periodic progress update
      if (pollCount % 5 === 0) {
        const remainingMs = yield* envService.now();
        const remainingSeconds = Math.round((expiresAt - remainingMs) / 1000);
        yield* envService.stdoutWrite(`\r   Waiting... (${remainingSeconds}s remaining)   `);
      }

      if (pollCount >= maxPolls) {
        yield* Effect.sync(() => {
          console.log(`\n❌ Authorization request expired.`);
          console.log(`   Please try again: chatroom auth login`);
        });
        return yield* Effect.fail<AuthLoginError>({ _tag: 'LoginTimeout' });
      }

      yield* envService.delay(AUTH_POLL_INTERVAL_MS);
    }
  });

// ─── Error Handler ─────────────────────────────────────────────────────────

/**
 * Maps typed errors to console output + process.exit(1).
 * This is the ONLY place process.exit is called in the Effect pipeline.
 */
function handleAuthLoginError(err: AuthLoginError): Effect.Effect<void> {
  return Effect.sync(() => {
    if (err._tag === 'AlreadyAuthenticated') {
      // Message already printed in authLoginEffect — just return
      return;
    }
    if (err._tag === 'DeviceSessionCreateFailed') {
      console.error(`\n❌ Failed to create authentication request: ${err.cause.message}`);
      process.exit(1);
    }
    if (err._tag === 'LoginTimeout') {
      // Message already printed in authLoginEffect — just exit
      process.exit(1);
    }
    if (err._tag === 'SaveFailed') {
      console.error(`\n❌ Failed to save authentication data: ${err.cause.message}`);
      process.exit(1);
    }
  });
}

// ─── Entry Point (public API — unchanged signature) ──────────────────────

export async function authLogin(options: AuthLoginOptions, deps?: AuthLoginDeps): Promise<void> {
  const d = deps ?? createDefaultDeps();
  const layer = layerFromDeps(d);

  await Effect.runPromise(
    authLoginEffect(options).pipe(
      Effect.catchAll((err) => handleAuthLoginError(err)),
      Effect.provide(layer)
    )
  );
}
