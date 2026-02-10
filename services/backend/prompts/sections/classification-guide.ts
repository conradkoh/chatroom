/**
 * Classification Guide Section
 *
 * Task classification/acknowledgement instructions.
 * Entry point roles get full classification guide;
 * non-entry-point roles get handoff recipient acknowledgement.
 */

import {
  getTaskStartedPrompt,
  getTaskStartedPromptForHandoffRecipient,
} from '../base/cli/index.js';
import type { SelectorContext, PromptSection } from '../types/sections.js';
import { createSection } from '../types/sections.js';
import { getCliEnvPrefix } from '../utils/index.js';

/**
 * Generate the classification guide section based on whether the role is an entry point.
 */
export function getClassificationGuideSection(ctx: SelectorContext): PromptSection {
  const cliEnvPrefix = getCliEnvPrefix(ctx.convexUrl);
  const chatroomId = ctx.chatroomId ?? '';

  if (ctx.isEntryPoint) {
    const content = getTaskStartedPrompt({ chatroomId, role: ctx.role, cliEnvPrefix });
    return createSection('classification-guide', 'knowledge', content);
  }

  const content = getTaskStartedPromptForHandoffRecipient({
    chatroomId,
    role: ctx.role,
    cliEnvPrefix,
  });
  return createSection('handoff-recipient-guide', 'knowledge', content);
}
