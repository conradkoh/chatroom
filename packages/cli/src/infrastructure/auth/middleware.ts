/**
 * Authentication middleware
 * Verifies CLI is authenticated before running commands
 */

import type { SessionId } from 'convex-helpers/server/sessions';

import { getSessionId, isAuthenticated, getAuthFilePath, getOtherSessionUrls } from './storage.js';
import { api } from '../../api.js';
import { isNetworkError, formatConnectivityError } from '../../utils/error-formatting.js';
import { getConvexClient, getConvexUrl } from '../convex/client.js';

export interface AuthContext {
  sessionId: SessionId;
  userId: string;
  userName?: string;
}

/**
 * Options for `requireAuth()`.
 */
export interface RequireAuthOptions {
  /**
   * When true, network errors block and retry every `retryIntervalMs` ms instead of
   * calling process.exit(1). This keeps long-running commands (e.g. the daemon) alive
   * through backend outages.
   *
   * Dedup pattern (mirrors init.ts):
   * - First failure  → full verbose connectivity block via formatConnectivityError
   * - Subsequent     → single concise "❌ Backend still unreachable (attempt N, retrying in Xs)"
   * - On recovery    → single "✅ Backend reachable again at <url>"
   *
   * @default false — short-lived commands keep their fast-fail UX unchanged.
   */
  retryOnNetworkError?: boolean;

  /**
   * Retry interval in ms when `retryOnNetworkError` is true.
   * @default 10_000
   */
  retryIntervalMs?: number;
}

/** Default retry interval (ms) when retryOnNetworkError is true. */
export const DEFAULT_AUTH_RETRY_INTERVAL_MS = 10_000;

/**
 * Require authentication before running a command.
 * Exits with error if not authenticated (default behaviour, unchanged).
 *
 * Pass `{ retryOnNetworkError: true }` to keep long-running commands alive through
 * transient backend outages — the call will block and retry instead of exiting.
 */
export async function requireAuth(opts: RequireAuthOptions = {}): Promise<AuthContext> {
  const retryOnNetworkError = opts.retryOnNetworkError ?? false;
  const retryIntervalMs = opts.retryIntervalMs ?? DEFAULT_AUTH_RETRY_INTERVAL_MS;

  // Check local auth file first — this is network-free and always fast-fails.
  if (!isAuthenticated()) {
    const otherUrls = getOtherSessionUrls();
    const currentUrl = getConvexUrl();

    console.error(`\n❌ Error: Not authenticated for: ${currentUrl}`);

    if (otherUrls.length > 0) {
      console.error(`\n💡 You have sessions for other environments:`);
      for (const url of otherUrls) {
        console.error(`   • ${url}`);
      }
      console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
      console.error(`   CHATROOM_CONVEX_URL=${otherUrls[0]} chatroom <command>`);
      console.error(`\n   Or to authenticate for the current environment:`);
    }

    console.error(`   $ chatroom auth login\n`);
    process.exit(1);
  }

  const sessionId = getSessionId();
  if (!sessionId) {
    console.error(`\n❌ Error: Invalid auth file`);
    console.error(`   Path: ${getAuthFilePath()}`);
    console.error(`\n   Please re-authenticate:`);
    console.error(`   $ chatroom auth login\n`);
    process.exit(1);
  }

  // Validate session with backend — may be retried on network error.
  const convexUrl = getConvexUrl();
  let consecutiveNetworkFailures = 0;

  while (true) {
    try {
      const client = await getConvexClient();
      const validation = await client.query(api.cliAuth.validateSession, {
        sessionId,
      });

      if (!validation.valid) {
        console.error(`\n❌ Error: Session invalid - ${validation.reason}`);
        console.error(`\n   Please re-authenticate:`);
        console.error(`   $ chatroom auth login\n`);
        process.exit(1);
      }

      // Touch the session to keep it fresh
      await client.mutation(api.cliAuth.touchSession, { sessionId });

      // Log recovery if we had prior network failures.
      if (consecutiveNetworkFailures > 0) {
        console.log(`✅ Backend reachable again at ${convexUrl}`);
        consecutiveNetworkFailures = 0;
      }

      return {
        sessionId,
        userId: validation.userId!,
        userName: validation.userName,
      };
    } catch (error) {
      if (isNetworkError(error)) {
        if (!retryOnNetworkError) {
          // Default fast-fail behaviour (unchanged for short-lived commands).
          formatConnectivityError(error, convexUrl);
          process.exit(1);
          // Unreachable in production; prevents fall-through when process.exit
          // is mocked as a no-op in tests.
          return undefined as never;
        }

        // Opt-in retry mode: block and wait instead of exiting.
        consecutiveNetworkFailures++;
        const retrySec = retryIntervalMs / 1000;
        if (consecutiveNetworkFailures === 1) {
          // First failure — log the full verbose guidance block once.
          formatConnectivityError(error, convexUrl);
          console.log(`⏳ Backend not reachable. Retrying every ${retrySec}s...`);
        } else {
          // Subsequent failures — a single concise line to avoid log spam.
          console.log(
            `❌ Backend still unreachable (attempt ${consecutiveNetworkFailures}, retrying in ${retrySec}s)`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
        // Continue retry loop
        continue;
      }
      // Non-network error — always fast-fail.
      const err = error as Error;
      console.error(`\n❌ Error: Could not validate session`);
      console.error(`   ${err.message}`);
      console.error(`\n   Please re-authenticate:`);
      console.error(`   $ chatroom auth login\n`);
      process.exit(1);
    }
  }
}

/**
 * Check if authenticated without exiting
 * Returns auth context if authenticated, null otherwise
 */
export async function checkAuth(): Promise<AuthContext | null> {
  if (!isAuthenticated()) {
    return null;
  }

  const sessionId = getSessionId();
  if (!sessionId) {
    return null;
  }

  try {
    const client = await getConvexClient();
    const validation = await client.query(api.cliAuth.validateSession, {
      sessionId,
    });

    if (!validation.valid) {
      return null;
    }

    return {
      sessionId,
      userId: validation.userId!,
      userName: validation.userName,
    };
  } catch (error) {
    if (isNetworkError(error)) {
      // Don't swallow network errors — let callers know the backend is unreachable
      throw error;
    }
    return null;
  }
}
