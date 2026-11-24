/**
 * Main CLI prompt for the task-started command.
 */

import { getTokenActivityInProgressNote } from '../../base/shared/token-activity-note';

/**
 * Generate the main CLI prompt for task-started command (entry point roles).
 * The entry point no longer sets contexts; the prompt only states the intake rule.
 */
export function getTaskStartedPrompt(): string {
  return `### Start working

${getTokenActivityInProgressNote()}`;
}

/**
 * Generate task-started prompt for non-entry point roles (handoff recipients)
 */
export function getTaskStartedPromptForHandoffRecipient(): string {
  return `### Start Working

The task body contains your work description. ${getTokenActivityInProgressNote()}`;
}
