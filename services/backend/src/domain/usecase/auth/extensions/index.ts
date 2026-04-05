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
  type CheckMachineOwnershipDeps,
  type MachineOwnershipResult,
  type MachineOwnershipSuccess,
  type MachineOwnershipFailure,
} from './machine-access.js';
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
  checkChatroomAccess,
  type CheckChatroomAccessDeps,
  type ChatroomAccessResult,
  type ChatroomAccessSuccess,
  type ChatroomAccessFailure,
  type ChatroomRecord,
} from './chatroom-access.js';
export {
  checkChatroomMembershipForMachine,
  type CheckChatroomMembershipDeps,
  type MembershipCheckResult,
  type MembershipCheckSuccess,
  type MembershipCheckFailure,
  type ChatroomRef,
  type WorkspaceRef,
} from './chatroom-membership.js';
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
