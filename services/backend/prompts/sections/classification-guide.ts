/**
 * Task intake guide section.
 *
 * Entry point roles get task-read / start-working guidance;
 * non-entry-point roles get handoff recipient acknowledgement.
 */

import { getTaskStartedPrompt, getTaskStartedPromptForHandoffRecipient } from '../cli/index';
import {
  getNativeTaskStartedPrompt,
  getNativeTaskStartedPromptForHandoffRecipient,
} from '../native/task-started-content';
import type { SelectorContext, PromptSection } from '../types/sections';
import { createSection } from '../types/sections';

/**
 * Generate the task intake guide section based on whether the role is an entry point.
 */
function getTaskIntakeContent(ctx: SelectorContext): string {
  if (ctx.isEntryPoint) {
    return ctx.nativeIntegration ? getNativeTaskStartedPrompt() : getTaskStartedPrompt();
  }

  return ctx.nativeIntegration
    ? getNativeTaskStartedPromptForHandoffRecipient()
    : getTaskStartedPromptForHandoffRecipient();
}

export function getClassificationGuideSection(ctx: SelectorContext): PromptSection {
  const content = getTaskIntakeContent(ctx);
  const sectionId = ctx.isEntryPoint ? 'task-intake-guide' : 'handoff-recipient-guide';
  return createSection(sectionId, 'knowledge', content);
}
