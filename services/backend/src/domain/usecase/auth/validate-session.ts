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
export interface ValidateSessionDeps {
  queryCliSession: (sessionId: string) => Promise<CliSessionRecord | null>;
  queryWebSession: (sessionId: string) => Promise<WebSessionRecord | null>;
  getUser: (userId: string) => Promise<UserRecord | null>;
}

/** Successful session validation result. */
export interface ValidatedSession {
  valid: true;
  sessionId: string;
  userId: string;
  userName?: string;
  sessionType: 'cli' | 'web';
}

/** Failed session validation result. */
export interface ValidationError {
  valid: false;
  reason: string;
}

/** Result of validating a session — either success or failure. */
export type SessionValidationResult = ValidatedSession | ValidationError;

// ─── Core Logic ─────────────────────────────────────────────────────────────

/** Validates a CLI session and returns user information. */
async function validateCliSession(
  deps: ValidateSessionDeps,
  sessionId: string
): Promise<SessionValidationResult> {
  const session = await deps.queryCliSession(sessionId);

  if (!session) {
    return { valid: false, reason: 'CLI session not found' };
  }

  if (!session.isActive) {
    return { valid: false, reason: 'CLI session revoked' };
  }

  if (session.expiresAt && Date.now() > session.expiresAt) {
    return { valid: false, reason: 'CLI session expired' };
  }

  const user = await deps.getUser(session.userId);
  if (!user) {
    return { valid: false, reason: 'User not found' };
  }

  return {
    valid: true,
    sessionId,
    userId: session.userId,
    userName: user.name,
    sessionType: 'cli',
  };
}

/** Validates a web session and returns user information. */
async function validateWebSession(
  deps: ValidateSessionDeps,
  sessionId: string
): Promise<SessionValidationResult> {
  const session = await deps.queryWebSession(sessionId);

  if (!session) {
    return { valid: false, reason: 'Web session not found' };
  }

  const user = await deps.getUser(session.userId);
  if (!user) {
    return { valid: false, reason: 'User not found' };
  }

  return {
    valid: true,
    sessionId,
    userId: session.userId,
    userName: user.name,
    sessionType: 'web',
  };
}

/** Validates a session, trying CLI session first then web session. */
export async function validateSession(
  deps: ValidateSessionDeps,
  sessionId: string
): Promise<SessionValidationResult> {
  // Try CLI session first
  const cliResult = await validateCliSession(deps, sessionId);
  if (cliResult.valid) {
    return cliResult;
  }

  // Fall back to web session
  const webResult = await validateWebSession(deps, sessionId);
  if (webResult.valid) {
    return webResult;
  }

  // Both failed - return a combined error
  return { valid: false, reason: 'Session not found or invalid' };
}
