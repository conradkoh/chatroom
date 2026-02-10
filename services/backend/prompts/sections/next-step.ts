/**
 * Next Step Section
 *
 * The final "next action" guidance in the init prompt.
 */

import { waitForTaskCommand } from '../base/cli/wait-for-task/command.js';
import type { PromptSection } from '../types/sections.js';
import { createSection } from '../types/sections.js';
import { getCliEnvPrefix } from '../utils/index.js';

export interface NextStepParams {
  chatroomId: string;
  role: string;
  convexUrl: string;
}

/**
 * Generate the next step section (typically "Run wait-for-task").
 */
export function getNextStepSection(params: NextStepParams): PromptSection {
  const cliEnvPrefix = getCliEnvPrefix(params.convexUrl);
  const waitCmd = waitForTaskCommand({
    chatroomId: params.chatroomId,
    role: params.role,
    cliEnvPrefix,
  });

  const content = `### Next\n\nRun:\n\n\`\`\`bash\n${waitCmd}\n\`\`\``;
  return createSection('next-step', 'guidance', content);
}
