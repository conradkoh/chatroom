/**
 * Role Identity Section
 *
 * Standalone section producing role identity (title, description)
 * from a SelectorContext.
 *
 * Phase 2 of the prompt engineering architecture refactor.
 * See docs/prompt-engineering/design.md
 */

import { getRoleTemplate } from '../templates.js';
import type { SelectorContext, PromptSection } from '../types/sections.js';
import { createSection } from '../types/sections.js';

/**
 * Generate the team header section.
 * E.g., "# Squad Team"
 */
export function getTeamHeaderSection(teamName: string): PromptSection {
  return createSection('team-header', 'knowledge', `# ${teamName}`);
}

/**
 * Generate the role title section.
 * E.g., "## Your Role: PLANNER"
 */
export function getRoleTitleSection(ctx: SelectorContext): PromptSection {
  const template = getRoleTemplate(ctx.role);
  return createSection('role-title', 'knowledge', `## Your Role: ${template.title.toUpperCase()}`);
}

/**
 * Generate the role description section.
 * E.g., "You are the team coordinator responsible for..."
 */
export function getRoleDescriptionSection(ctx: SelectorContext): PromptSection {
  const template = getRoleTemplate(ctx.role);
  return createSection('role-description', 'knowledge', template.description);
}
