/**
 * Handoff recipient visibility — shared callouts for handoff templates.
 *
 * Native and CLI harnesses run in isolated sessions. Recipients (user or
 * agent) only receive the handoff message body — not session text, tool
 * output, or progress reports.
 */

function recipientLabel(toRole: string): string {
  return toRole.toLowerCase() === 'user' ? 'The user' : `The \`${toRole}\` agent`;
}

/** Callout prepended to each handoff template (user or agent recipient). */
export function getHandoffRecipientVisibilityCallout(toRole: string): string {
  const recipient = recipientLabel(toRole);
  const sessionExample =
    toRole.toLowerCase() === 'user' ? ' (including direct replies like "Hello!")' : '';

  return `---

⚠️ **CRITICAL — Recipient visibility**

${recipient} **only** receives the text inside your \`handoff --next-role="${toRole}"\` command.

They **cannot** see:
- Anything you write in this agent session${sessionExample}
- Progress reports
- Tool output

Put your **complete** deliverable in the handoff message — not in session text.

---`;
}
