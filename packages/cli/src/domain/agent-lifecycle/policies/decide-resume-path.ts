import type { StopReason } from '../entities/stop-reason.js';

import type { ResumePath } from '../entities/resume-path.js';

/**
 * Resume strategy when starting or restarting an agent (ensureRunning).
 */
export function decideResumePathOnRestart(input: {
  supportsSessionResume: boolean;
  wantResume: boolean;
  hasStoredSnapshot: boolean;
}): ResumePath {
  if (!input.supportsSessionResume) {
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
export function shouldAutoRestartAfterProcessExit(stopReason: StopReason): boolean {
  switch (stopReason) {
    case 'user.stop':
    case 'platform.team_switch':
    case 'daemon.shutdown':
    case 'daemon.respawn':
      return false;
    default:
      return true;
  }
}

/**
 * In-process turn resume (resumeTurn) — same PID, lifecycle.turn.completed.
 */
export function resumePathAfterTurnCompleted(supportsSessionResume: boolean): ResumePath {
  return supportsSessionResume ? 'in_process' : 'none';
}
