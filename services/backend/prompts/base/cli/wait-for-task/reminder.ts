/**
 * Wait-for-task reminder prompts.
 *
 * Provides structured reminders about maintaining message availability.
 * Follows prompt engineering guidelines: outcome-driven with rationale.
 */

/**
 * Get the primary wait-for-task reminder.
 * Used in commands section and task delivery.
 *
 * Format: Single line, positive framing, clear consequence
 */
export function getWaitForTaskReminder(): string {
  return 'Message availability is critical: Use `wait-for-task` in the foreground to stay connected, otherwise your team cannot reach you';
}

/**
 * Get extended wait-for-task guidance.
 * Used in initialization to explain proper usage.
 */
export function getWaitForTaskGuidance(): string {
  return `Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you

Run \`wait-for-task\` directly (not with \`&\`, \`nohup\`, or other backgrounding) - backgrounded processes cannot receive tasks

⏱️  HOW WAIT-FOR-TASK WORKS:
• While wait-for-task runs, you remain "frozen" - the tool continues executing while you wait
• The command may timeout before a task arrives. This is normal and expected behavior
• The shell host enforces timeouts to ensure agents remain responsive and can pick up new jobs
• When wait-for-task terminates (timeout or after task completion), restart it immediately
• Restarting quickly ensures users and other agents don't have to wait for your availability

📋 BACKLOG:
The chatroom has a task backlog. View items with:
  chatroom backlog list --chatroom-id=<chatroomId> --role=<role> --status=backlog
More actions: \`chatroom backlog --help\``;
}
