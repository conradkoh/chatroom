/**
 * Current Classification Section
 *
 * Task context based on current classification (question, new_feature, follow_up).
 */

import type { PromptSection } from '../types/sections.js';
import { createSection } from '../types/sections.js';

/**
 * Generate the current classification context section.
 */
export function getCurrentClassificationSection(
  classification: 'question' | 'new_feature' | 'follow_up'
): PromptSection {
  const info: Record<typeof classification, { label: string; description: string }> = {
    question: {
      label: 'QUESTION',
      description: 'User is asking a question. Can respond directly after answering.',
    },
    new_feature: {
      label: 'NEW FEATURE',
      description: 'New functionality request. MUST go through reviewer before returning to user.',
    },
    follow_up: {
      label: 'FOLLOW-UP',
      description: 'Follow-up to previous task. Same rules as the original apply.',
    },
  };

  const { label, description } = info[classification];
  const content = `### Current Task: ${label}\n${description}`;

  return createSection('current-classification', 'guidance', content);
}
