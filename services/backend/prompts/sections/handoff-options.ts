/**
 * Handoff Options Section
 *
 * Available handoff targets and restriction notices.
 */

import type { PromptSection } from '../types/sections';
import { createSection } from '../types/sections';

export interface HandoffOptionsParams {
  availableHandoffRoles: string[];
}

/**
 * Generate the handoff options section.
 */
export function getHandoffOptionsSection(params: HandoffOptionsParams): PromptSection {
  const roles = params.availableHandoffRoles.join(', ');
  const content = `### Handoff Options\nAvailable targets: ${roles}`;

  return createSection('handoff-options', 'guidance', content);
}
