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
  return 'Message availability is critical: Run only one `get-next-task` in the foreground at a time. Before reconnecting, terminate any older backgrounded `get-next-task` processes (stale waiters can acknowledge tasks and trigger a grace-period cooldown for your active session). If this command was moved to background, kill it and restart a single foreground instance.';
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

Your primary directive: Stay available to receive chatroom tasks from your team.

Run a single \`get-next-task\` in the foreground after completing work and handing off. This is how your team sends you the next chatroom task.

Before starting a new session, terminate any older backgrounded \`get-next-task\` processes for this role. Stale sessions can acknowledge incoming tasks and cause grace-period conflicts for your active agent.

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
to see your current chatroom task context.`;
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
  return `Context compacted? Run \`${cliEnvPrefix}chatroom get-system-prompt --chatroom-id="${chatroomId}" --role="${role}"\` to reload prompt, and \`${cliEnvPrefix}chatroom context read --chatroom-id="${chatroomId}" --role="${role}"\` for current chatroom task.`;
}
