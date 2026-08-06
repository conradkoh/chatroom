/**
 * Re-exports stop reason types and resolvers from the agent-lifecycle domain.
 */
export type { StopReason } from '../../v2/domain/entities/stop-reason.js';
export { resolveStopReason } from '../../v2/domain/entities/stop-reason.js';
export { shouldRetainHarnessSessionForReconnect } from '../../domain/agent-lifecycle/policies/preserve-session.js';
