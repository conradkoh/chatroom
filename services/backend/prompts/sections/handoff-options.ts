/**
 * Handoff Options Section
 *
 * Available handoff targets and restriction notices.
 */

import type { PromptSection } from '../types/sections.js';
import { createSection } from '../types/sections.js';

export interface HandoffOptionsParams {
  availableHandoffRoles: string[];
  canHandoffToUser: boolean;
  restrictionReason?: string | null;
}

/**
 * Generate the handoff options section.
 */
export function getHandoffOptionsSection(params: HandoffOptionsParams): PromptSection {
  const roles = params.availableHandoffRoles.join(', ');
  let content = `### Handoff Options\nAvailable targets: ${roles}`;

  if (!params.canHandoffToUser && params.restrictionReason) {
    content += `\n\n⚠️ **Restriction:** ${params.restrictionReason}`;
  }

  return createSection('handoff-options', 'guidance', content);
}
