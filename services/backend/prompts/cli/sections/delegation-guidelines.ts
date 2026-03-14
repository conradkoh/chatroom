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
  const feedingNote = config.hasBuilder
    ? 'Do NOT hand the builder a full implementation plan upfront — feed phases incrementally'
    : 'When implementing yourself, tackle one layer at a time — avoid large monolithic changes';

  return `**Delegation Guidelines:**

Break complex features into small, focused phases — delegate **one phase at a time** and never leave the codebase in a broken state between phases.

**Phase order for code changes:**
1. **Domain model** — define or refine types, entities, and invariants first
2. **Use case layer** — implement business logic with dependency inversion; implementations must be pure and testable in isolation
3. **Persistence layer** — update the data schema, storage format, and write any required migration scripts
4. **Remaining tasks** — UI, integrations, cleanup, tests, and anything else that depends on the above

**Phase design principles:**
- Each phase should produce working, shippable code — no scaffolding left behind
- Always add a cleanup phase at the end: remove dead code, consolidate duplication, prevent tech debt buildup
- Each delegation is a single, well-scoped unit of work (one file, one layer, one concern)
- Include clear acceptance criteria so ${config.hasBuilder ? 'the builder' : 'you'} know when a phase is done

**Review loop:**
- After each phase, review the completed work before delegating the next
- If it doesn't meet requirements, send it back with specific feedback before moving on
- ${feedingNote}`;
}
