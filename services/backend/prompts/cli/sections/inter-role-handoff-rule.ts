/**
 * Shared guidance for communicating between team roles.
 */
export function getInterRoleHandoffRule(): string {
  return [
    '- **When you need to send any message to another team role (including a short test or status message)** → Run `chatroom handoff --next-role=<role>`. This completes your current task. Do not use `chatroom message(s) send`: those are user-ingress commands that persist `senderRole=user` and `type=message`.',
    '- **When you need to give the user an interim update and you still have work left on your current task** → Run `chatroom notify-user`. It posts a notice to the user and does not complete, reassign, or transition your task. Run it before you run `handoff`; after `handoff` it fails with `NO_ACTIVE_TASK`.',
  ].join('\n');
}

/**
 * Shared note describing what the user can and cannot see. Defined once so the
 * planner and builder prompts do not drift apart.
 */
export function getUserHandoffVisibilityNote(): string {
  return 'Write the handoff as a complete, self-contained document with all relevant context, results, and next steps. The user reads your handoff message and any `notify-user` notices, not session text or tool output, so do not assume they read earlier conversation or notices.';
}
