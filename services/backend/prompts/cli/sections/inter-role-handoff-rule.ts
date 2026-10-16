/**
 * Shared guidance for communicating between team roles.
 */
export function getInterRoleHandoffRule(): string {
  return [
    '- **To communicate with another team role** → Use `chatroom handoff` to that role, even for a short test or status message. Do not use `chatroom message(s) send`: those are user-ingress commands that persist `senderRole=user` and `type=message`.',
    '- **To update the user while you keep working** → Use `chatroom notify-user`. It posts a notice to the user and never completes, reassigns, or transitions your task. Never use a second `handoff` for status updates.',
  ].join('\n');
}

/**
 * Shared note describing what the user can and cannot see. Defined once so the
 * planner and builder prompts do not drift apart.
 */
export function getUserHandoffVisibilityNote(): string {
  return 'The user sees only your handoff-to-user message and any `notify-user` notices. Session text and tool output are invisible to them. Notices are interim, so write the handoff as a complete, self-contained document: include all relevant context, results, and next steps without assuming the user read any prior conversation or notice.';
}
