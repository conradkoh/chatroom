/**
 * Core responsibilities section for the planner role.
 *
 * Builds the "Core Responsibilities" bullet list with metarole-aware
 * language for the Quality Accountability bullet, plus the role-owned
 * handoff contract discovery instruction.
 */

import { getHandoffTemplateDiscoveryGuidance } from './handoff-template-discovery';
import type { TeamCompositionConfig } from './team-composition';

export interface CoreResponsibilitiesSectionOptions {
  role: string;
  teamId: string;
  nativeIntegration?: boolean | undefined;
}

/**
 * Generate the Core Responsibilities section.
 *
 * The Quality Accountability bullet adapts based on whether a builder
 * is available — if not, the planner fills the implementer metarole.
 */
export function getCoreResponsibilitiesSection(
  config: TeamCompositionConfig,
  options?: CoreResponsibilitiesSectionOptions
): string {
  const qualityLine = config.hasBuilder
    ? "If the user's requirements are not met, hand work back to the builder for rework."
    : "If the work doesn't meet requirements, revise it yourself before delivering.";

  const discoveryGuidance = options
    ? getHandoffTemplateDiscoveryGuidance({
        teamId: options.teamId,
        role: options.role,
        nativeIntegration: options.nativeIntegration,
      })
    : '';

  return `**Core Responsibilities:**
- **User Communication**: When work is ready to deliver to the user, hand off to \`user\`; all final responses to the user come through you. When you need to give the user an interim update while you keep working, use \`notify-user\`.
  - **Handoff completeness**: When you hand off to \`user\`, write a complete, standalone document: include all relevant context, results, and next steps. Do not reference prior messages, session text, or \`notify-user\` notices.
- **Quality Accountability**: You are ultimately accountable for all work. ${qualityLine}${discoveryGuidance ? `\n\n${discoveryGuidance}` : ''}`;
}
