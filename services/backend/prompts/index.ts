/**
 * Prompt system exports
 *
 * Architecture:
 *   Low-level generators: generateGeneralInstructions, generateRolePrompt
 *   Final output composers: composeSystemPrompt, composeInitMessage, composeInitPrompt
 */
export { getRoleTemplate, type RoleTemplate } from './templates';
export {
  // Low-level generators
  generateGeneralInstructions,
  generateRolePrompt,
  generateTaskStartedReminder,
  // Final output composers
  composeSystemPrompt,
  composeInitMessage,
  composeInitPrompt,
  // Types
  type GeneralInstructionsInput,
  type RolePromptContext,
  type InitPromptInput,
  type ComposedInitPrompt,
} from './generator';

// CLI-specific prompts
export {
  getCliPrompt,
  getCliExamples,
  getCliValidation,
  getTaskStartedPrompt,
  getTaskStartedExamples,
  getTaskStartedValidation,
  getClassificationGuidance,
} from './base/cli/index.js';

// Team configurations
export {
  pairTeamConfig,
  getPairWorkflow,
  getPairBuilderGuidance as getTeamBuilderGuidance,
  getPairReviewerGuidance as getTeamReviewerGuidance,
  squadTeamConfig,
  getSquadWorkflow,
  getSquadPlannerGuidance,
  getSquadBuilderGuidance,
  getSquadReviewerGuidance,
} from './teams/index.js';

// Base prompts
export {
  getBuilderGuidance as getBaseBuilderGuidance,
  getPlannerGuidance as getBasePlannerGuidance,
  getReviewerGuidance as getBaseReviewerGuidance,
  getRoleSpecificGuidance,
} from './base/cli/roles/index.js';

// Shared prompt components
export { getContextGainingGuidance } from './base/cli/init/context-gaining.js';

// Shared utilities
export {
  HANDOFF_DIR,
  getHandoffFileSnippet,
} from './utils/index.js';

// Guidelines and policies
export { getReviewGuidelines } from './teams/pair/roles';
export { getSecurityPolicy } from './policies/security';
export { getDesignPolicy } from './policies/design';
export { getPerformancePolicy } from './policies/performance';
