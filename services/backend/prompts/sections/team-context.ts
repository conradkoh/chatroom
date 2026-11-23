/**
 * Team Context Section
 *
 * Standalone section producing the team-specific context block
 * (duo rules, etc.) from a SelectorContext.
 *
 * Phase 2 of the prompt engineering architecture refactor.
 * See docs/prompt-engineering/design.md
 */

import { isPresetTeam, TEAM_PROMPT_MODULES } from '../teams/registry';
import type { SelectorContext, PromptSection } from '../types/sections';
import { createSection } from '../types/sections';

/**
 * Generate the team context knowledge section.
 *
 * The team-specific block (for example duo's "Team Context" rules that sit before
 * role guidance) comes from the team's prompt module. Teams without a block, and
 * unknown teams, render empty content.
 */
export function getTeamContextSection(ctx: SelectorContext): PromptSection {
  const content = isPresetTeam(ctx.team) ? TEAM_PROMPT_MODULES[ctx.team].getTeamContext(ctx) : '';
  return createSection('team-context', 'knowledge', content);
}
