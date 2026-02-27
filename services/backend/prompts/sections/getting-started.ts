/**
 * Getting Started Section
 *
 * Context-gaining instructions for agents joining the chatroom.
 * Wraps getContextGainingGuidance into a PromptSection.
 */

import { getContextGainingGuidance } from '../base/shared/getting-started-content';
import type { SelectorContext, PromptSection } from '../types/sections';
import { createSection } from '../types/sections';

/**
 * Generate the Getting Started section with context read and get-next-task commands.
 */
export function getGettingStartedSection(ctx: SelectorContext): PromptSection {
  const content = getContextGainingGuidance({
    chatroomId: ctx.chatroomId ?? '',
    role: ctx.role,
    convexUrl: ctx.convexUrl,
    agentType: ctx.agentType,
  });
  return createSection('getting-started', 'knowledge', content);
}
