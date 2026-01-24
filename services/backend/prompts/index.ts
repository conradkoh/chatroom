/**
 * Prompt system exports
 */
export { getRoleTemplate, type RoleTemplate } from './templates';
export {
  generateRolePrompt,
  generateTaskStartedReminder,
  generateInitPrompt,
  type RolePromptContext,
  type InitPromptInput,
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
  getBuilderGuidance as getTeamBuilderGuidance,
  getReviewerGuidance as getTeamReviewerGuidance,
} from './teams/pair/index.js';

// Base prompts
export {
  getBuilderGuidance as getBaseBuilderGuidance,
  getReviewerGuidance as getBaseReviewerGuidance,
  getRoleSpecificGuidance,
} from './base/cli/roles/index.js';

// Shared prompt components
export { getContextGainingGuidance } from './base/context-gaining.js';

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
