/**
 * Unresolved decisions section for handoff-to-user report templates.
 *
 * Agents carry open decisions forward across handoffs until the user resolves
 * them or explicitly delegates a choice.
 */

/** Markdown section block for planner/solo → user handoff reports. */
export function getUnresolvedDecisionsSectionBlock(): string {
  return `## Unresolved Decisions
<!-- Decisions that need user input before work can proceed. -->
- <decision or question — options considered, recommendation if any, or "Not Applicable">
<Carry forward decisions still open from earlier handoffs in this chatroom. Remove items the user has resolved. Do not decide on the user's behalf unless they explicitly asked you to. Write \`Not Applicable\` only when there are truly no open decisions.>`;
}
