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
} from './cli/index.js';
