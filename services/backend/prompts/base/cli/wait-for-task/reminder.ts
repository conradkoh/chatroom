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

Run \`wait-for-task\` directly (not with \`&\`, \`nohup\`, or other backgrounding) - backgrounded processes cannot receive tasks`;
}
