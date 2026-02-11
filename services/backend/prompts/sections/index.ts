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
} from './role-identity.js';

// Getting Started
export { getGettingStartedSection } from './getting-started.js';

// Classification Guide
export { getClassificationGuideSection } from './classification-guide.js';

// Team Context
export { getTeamContextSection } from './team-context.js';

// Role Guidance
export { getRoleGuidanceSection } from './role-guidance.js';

// Current Classification
export { getCurrentClassificationSection } from './current-classification.js';

// Handoff Options
export { getHandoffOptionsSection } from './handoff-options.js';

// Commands Reference
export { getCommandsReferenceSection } from './commands-reference.js';

// Next Step
export { getNextStepSection } from './next-step.js';
