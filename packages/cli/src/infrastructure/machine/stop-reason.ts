/**
 * Re-exports stop reason types and resolvers from the agent-lifecycle domain.
 */
export type { StopReason } from '../../domain/agent-lifecycle/entities/stop-reason.js';
export { resolveStopReason } from '../../domain/agent-lifecycle/entities/stop-reason.js';
export { shouldRetainHarnessSessionForReconnect } from '../../domain/agent-lifecycle/policies/preserve-session.js';
