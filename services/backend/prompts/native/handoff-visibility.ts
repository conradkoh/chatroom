/**
 * Handoff recipient visibility — shared callouts for handoff templates.
 *
 * Native and CLI harnesses run in isolated sessions. Recipients only receive
 * the handoff body. The user additionally sees `notify-user` notices.
 */

/** Callout prepended to each handoff template (user or agent recipient). */
export function getHandoffRecipientVisibilityCallout(toRole: string): string {
  if (toRole.toLowerCase() === 'user') {
    return `---

⚠️ **CRITICAL — Recipient visibility**

The user receives the text inside your \`handoff --next-role="user"\` command, plus any \`notify-user\` notices you sent earlier in this task.

They **cannot** see:
- Anything you write in this agent session (including direct replies like "Hello!")
- Tool output

When you write this handoff, put your **complete** deliverable in the handoff message. Do not rely on session text or on earlier notices.

---`;
  }

  return `---

⚠️ **CRITICAL — Recipient visibility**

The \`${toRole}\` agent **only** receives the text inside your \`handoff --next-role="${toRole}"\` command.

They **cannot** see:
- Anything you write in this agent session
- \`notify-user\` notices (notices go to the user only)
- Tool output

When you write this handoff, put your **complete** deliverable in the handoff message — not in session text.

---`;
}
