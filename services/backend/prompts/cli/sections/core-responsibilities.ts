/**
 * Core responsibilities section for the planner role.
 *
 * Builds the "Core Responsibilities" bullet list with metarole-aware
 * language for the Quality Accountability bullet.
 */

import type { TeamCompositionConfig } from './team-composition';

/**
 * Generate the Core Responsibilities section.
 *
 * The Quality Accountability bullet adapts based on whether a builder
 * is available — if not, the planner fills the implementer metarole.
 */
export function getCoreResponsibilitiesSection(config: TeamCompositionConfig): string {
  const qualityLine = config.hasBuilder
    ? "If the user's requirements are not met, hand work back to the builder for rework."
    : "If the work doesn't meet requirements, revise it yourself before delivering.";

  return `**Core Responsibilities:**
- **User Communication**: You are the ONLY role that communicates with the user. All responses to the user come through you.
  - Use \`report-progress\` to keep the user informed at key milestones: when you start work, when you delegate phases, and when you receive results back.
  - Example: before delegating → "Starting Phase 1: implementing the data model. Delegating to builder."
- **Task Decomposition**: Break complex tasks into clear, actionable work items before delegating.
- **Quality Accountability**: You are ultimately accountable for all work. ${qualityLine}`;
}
