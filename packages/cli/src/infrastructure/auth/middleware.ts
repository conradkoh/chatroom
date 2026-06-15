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
async function checkLocalAuth(): Promise<SessionId> {
  if (!(await isAuthenticated())) {
    const otherUrls = await getOtherSessionUrls();
    const currentUrl = getConvexUrl();
    console.error(`\n❌ Error: Not authenticated for: ${currentUrl}`);
    if (otherUrls.length > 0) {
      console.error(`\n💡 You have sessions for other environments:`);
      for (const url of otherUrls) console.error(`   • ${url}`);
      console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
      console.error(`   CHATROOM_CONVEX_URL=${otherUrls[0]} chatroom <command>`);
      console.error(`\n   Or to authenticate for the current environment:`);
    }
    console.error(`   $ chatroom auth login\n`);
    process.exit(1);
  }

  const sessionId = await getSessionId();
  if (!sessionId) {
    console.error(`\n❌ Error: Invalid auth file`);
    console.error(`   Path: ${getAuthFilePath()}`);
    console.error(`\n   Please re-authenticate:\n   $ chatroom auth login\n`);
    process.exit(1);
  }
  return sessionId;
}

async function validateSessionWithBackend(
  sessionId: SessionId
): Promise<{ userId: string; userName?: string; convexUrl: string }> {
  const convexUrl = getConvexUrl();
  const client = await getConvexClient();
  const validation = await client.query(api.cliAuth.validateSession, { sessionId });

  if (!validation.valid) {
    console.error(`\n❌ Error: Session invalid - ${validation.reason}`);
    console.error(`\n   Please re-authenticate:\n   $ chatroom auth login\n`);
    process.exit(1);
  }

  await client.mutation(api.cliAuth.touchSession, { sessionId });
  return { userId: validation.userId as string, userName: validation.userName, convexUrl };
}

function handleNetworkError(
  error: unknown,
  convexUrl: string,
  retryOnNetworkError: boolean,
  consecutiveNetworkFailures: number,
  retryIntervalMs: number
): { retry: true } | never {
  if (!retryOnNetworkError) {
    formatConnectivityError(error, convexUrl);
    process.exit(1);
  }
  const retrySec = retryIntervalMs / 1000;
  if (consecutiveNetworkFailures === 1) {
    formatConnectivityError(error, convexUrl);
    console.log(`⏳ Backend not reachable. Retrying every ${retrySec}s...`);
  } else {
    console.log(
      `❌ Backend still unreachable (attempt ${consecutiveNetworkFailures}, retrying in ${retrySec}s)`
    );
  }
  return { retry: true };
}

function failNonNetworkError(error: unknown): never {
  const err = error as Error;
  console.error(`\n❌ Error: Could not validate session`);
  console.error(`   ${err.message}`);
  console.error(`\n   Please re-authenticate:\n   $ chatroom auth login\n`);
  process.exit(1);
}

export async function requireAuth(opts: RequireAuthOptions = {}): Promise<AuthContext> {
  const retryOnNetworkError = opts.retryOnNetworkError ?? false;
  const retryIntervalMs = opts.retryIntervalMs ?? DEFAULT_AUTH_RETRY_INTERVAL_MS;

  const sessionId = await checkLocalAuth();
  const convexUrl = getConvexUrl();
  let consecutiveNetworkFailures = 0;

  while (true) {
    try {
      const result = await validateSessionWithBackend(sessionId);
      if (consecutiveNetworkFailures > 0) {
        console.log(`✅ Backend reachable again at ${convexUrl}`);
        consecutiveNetworkFailures = 0;
      }
      return { sessionId, userId: result.userId, userName: result.userName };
    } catch (error) {
      if (isNetworkError(error)) {
        consecutiveNetworkFailures++;
        handleNetworkError(
          error,
          convexUrl,
          retryOnNetworkError,
          consecutiveNetworkFailures,
          retryIntervalMs
        );
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
        continue;
      }
      failNonNetworkError(error);
    }
  }
}

/**
 * Check if authenticated without exiting
 * Returns auth context if authenticated, null otherwise
 */
export async function checkAuth(): Promise<AuthContext | null> {
  if (!(await isAuthenticated())) {
    return null;
  }

  const sessionId = await getSessionId();
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
      userId: validation.userId as string,
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
