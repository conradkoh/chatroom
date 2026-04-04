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
export {
  checkChatroomAccess,
  type ChatroomAccessDeps,
  type ChatroomAccessResult,
  type ChatroomAccessGranted,
  type ChatroomAccessDenied,
  type ChatroomRecord,
} from './chatroom-access.js';
export {
  checkChatroomMembershipForMachine,
  type ChatroomMembershipDeps,
  type MembershipCheckResult,
  type ChatroomRef,
  type WorkspaceRef,
} from './chatroom-membership.js';
export {
  getAccessLevel,
  isSystemAdmin,
  hasAccessLevel,
  getUserAccessLevel,
  type AccessLevel,
} from './access-control.js';
