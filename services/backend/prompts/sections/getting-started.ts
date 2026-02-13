/**
 * Getting Started Section
 *
 * Context-gaining instructions for agents joining the chatroom.
 * Wraps getContextGainingGuidance into a PromptSection.
 */

import { getContextGainingGuidance } from '../base/shared/getting-started-content.js';
import type { SelectorContext, PromptSection } from '../types/sections.js';
import { createSection } from '../types/sections.js';

/**
 * Generate the Getting Started section with context read and wait-for-task commands.
 */
export function getGettingStartedSection(ctx: SelectorContext): PromptSection {
  const content = getContextGainingGuidance({
    chatroomId: ctx.chatroomId ?? '',
    role: ctx.role,
    convexUrl: ctx.convexUrl,
  });
  return createSection('getting-started', 'knowledge', content);
}
