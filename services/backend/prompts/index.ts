/**
 * Prompt system exports
 *
 * Architecture:
 *   Low-level generators: generateGeneralInstructions, generateRolePrompt
 *   Final output composers: composeSystemPrompt, composeInitMessage, composeInitPrompt
 */
export { getRoleTemplate, type RoleTemplate } from './templates';
export { composeNativeSystemPrompt } from './native/system-prompt';
// fallow-ignore-next-line unused-export
export { composeRoleGuidance } from './role-guidance';
export {
  // Low-level generators
  generateGeneralInstructions,
  generateRolePrompt,
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
export { getCliPrompt, getCliExamples, getCliValidation, getTaskStartedPrompt } from './cli/index';

// Team configurations
export { duoTeamConfig, getDuoPlannerGuidance, getDuoBuilderGuidance } from './teams/index';

// Base prompts
export { getBuilderGuidance as getBaseBuilderGuidance } from './cli/roles/builder';
export { getPlannerGuidance as getBasePlannerGuidance } from './cli/roles/planner';
export { getRoleSpecificGuidance } from './cli/roles/index';

// Shared prompt components
export { getContextGainingGuidance } from './base/shared/getting-started-content';

// Shared utilities
export { getHandoffFileSnippet } from './utils/index';

// Guidelines and policies
export { getReviewGuidelines } from './review-guidelines';
export { getSecurityPolicy } from './policies/security';
export { getDesignPolicy } from './policies/design';
export { getPerformancePolicy } from './policies/performance';
