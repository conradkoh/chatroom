/**
 * CLI-specific prompts for the task-started command
 */

import { getClassificationGuidance } from './classification/index';
import { getTaskStartedPrompt, getTaskStartedPromptForHandoffRecipient } from './main-prompt';

// Re-export main functions
export { getTaskStartedPrompt, getTaskStartedPromptForHandoffRecipient, getClassificationGuidance };
