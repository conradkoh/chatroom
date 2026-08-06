import type { StopReason } from '../entities/stop-reason.js';

/**
 * Whether daemon-memory harness session metadata should be kept for reconnect
 * (resumeFromDaemonMemory) after this stop or process exit.
 *
 * Intentional platform/daemon stops clear memory; user.stop and automated process
 * outcomes retain it when the harness supports daemon-memory resume.
 */
export function shouldRetainHarnessSessionForReconnect(reason: StopReason): boolean {
  switch (reason) {
    case 'user.stop':
    case 'agent_process.exited_clean':
    case 'agent_process.signal':
    case 'agent_process.crashed':
      return true;
    default:
      return false;
  }
}

/**
 * Whether AgentProcessManager should pass preserveForResume to harness stop/teardown.
 */
export function shouldPreserveHarnessTeardown(
  reason: StopReason,
  supportsDaemonMemoryResume: boolean,
  hasHarnessSessionId: boolean
): boolean {
  return (
    hasHarnessSessionId &&
    supportsDaemonMemoryResume &&
    shouldRetainHarnessSessionForReconnect(reason)
  );
}
