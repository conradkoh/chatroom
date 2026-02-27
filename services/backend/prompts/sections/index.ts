/**
 * Prompt Sections Index
 *
 * Standalone, composable prompt sections that can be assembled
 * by delivery layers based on SelectorContext.
 *
 * Each section returns a PromptSection with id, type, and content.
 * Use composeSections() from types/sections to join them.
 *
 * See docs/prompt-engineering/design.md
 */

// Role Identity
export {
  getTeamHeaderSection,
  getRoleTitleSection,
  getRoleDescriptionSection,
} from './role-identity';

// Getting Started
export { getGettingStartedSection } from './getting-started';

// Classification Guide
export { getClassificationGuideSection } from './classification-guide';

// Team Context
export { getTeamContextSection } from './team-context';

// Role Guidance
export { getRoleGuidanceSection } from './role-guidance';

// Current Classification
export { getCurrentClassificationSection } from './current-classification';

// Handoff Options
export { getHandoffOptionsSection } from './handoff-options';

// Commands Reference
export { getCommandsReferenceSection } from './commands-reference';

// Next Step
export { getNextStepSection } from './next-step';
