/**
 * Auth domain — re-exports.
 */

export { verifyMachineOwnership, type MachineAccessDeps } from './machine-access.js';
export {
  validateSession,
  type ValidateSessionDeps,
  type SessionValidationResult,
  type ValidatedSession,
  type ValidationError,
  type CliSessionRecord,
  type WebSessionRecord,
  type UserRecord,
} from './validate-session.js';
