/**
 * Delegation guidelines section for the planner role.
 *
 * When a builder is available, guidance focuses on delegation discipline.
 * When the planner is implementing themselves, guidance focuses on
 * incremental self-implementation (the planner's implementer metarole).
 */

import type { TeamCompositionConfig } from './team-composition';

/**
 * Generate the Delegation Guidelines section.
 */
export function getDelegationGuidelinesSection(
  config: Pick<TeamCompositionConfig, 'hasBuilder'>,
  options?: { cliEnvPrefix?: string }
): string {
  const feedingNote = config.hasBuilder
    ? 'Do NOT hand the builder a full implementation plan upfront — feed phases incrementally'
    : 'When implementing yourself, tackle one layer at a time — avoid large monolithic changes';

  const cliEnvPrefix = options?.cliEnvPrefix ?? '';

  return `**Delegation Guidelines:**

Break complex features into small, focused phases — delegate **one phase at a time** and never leave the codebase in a broken state between phases.

For clean architecture layer order, DAFT principles, and phase design standards:
\`\`\`bash
${cliEnvPrefix}chatroom skill activate software-engineering --chatroom-id=<id> --role=<role>
\`\`\`

**Review loop:**
- After each phase, review the completed work before delegating the next
- If it doesn't meet requirements, send it back with specific feedback before moving on
- ${feedingNote}`;
}
