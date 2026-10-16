/** Native harnesses omit CLI listen-loop continuity — the system delivers the next task. */

export function getSessionContinuityLine(nativeIntegration?: boolean): string {
  if (nativeIntegration) {
    return '';
  }
  return 'Completing a **chatroom task** does NOT end your **session**. After every handoff, run `get-next-task` to continue.';
}

export function getHandoffContinuityRule(nativeIntegration?: boolean): string {
  if (nativeIntegration) {
    return '';
  }
  return '⚠️ When the harness does not support native integration: after any handoff (including to `user`), run `get-next-task` to stay in the session.';
}

export function getOperatingModelLoopFooter(nativeIntegration?: boolean): string {
  return nativeIntegration ? 'Hand off when complete' : 'Run get-next-task';
}

/** Planner + builder: wait for handback via daemon delivery, not polling. */
export function getNativePlannerDelegationWaitNote(): string {
  return `After delegating to the builder, **run handoff as your last action and end your turn** — no further tool calls after handoff. The system delivers their handback when they finish — do not poll \`messages download\` while waiting for builder handback, sleep, or run other tools while waiting.`;
}

/**
 * Successful-handoff guidance for native harnesses: the daemon delivers the
 * next task, so the agent ends its turn.
 */
export function getNativeHandoffTurnEndGuidance(nextRole: string): string {
  return getHandoffTurnEndGuidance(nextRole, true);
}

/**
 * Successful-handoff guidance, selected by harness capability.
 *
 * When the harness supports native integration: end your turn; the system
 * delivers the next task. When the harness does not support native integration:
 * run `get-next-task` to receive the next task. The call site emits exactly one
 * of the two modes, so the two instructions never appear together.
 */
export function getHandoffTurnEndGuidance(nextRole: string, nativeIntegration = false): string {
  const delivery = nativeIntegration
    ? 'the system sends it to you when it is ready'
    : 'your blocking `get-next-task` returns it';

  const lines = [
    nativeIntegration
      ? '**Handoff complete. End your turn now — stop tool calls. When the harness supports native integration: the system sends you a message when further action is required.**'
      : '**Handoff complete. When the harness does not support native integration: run `get-next-task` in the foreground now; it blocks until the next chatroom task is ready.**',
    'After a successful handoff, do not run `handoff` or `notify-user` again for this task.',
  ];

  if (nextRole.toLowerCase() === 'user') {
    lines.push(`When the next task arrives: the user sends it, and ${delivery}.`);
  } else {
    lines.push(
      `When you are waiting for \`${nextRole}\`'s handback: do not poll \`messages download\`; ${delivery}.`,
      'When you need the history of how this task was done: `messages download` is the correct tool.'
    );
  }

  return lines.join('\n');
}
