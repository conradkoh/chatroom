/**
 * CLI-specific prompts aggregator
 *
 * This module exports all CLI-specific prompt functions,
 * organized by command for better maintainability.
 */

import * as taskStarted from './task-started/index.js';

// Re-export task-started functions
export const {
  getTaskStartedPrompt,
  getTaskStartedPromptForHandoffRecipient,
  getTaskStartedExamples,
  getTaskStartedValidation,
  getClassificationGuidance,
} = taskStarted;

// Re-export wait-for-task functions
export { getWaitForTaskReminder, getWaitForTaskGuidance } from './wait-for-task/reminder.js';

// Re-export init functions
export { getContextGainingGuidance } from './init/context-gaining.js';

// Handoff CLI prompts (to be implemented)
// export {
//   getHandoffPrompt,
//   getHandoffExamples,
//   getHandoffValidation,
// } from './handoff/index.js';

/**
 * Get CLI prompt by command name
 */
export function getCliPrompt(command: string, ctx: any): string {
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
export function getCliExamples(command: string, ctx: any): string {
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
