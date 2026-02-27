/**
 * Classification guidance aggregator for CLI task-started command.
 */

import { getFollowUpClassificationGuidance } from './follow-up';
import { getNewFeatureClassificationGuidance } from './new-feature';
import { getQuestionClassificationGuidance } from './question';

/**
 * Get classification guidance by type
 */
export function getClassificationGuidance(
  classification: 'question' | 'new_feature' | 'follow_up',
  ctx: {
    chatroomId: string;
    role: string;
    cliEnvPrefix: string;
  }
): string {
  switch (classification) {
    case 'question':
      return getQuestionClassificationGuidance();
    case 'new_feature':
      return getNewFeatureClassificationGuidance(ctx);
    case 'follow_up':
      return getFollowUpClassificationGuidance();
    default:
      return '';
  }
}

// Re-export individual classification functions
export {
  getQuestionClassificationGuidance,
  getNewFeatureClassificationGuidance,
  getFollowUpClassificationGuidance,
};
