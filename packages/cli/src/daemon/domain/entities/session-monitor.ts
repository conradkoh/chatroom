import type { AgentHarness } from '../../../infrastructure/machine/types.js';

export type SessionFailureKind = 'run_error' | 'auth_error' | 'provider_error' | 'none';

export interface SessionExitClassification {
  hadSessionFailure: boolean;
  failureKind: SessionFailureKind;
  recoverable: boolean;
  /** When true, APM must clear in-flight task and await exit lifecycle before recovery attempts. */
  requiresTaskReleaseBeforeRecovery?: boolean | undefined;
}

export interface ExitMonitorContext {
  recentLogLines: readonly string[];
  harness: AgentHarness;
  wantResume?: boolean | undefined;
}

export interface HarnessSessionMonitor {
  classifyExitFailure(ctx: ExitMonitorContext): SessionExitClassification;
  resolveWantResume?(
    attempt: number,
    classification: SessionExitClassification,
    ctx: ExitMonitorContext
  ): boolean;
}
