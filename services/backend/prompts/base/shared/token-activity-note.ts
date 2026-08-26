/** Shared note: token activity reports liveness; explicit delivery starts work. */

export function getTokenActivityInProgressNote(): string {
  return 'Begin working from the task content above. This task is marked `in_progress` when delivered by the CLI — run `chatroom task read` only if you need backlog/context details not shown in the delivery.';
}

/** Native harnesses never use the task read CLI — omit recovery wording. */
export function getNativeTokenActivityInProgressNote(): string {
  return 'Begin working from the task content above. This task is marked `in_progress` when the daemon delivers it.';
}
