import type {
  ExitMonitorContext,
  HarnessSessionMonitor,
  SessionExitClassification,
} from '../../../../domain/entities/session-monitor.js';
import { CURSOR_SDK_SESSION_RESUME_FIRST_ATTEMPTS } from '../../../../domain/usecase/cursor-sdk-session-reopen-retry.js';
import {
  formatCursorSdkRunErrorMessage,
  hasCursorSdkSessionReopenTrigger,
  isCursorSdkAuthErrorInLogs,
} from '../../../../domain/usecase/detect-cursor-sdk-run-error.js';

export const cursorSdkSessionMonitor: HarnessSessionMonitor = {
  classifyExitFailure(ctx: ExitMonitorContext): SessionExitClassification {
    const logs = ctx.recentLogLines;
    if (!hasCursorSdkSessionReopenTrigger(logs)) {
      return { hadSessionFailure: false, failureKind: 'none', recoverable: true };
    }
    const auth = isCursorSdkAuthErrorInLogs(logs);
    console.log(
      `[CursorSdkSessionMonitor] session failure detected: ${formatCursorSdkRunErrorMessage(logs)}`
    );
    return {
      hadSessionFailure: true,
      failureKind: auth ? 'auth_error' : 'run_error',
      recoverable: true,
      requiresTaskReleaseBeforeRecovery: auth,
    };
  },

  // fallow-ignore-next-line complexity
  resolveWantResume(attempt, classification, ctx) {
    if (classification.hadSessionFailure && attempt <= CURSOR_SDK_SESSION_RESUME_FIRST_ATTEMPTS) {
      return true;
    }
    if (classification.hadSessionFailure) {
      return false;
    }
    return ctx.wantResume ?? true;
  },
};
