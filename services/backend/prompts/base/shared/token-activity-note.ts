/**
 * Shared note: harness stdout/token activity marks tasks in_progress.
 */

export function getTokenActivityInProgressNote(): string {
  return 'Begin working from the task content above. The daemon detects harness output (stdout tokens) and marks the task `in_progress` automatically — **do not run `task read`** unless you need backlog items or context details not shown in the delivery.';
}

/** Native harnesses never use the task read CLI — omit recovery wording. */
export function getNativeTokenActivityInProgressNote(): string {
  return 'Begin working from the task content above. The daemon detects harness output (stdout tokens) and marks the task `in_progress` automatically.';
}
