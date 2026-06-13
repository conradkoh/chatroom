import { shouldAutoRestartAfterProcessExit } from './decide-resume-path.js';
import type { StopReason } from '../entities/stop-reason.js';

export type RestartOutcome =
  | { readonly _tag: 'NoRestart'; readonly reason: string }
  | {
      readonly _tag: 'RestartNow';
      readonly spawnReason: string;
      readonly wantResume: boolean;
      readonly bypassConcurrentLimit: boolean;
    }
  | {
      readonly _tag: 'ScheduleRetry';
      readonly waitMs: number;
      readonly spawnReason: string;
      readonly wantResume: boolean;
    };

export interface RestartDecisionInput {
  readonly stopReason: StopReason;
  readonly harness?: string;
  readonly workingDir?: string;
  readonly wantResume: boolean;
  readonly isPermanentFailure: boolean;
  readonly permanentFailureMessage?: string;
  readonly backoffWaitMs?: number; // from CrashLoopTracker when blocked
  readonly restartAllowed: boolean; // from shouldAllowSpawn when not bypassing
}

export function decideRestartAfterExit(input: RestartDecisionInput): RestartOutcome {
  // Rule: shouldAutoRestartAfterProcessExit === false → NoRestart
  if (!shouldAutoRestartAfterProcessExit(input.stopReason)) {
    return { _tag: 'NoRestart', reason: `Intentional stop: ${input.stopReason}` };
  }

  // Rule: missing harness or workingDir → NoRestart
  if (!input.harness || !input.workingDir) {
    return { _tag: 'NoRestart', reason: 'Missing harness or workingDir' };
  }

  // Rule: permanent failure → NoRestart (with reason message)
  if (input.isPermanentFailure) {
    return {
      _tag: 'NoRestart',
      reason: input.permanentFailureMessage ?? 'Permanent failure',
    };
  }

  // Rule: backoffWaitMs > 0 → ScheduleRetry (fixes missing retry timer)
  if (input.backoffWaitMs && input.backoffWaitMs > 0) {
    return {
      _tag: 'ScheduleRetry',
      waitMs: input.backoffWaitMs,
      spawnReason: 'platform.crash_recovery',
      wantResume: input.wantResume,
    };
  }

  // Otherwise → RestartNow with bypassConcurrentLimit true
  return {
    _tag: 'RestartNow',
    spawnReason: 'platform.crash_recovery',
    wantResume: input.wantResume,
    bypassConcurrentLimit: true,
  };
}
