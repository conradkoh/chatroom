// fallow-ignore-file unused-file
// Temporary: these modules are wired in by the next slice, feat(agent-work-manager): nudge once and park.
// That commit removes this suppression.
/**
 * Prompt sent once per session when a completed turn ends without a handoff for the task.
 * Constraint: must tell the agent both the completion action (handoff) and the wait action
 * (wait in the foreground, then hand off). Do not add any tool-specific instructions beyond the
 * `chatroom handoff` command the task already documents.
 */
export function buildUncoveredTurnNudgePrompt(args: { taskId: string }): string {
  return [
    `Your previous turn ended, but task ${args.taskId} has no handoff recorded.`,
    'If the work is complete, run `chatroom handoff` for this task now, as instructed in the task.',
    'If you are waiting on something (for example a background command or CI), do not end your turn: wait for it in the foreground, then run `chatroom handoff`.',
    'If you cannot do either, reply with one line saying what you are waiting on.',
  ].join('\n');
}
