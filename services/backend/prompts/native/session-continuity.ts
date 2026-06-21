export function getSessionContinuityLine(nativeIntegration?: boolean): string {
  return nativeIntegration
    ? 'Completing a **chatroom task** (Level B) does NOT end your **session** (Level A). After every handoff, wait for the next task to be injected.'
    : 'Completing a **chatroom task** (Level B) does NOT end your **session** (Level A). After every handoff, run `get-next-task` to continue.';
}

export function getHandoffContinuityRule(nativeIntegration?: boolean): string {
  return nativeIntegration
    ? '⚠️ After ANY handoff (including to `user`), your session stays active — wait for task injection. Do not start a blocking listener.'
    : '⚠️ After ANY handoff (including to `user`), you must run `get-next-task` to stay in the session.';
}

export function getWorkflowLoopFooter(nativeIntegration?: boolean): string {
  return nativeIntegration ? 'Wait for task injection' : 'Run get-next-task';
}
