/**
 * Static local command: print the grounding template. No auth, no chatroom.
 */

import { viewGroundingTemplate } from '@workspace/backend/prompts/cli/grounding/view-template.js';

export function printGroundingViewTemplate(): void {
  console.log(viewGroundingTemplate());
}
