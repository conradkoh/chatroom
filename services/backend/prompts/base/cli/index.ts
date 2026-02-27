/**
 * CLI-specific prompts aggregator
 *
 * This module exports all CLI-specific prompt functions,
 * organized by command for better maintainability.
 */

import * as taskStarted from './task-started/index';

// Re-export task-started functions
export const {
  getTaskStartedPrompt,
  getTaskStartedPromptForHandoffRecipient,
  getTaskStartedExamples,
  getTaskStartedValidation,
  getClassificationGuidance,
} = taskStarted;

// Re-export get-next-task functions (primary)
export {
  getNextTaskReminder,
  getNextTaskGuidance,
  getWaitForTaskReminder,
  getWaitForTaskGuidance,
} from './get-next-task/reminder';

// Re-export init functions
export { getContextGainingGuidance } from '../shared/getting-started-content';

// Handoff CLI prompts (to be implemented)
// export {
//   getHandoffPrompt,
//   getHandoffExamples,
//   getHandoffValidation,
// } from './handoff/index';

/** Shared context for CLI command prompt generation */
interface CliCommandContext {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
}

/**
 * Get CLI prompt by command name
 */
export function getCliPrompt(command: string, ctx: CliCommandContext): string {
  switch (command) {
    case 'task-started':
      return getTaskStartedPrompt(ctx);
    case 'handoff':
      // TODO: Implement handoff CLI prompts
      return '';
    default:
      return '';
  }
}

/**
 * Get CLI examples by command name
 */
export function getCliExamples(command: string, ctx: CliCommandContext): string {
  switch (command) {
    case 'task-started':
      return getTaskStartedExamples(ctx);
    case 'handoff':
      // TODO: Implement handoff CLI examples
      return '';
    default:
      return '';
  }
}

/**
 * Get CLI validation by command name
 */
export function getCliValidation(command: string): string {
  switch (command) {
    case 'task-started':
      return getTaskStartedValidation();
    case 'handoff':
      // TODO: Implement handoff CLI validation
      return '';
    default:
      return '';
  }
}
