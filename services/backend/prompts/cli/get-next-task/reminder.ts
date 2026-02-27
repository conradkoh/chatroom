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

\`\`\`
@startuml
start
:Command terminated unexpectedly;
if (Urgent pending work?) then (yes)
  :Finish urgent work;
  :Reconnect with get-next-task;
else (no)
  :Reconnect immediately;
  note right: Team cannot reach you without it
endif
stop
@enduml
\`\`\`

📋 BACKLOG TASKS
  chatroom backlog list --chatroom-id=<chatroomId> --role=<role> --status=backlog
  chatroom backlog --help`;
}

/**
 * @deprecated Use getNextTaskGuidance instead.
 */
export const getWaitForTaskGuidance = getNextTaskGuidance;
