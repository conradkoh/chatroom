import type { ResumePath } from '../entities/resume-path.js';
import type { StopReason } from '../entities/stop-reason.js';

/**
 * Resume strategy when starting or restarting an agent (ensureRunning).
 */
export function decideResumePathOnRestart(input: {
  /** Harness implements resumeFromDaemonMemory for stop→start reconnect. */
  supportsDaemonMemoryResume: boolean;
  wantResume: boolean;
  hasStoredSnapshot: boolean;
}): ResumePath {
  if (!input.supportsDaemonMemoryResume) {
    return 'cold';
  }
  if (input.wantResume && input.hasStoredSnapshot) {
    return 'daemon_memory';
  }
  return 'cold';
}

/**
 * Whether an unexpected process exit should trigger auto-restart (crash recovery).
 */
const NO_AUTO_RESTART_STOP_REASONS = new Set<StopReason>([
  'user.stop',
  'platform.team_switch',
  'platform.resume_storm',
  'daemon.shutdown',
  'daemon.respawn',
]);

export function shouldAutoRestartAfterProcessExit(stopReason: StopReason): boolean {
  return !NO_AUTO_RESTART_STOP_REASONS.has(stopReason);
}
