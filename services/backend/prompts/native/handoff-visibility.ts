/**
 * Handoff recipient visibility — shared callouts for handoff templates.
 *
 * Native and CLI harnesses run in isolated sessions. Recipients only receive
 * the handoff body. The user additionally sees `notify-user` notices.
 */

/** Callout prepended to each handoff template (user or agent recipient). */
export function getHandoffRecipientVisibilityCallout(toRole: string): string {
  const recipient = toRole.toLowerCase() === 'user' ? 'user' : `\`${toRole}\` agent`;
  const sendCommand = `\`handoff --next-role="${toRole}"\``;
  return `> ⚠️ **Template notice — not part of the message. Do not copy this notice into your handoff.**
> Recipient visibility: the ${recipient} receives only the text inside your ${sendCommand} command${toRole.toLowerCase() === 'user' ? ', plus any `notify-user` notices you sent earlier in this task' : ''}. It cannot see anything you write in this agent session${toRole.toLowerCase() === 'user' ? ' (including direct replies)' : ''}, or tool output. Put your complete deliverable in the handoff message.`;
}
