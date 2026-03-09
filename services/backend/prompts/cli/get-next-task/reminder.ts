/**
 * Get-next-task reminder prompts.
 *
 * Provides structured reminders about maintaining message availability.
 * Follows prompt engineering guidelines: outcome-driven with rationale.
 */

/**
 * Get the primary get-next-task reminder.
 * Used in commands section and task delivery.
 *
 * Format: Single line, positive framing, clear consequence
 */
export function getNextTaskReminder(): string {
  return 'Message availability is critical: Use `get-next-task` in the foreground to stay connected, otherwise your team cannot reach you. If this command was moved to background, terminate and restart it.';
}

/**
 * @deprecated Use getNextTaskReminder instead.
 */
export const getWaitForTaskReminder = getNextTaskReminder;

/**
 * Get extended get-next-task guidance.
 * Used in initialization to explain proper usage.
 */
export function getNextTaskGuidance(): string {
  return `🔗 STAYING CONNECTED TO YOUR TEAM

Your primary directive: Stay available to receive tasks from your team.

Run \`get-next-task\` after completing work and handing off. This is how your team sends you the next task.

If interrupted or restarted: finish any in-progress work, then run \`get-next-task\` to reconnect.`;
}

/**
 * @deprecated Use getNextTaskGuidance instead.
 */
export const getWaitForTaskGuidance = getNextTaskGuidance;

/**
 * Get the compaction/summarization recovery note.
 * Used in the system prompt's Getting Started section for durable agent recovery guidance.
 *
 * @param params - Contains real values for cliEnvPrefix, chatroomId, and role
 */
export function getCompactionRecoveryNote(params: {
  cliEnvPrefix: string;
  chatroomId: string;
  role: string;
}): string {
  const { cliEnvPrefix, chatroomId, role } = params;
  return `NOTE: If you are an agent that has undergone compaction or summarization, run:
  ${cliEnvPrefix}chatroom get-system-prompt --chatroom-id="${chatroomId}" --role="${role}"
to reload your full system and role prompt. Then run:
  ${cliEnvPrefix}chatroom context read --chatroom-id="${chatroomId}" --role="${role}"
to see your current task context.`;
}

/**
 * Get a compact one-liner compaction recovery reminder for task delivery.
 * Shown in the reminder footer of every task delivery as a quick nudge.
 * The full version lives in the system prompt's Getting Started section.
 *
 * @param params - Contains real values for cliEnvPrefix, chatroomId, and role
 */
export function getCompactionRecoveryOneLiner(params: {
  cliEnvPrefix: string;
  chatroomId: string;
  role: string;
}): string {
  const { cliEnvPrefix, chatroomId, role } = params;
  return `Context compacted? Run \`${cliEnvPrefix}chatroom get-system-prompt --chatroom-id="${chatroomId}" --role="${role}"\` to reload prompt, and \`${cliEnvPrefix}chatroom context read --chatroom-id="${chatroomId}" --role="${role}"\` for current task.`;
}
