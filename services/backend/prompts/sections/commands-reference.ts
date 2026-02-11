/**
 * Commands Reference Section
 *
 * CLI command reference (handoff, report-progress, wait-for-task).
 */

import { handoffCommand } from '../base/cli/handoff/command.js';
import { reportProgressCommand } from '../base/cli/report-progress/command.js';
import { waitForTaskCommand } from '../base/cli/wait-for-task/command.js';
import { getWaitForTaskReminder } from '../base/cli/wait-for-task/reminder.js';
import type { PromptSection } from '../types/sections.js';
import { createSection } from '../types/sections.js';
import { getCliEnvPrefix } from '../utils/index.js';

export interface CommandsReferenceParams {
  chatroomId: string;
  role: string;
  convexUrl: string;
}

/**
 * Generate the commands reference section with handoff, progress, and wait-for-task commands.
 */
export function getCommandsReferenceSection(params: CommandsReferenceParams): PromptSection {
  const cliEnvPrefix = getCliEnvPrefix(params.convexUrl);

  const handoffCmd = handoffCommand({
    chatroomId: params.chatroomId,
    role: params.role,
    nextRole: '<target>',
    cliEnvPrefix,
  });

  const waitCmd = waitForTaskCommand({
    chatroomId: params.chatroomId,
    role: params.role,
    cliEnvPrefix,
  });

  const progressCmd = reportProgressCommand({
    chatroomId: params.chatroomId,
    role: params.role,
    cliEnvPrefix,
  });

  const content = `### Commands

**Complete task and hand off:**

\`\`\`bash
${handoffCmd}
\`\`\`

Replace \`[Your message here]\` with:
- **Summary**: Brief description of what was done
- **Changes Made**: Key changes (bullets)
- **Testing**: How to verify the work

**Report progress on current task:**

\`\`\`bash
${progressCmd}
\`\`\`

Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

**Continue receiving messages after \`handoff\`:**
\`\`\`
${waitCmd}
\`\`\`

${getWaitForTaskReminder()}`;

  return createSection('commands-reference', 'knowledge', content);
}
