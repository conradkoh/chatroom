/**
 * Re-exports stop reason types and resolvers from the agent-lifecycle domain.
 */
export type { StopReason } from '../../daemon/domain/entities/stop-reason.js';
export { resolveStopReason } from '../../daemon/domain/entities/stop-reason.js';
export { shouldRetainHarnessSessionForReconnect } from '../../daemon/domain/usecase/preserve-harness-session.js';
