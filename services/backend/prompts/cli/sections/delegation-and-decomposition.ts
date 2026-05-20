/**
 * Delegation and decomposition section for the planner role.
 *
 * High-level "why & when" companion to the detailed how-to in
 * delegation-guidelines.ts. Gated to multi-agent teams only
 * (hasBuilder || hasReviewer) — solo agents get no delegation guidance.
 */

import type { TeamCompositionConfig } from './team-composition';

/**
 * Generate the Delegation and Decomposition section.
 *
 * Returns empty string for solo teams (no builder, no reviewer).
 */
export function getDelegationAndDecompositionSection(config: TeamCompositionConfig): string {
  if (!config.hasBuilder && !config.hasReviewer) {
    return '';
  }

  return `**Delegation & Decomposition:**

Break complex tasks into small, focused phases. For multi-step work (2+ steps), activate the workflow skill to plan and track execution:

\`\`\`bash
CHATROOM_CONVEX_URL=<endpoint> chatroom skill activate workflow --chatroom-id=<id> --role=planner
\`\`\`

Refer to **Delegation Guidelines** below for the full step-by-step workflow commands.`;
}
