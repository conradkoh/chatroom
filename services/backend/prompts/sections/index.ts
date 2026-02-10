/**
 * Prompt Sections Index
 *
 * Standalone, composable prompt sections that can be assembled
 * by delivery layers based on SelectorContext.
 *
 * Phase 2 of the prompt engineering architecture refactor.
 * See docs/prompt-engineering/design.md
 */

export { getTeamContextSection } from './team-context.js';
export {
  getTeamHeaderSection,
  getRoleTitleSection,
  getRoleDescriptionSection,
} from './role-identity.js';
