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
 * coordinator needs, never the slice report.
 */
export function getSpecifierCoordinatorChatTemplate(_query: HandoffTemplateQuery): string {
  return `Instructions (not part of the message): chat response for the coordinator —
\`\`\`markdown
<write only the concise status the coordinator needs: what this slice delivered, the slices still to do, blockers, and decisions it must make; do not add handoff XML sections, proofs, or report headings>
\`\`\``;
}
