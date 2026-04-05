/**
 * Auth extensions — custom pure functions for this project.
 * These extend the upstream auth functionality in modules/auth/.
 *
 * All functions follow a consistent pattern:
 * - Verb: `check` / `require` (e.g., checkSession, checkAccess, requireAccess)
 * - Deps: dependency interface for DI
 * - Result: `{ ok: true, ...data } | { ok: false, reason: string }`
 */

export {
  checkSession,
  type CheckSessionDeps,
  type SessionCheckResult,
  type SessionCheckSuccess,
  type SessionCheckFailure,
  type CliSessionRecord,
  type WebSessionRecord,
  type UserRecord,
} from './validate-session.js';
export {
  checkAccess,
  requireAccess,
  type Permission,
  type Accessor,
  type Resource,
  type CheckAccessParams,
  type AccessGranted,
  type AccessDenied,
  type AccessResult,
  type CheckAccessDeps,
} from './check-access.js';
