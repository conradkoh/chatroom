/**
 * Next Step Section
 *
 * The final "next action" guidance in the init prompt.
 */

import { getNextTaskCommand } from '../cli/get-next-task/command';
import type { PromptSection } from '../types/sections';
import { createSection } from '../types/sections';
import { getCliEnvPrefix } from '../utils/index';

export interface NextStepParams {
  chatroomId: string;
  role: string;
  convexUrl: string;
}

/**
 * Generate the next step section (typically "Run get-next-task").
 */
export function getNextStepSection(params: NextStepParams): PromptSection {
  const cliEnvPrefix = getCliEnvPrefix(params.convexUrl);
  const waitCmd = getNextTaskCommand({
    chatroomId: params.chatroomId,
    role: params.role,
    cliEnvPrefix,
  });

  const content = `### Next\n\nRun:\n\n\`\`\`bash\n${waitCmd}\n\`\`\``;
  return createSection('next-step', 'guidance', content);
}
