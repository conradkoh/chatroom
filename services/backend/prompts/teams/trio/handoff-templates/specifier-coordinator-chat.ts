/**
 * Key: `trio:specifier->coordinator@chat`.
 * Specifier → coordinator chat-bucket body: a short status reply, not the report.
 */

import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';

/**
 * Returns the chat reply the specifier sends to the coordinator.
 *
 * Body only: the pair resolver prepends the recipient callout and the
 * `specifier` → `coordinator` title line. A chat reply carries the status the
 * coordinator needs, never the round report. The plan reference is plain
 * labelled lines: chat replies carry no markdown headings.
 */
export function getSpecifierCoordinatorChatTemplate(_query: HandoffTemplateQuery): string {
  return `Instructions (not part of the message): chat response for the coordinator —
\`\`\`markdown
<write only the concise status the coordinator needs: what this round delivered, what the plan still has, blockers, and decisions it must make; do not add handoff XML sections, proofs, or report headings>

Plan reference:
Plan ID: <planId> (newly published | unchanged | superseded by <planId>)
Phases delivered so far: <P1, …, Pn>
What remains: <phases not yet delivered, or None — plan complete>
\`\`\``;
}
