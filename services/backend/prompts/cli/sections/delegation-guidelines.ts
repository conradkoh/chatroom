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
  config: Pick<TeamCompositionConfig, 'hasBuilder'>
): string {
  const lastLine = config.hasBuilder
    ? '- Do NOT send a full implementation plan to the builder — feed tasks incrementally'
    : '- When implementing yourself, tackle one logical change at a time — avoid large monolithic changes';

  return `**Delegation Guidelines:**
- Break complex tasks into small, focused phases — delegate ONE phase at a time
- **Phase design**: each phase should be targeted and result in a working version of the code — never leave the codebase in a broken state mid-feature
- **Cleanup phases**: always add cleanup/refactoring phases at the end of a feature to remove scaffolding, consolidate duplication, and prevent tech debt build-up
- Each delegation should be a single, well-scoped unit of work (e.g. one file, one feature, one fix)
- Include acceptance criteria so team members know when they're done
- After receiving completed work, review it before delegating the next phase
- If work doesn't meet requirements, send it back with specific feedback before moving on
${lastLine}`;
}
