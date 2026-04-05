/**
 * Auth extensions — custom pure functions for this project.
 * These extend the upstream auth functionality in modules/auth/.
 *
 * All functions follow a consistent pattern:
 * - Verb: `check` (e.g., checkSession, checkChatroomAccess)
 * - Deps: `Check<Domain>Deps` interface for DI
 * - Result: `{ ok: true, ...data } | { ok: false, reason: string }`
 */

export {
  checkMachineOwnership,
  verifyMachineOwnership,
  type CheckMachineOwnershipDeps,
  type MachineOwnershipResult,
  type MachineOwnershipSuccess,
  type MachineOwnershipFailure,
  type MachineAccessDeps,
} from './machine-access.js';
export {
  checkSession,
  validateSession,
  type CheckSessionDeps,
  type SessionCheckResult,
  type SessionCheckSuccess,
  type SessionCheckFailure,
  type ValidateSessionDeps,
  type SessionValidationResult,
  type ValidatedSession,
  type ValidationError,
  type CliSessionRecord,
  type WebSessionRecord,
  type UserRecord,
} from './validate-session.js';
export {
  checkChatroomAccess,
  type CheckChatroomAccessDeps,
  type ChatroomAccessResult,
  type ChatroomAccessSuccess,
  type ChatroomAccessFailure,
  type ChatroomAccessDeps,
  type ChatroomAccessGranted,
  type ChatroomAccessDenied,
  type ChatroomRecord,
} from './chatroom-access.js';
export {
  checkChatroomMembershipForMachine,
  type CheckChatroomMembershipDeps,
  type MembershipCheckResult,
  type MembershipCheckSuccess,
  type MembershipCheckFailure,
  type ChatroomMembershipDeps,
  type ChatroomRef,
  type WorkspaceRef,
} from './chatroom-membership.js';
