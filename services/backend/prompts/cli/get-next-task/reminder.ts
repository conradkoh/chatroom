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
  return 'A foreground `get-next-task` blocks until the user or team message is ready, then resolves with that message as a chatroom task—infer what to do from the message, not only from numbered next-steps. Message availability requires exactly one such blocking tool call; the harness delivers chatroom tasks only while it blocks. Duplicate or backgrounded listeners can acknowledge tasks early and trigger grace-period cooldowns where your active session receives nothing.';
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

When the user or team is ready, your blocking \`get-next-task\` resolves and delivers their message as the next chatroom task. That message is the source of truth for what to do—numbered next-steps in task delivery are typical role patterns, not a rigid script.

The harness delivers the next chatroom task only through a single foreground \`get-next-task\` that blocks as a tool call. After completing work and handing off, that blocking listener is what keeps you connected to your team.

Exactly one active waiter should own task delivery at a time. Additional or backgrounded \`get-next-task\` sessions can acknowledge incoming tasks early, causing grace-period conflicts where your active agent receives nothing.

After interruption or restart: complete any in-progress work, then restore a single foreground blocking \`get-next-task\` so chatroom tasks can arrive again.`;
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

/**
 * Footer reminder for native-integration harnesses (task injection, no get-next-task loop).
 */
export function getNativeInjectionReminder(): string {
  return 'Wait for handoff to complete Level B; next task will be injected automatically.';
}
