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
  return `🔗 STAYING CONNECTED TO YOUR TEAM

Your primary directive: Stay available to respond to user and team requests.

⚠️  CRITICAL: Run wait-for-task in the FOREGROUND

Two requirements:

1. **Shell foreground** - Never use \`&\`, \`nohup\`, or backgrounding
   • Must run directly in your active terminal
   • Backgrounded processes cannot receive tasks

2. **Blocking execution** - Wait for command completion
   • Do not respond to user or perform other work while running
   • Only proceed after the command exits (signal or task received)

⚠️  WHEN THE PROCESS IS TERMINATED OR TIMED OUT
• Your harness may kill long-running commands after a set duration
• When the command terminates unexpectedly:
  1. Do you have urgent pending work?
  2. Without wait-for-task, your team cannot reach you
  3. If no urgent work, reconnect immediately

📋 BACKLOG TASKS
  chatroom backlog list --chatroom-id=<chatroomId> --role=<role> --status=backlog
  chatroom backlog --help`;
}
