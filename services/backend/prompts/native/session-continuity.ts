/** Native harnesses omit CLI listen-loop continuity — the system delivers the next task. */

export function getSessionContinuityLine(nativeIntegration?: boolean): string {
  if (nativeIntegration) {
    return '';
  }
  return 'Completing a **chatroom task** (Level B) does NOT end your **session** (Level A). After every handoff, run `get-next-task` to continue.';
}

export function getHandoffContinuityRule(nativeIntegration?: boolean): string {
  if (nativeIntegration) {
    return '';
  }
  return '⚠️ After ANY handoff (including to `user`), you must run `get-next-task` to stay in the session.';
}

export function getWorkflowLoopFooter(nativeIntegration?: boolean): string {
  return nativeIntegration ? 'Hand off when complete' : 'Run get-next-task';
}
