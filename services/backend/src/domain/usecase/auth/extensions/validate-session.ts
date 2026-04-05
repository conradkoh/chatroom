/**
 * Validate Session — pure functions for session validation.
 *
 * Extracted from convex/auth/cliSessionAuth.ts.
 * Uses dependency injection for database access.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Minimal CLI session shape needed for validation. */
export interface CliSessionRecord {
  userId: string;
  isActive: boolean;
  expiresAt?: number;
}

/** Minimal web session shape needed for validation. */
export interface WebSessionRecord {
  userId: string;
}

/** Minimal user shape needed for validation. */
export interface UserRecord {
  id: string;
  name?: string;
}

/** Database access for session validation. */
export interface CheckSessionDeps {
  queryCliSession: (sessionId: string) => Promise<CliSessionRecord | null>;
  queryWebSession: (sessionId: string) => Promise<WebSessionRecord | null>;
  getUser: (userId: string) => Promise<UserRecord | null>;
}

/** Successful session check result. */
export interface SessionCheckSuccess {
  ok: true;
  sessionId: string;
  userId: string;
  userName?: string;
  sessionType: 'cli' | 'web';
}

/** Failed session check result. */
export interface SessionCheckFailure {
  ok: false;
  reason: string;
}

/** Result of checking a session — either success or failure. */
export type SessionCheckResult = SessionCheckSuccess | SessionCheckFailure;

// ─── Core Logic ─────────────────────────────────────────────────────────────

/** Checks a CLI session and returns user information. */
async function checkCliSession(
  deps: CheckSessionDeps,
  sessionId: string
): Promise<SessionCheckResult> {
  const session = await deps.queryCliSession(sessionId);

  if (!session) {
    return { ok: false, reason: 'CLI session not found' };
  }

  if (!session.isActive) {
    return { ok: false, reason: 'CLI session revoked' };
  }

  if (session.expiresAt && Date.now() > session.expiresAt) {
    return { ok: false, reason: 'CLI session expired' };
  }

  const user = await deps.getUser(session.userId);
  if (!user) {
    return { ok: false, reason: 'User not found' };
  }

  return {
    ok: true,
    sessionId,
    userId: session.userId,
    userName: user.name,
    sessionType: 'cli',
  };
}

/** Checks a web session and returns user information. */
async function checkWebSession(
  deps: CheckSessionDeps,
  sessionId: string
): Promise<SessionCheckResult> {
  const session = await deps.queryWebSession(sessionId);

  if (!session) {
    return { ok: false, reason: 'Web session not found' };
  }

  const user = await deps.getUser(session.userId);
  if (!user) {
    return { ok: false, reason: 'User not found' };
  }

  return {
    ok: true,
    sessionId,
    userId: session.userId,
    userName: user.name,
    sessionType: 'web',
  };
}

/** Checks a session, trying CLI session first then web session. */
export async function checkSession(
  deps: CheckSessionDeps,
  sessionId: string
): Promise<SessionCheckResult> {
  // Try CLI session first
  const cliResult = await checkCliSession(deps, sessionId);
  if (cliResult.ok) {
    return cliResult;
  }

  // Fall back to web session
  const webResult = await checkWebSession(deps, sessionId);
  if (webResult.ok) {
    return webResult;
  }

  // Both failed - return a combined error
  return { ok: false, reason: 'Session not found or invalid' };
}
