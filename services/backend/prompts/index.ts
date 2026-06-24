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
  composeResumeMessage,
  // Types
  type GeneralInstructionsInput,
  type ComposeResumeMessageParams,
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
  getClassificationGuidance,
} from './cli/index';

// Team configurations
export { duoTeamConfig, getDuoPlannerGuidance, getDuoBuilderGuidance } from './teams/index';

// Base prompts
export { getBuilderGuidance as getBaseBuilderGuidance } from './cli/roles/builder';
export { getPlannerGuidance as getBasePlannerGuidance } from './cli/roles/planner';
export { getRoleSpecificGuidance } from './cli/roles/index';

// Shared prompt components
export { getContextGainingGuidance } from './base/shared/getting-started-content';

// Shared utilities
export { HANDOFF_DIR, getHandoffFileSnippet } from './utils/index';

// Guidelines and policies
export { getReviewGuidelines } from './review-guidelines';
export { getSecurityPolicy } from './policies/security';
export { getDesignPolicy } from './policies/design';
export { getPerformancePolicy } from './policies/performance';
