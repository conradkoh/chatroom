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

export function getOperatingModelLoopFooter(nativeIntegration?: boolean): string {
  return nativeIntegration ? 'Hand off when complete' : 'Run get-next-task';
}

/** Planner + builder: wait for handback via daemon delivery, not polling. */
export function getNativePlannerDelegationWaitNote(): string {
  return `After delegating to the builder, **end your turn**. The system delivers their handback when they finish — do not poll \`messages list\`, sleep, or run other tools while waiting. If the builder is offline, implement yourself or report to the user.`;
}

/**
 * Shown in CLI output immediately after a successful native handoff.
 * Tells the agent to end the current turn so the daemon can deliver the next task.
 */
export function getNativeHandoffTurnEndGuidance(nextRole: string): string {
  const lines = ['', '**End your turn now** — stop tool calls. Your session stays active.'];

  if (nextRole.toLowerCase() === 'user') {
    lines.push('The system delivers the next chatroom task when the user sends one.');
  } else {
    lines.push(
      `The system delivers \`${nextRole}\`'s handback when they finish — do not poll \`messages list\` or sleep waiting.`
    );
  }

  return lines.join('\n');
}
