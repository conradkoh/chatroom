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
  return 'Message availability is critical: Use `get-next-task` in the foreground to stay connected, otherwise your team cannot reach you';
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

Your primary directive: Stay available to respond to user and team requests.

⚠️  CRITICAL: Run get-next-task in the FOREGROUND

Two requirements:

1. **Shell foreground** - Never use \`&\`, \`nohup\`, or backgrounding
   • Must run directly in your active terminal
   • Backgrounded processes cannot receive tasks

2. **Blocking execution** - Wait for command completion
   • Do not respond to user or perform other work while running
   • Only proceed after the command exits (signal or task received)

⚠️  WHEN THE PROCESS IS TERMINATED OR TIMED OUT

\`\`\`mermaid
flowchart TD
    A([Start]) --> B[Command terminated unexpectedly]
    B --> C{Urgent pending work?}
    C -->|yes| D[Finish urgent work]
    D --> E[Reconnect with get-next-task]
    C -->|no| E
    E --> F([Stop])
\`\`\`

📋 BACKLOG TASKS
  chatroom backlog list --chatroom-id=<chatroomId> --role=<role> --status=backlog
  chatroom backlog --help

📋 CONTEXT RECOVERY (after compaction/summarization)
  If your context was compacted, run: chatroom get-system-prompt --chatroom-id=<id> --role=<role>
  to reload your full system and role prompt.`;
}

/**
 * @deprecated Use getNextTaskGuidance instead.
 */
export const getWaitForTaskGuidance = getNextTaskGuidance;

/**
 * Get the compaction/summarization recovery note.
 * Shown at the top of every task delivery to help agents recover after context loss.
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
to reload your full system and role prompt.`;
}
