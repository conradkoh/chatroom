/**
 * Commands Reference Section
 *
 * CLI command reference (handoff, report-progress, get-next-task).
 */

import { getNextTaskCommand } from '../base/cli/get-next-task/command.js';
import { getNextTaskReminder } from '../base/cli/get-next-task/reminder.js';
import { handoffCommand } from '../base/cli/handoff/command.js';
import { reportProgressCommand } from '../base/cli/report-progress/command.js';
import type { PromptSection } from '../types/sections.js';
import { createSection } from '../types/sections.js';
import { getCliEnvPrefix } from '../utils/index.js';

export interface CommandsReferenceParams {
  chatroomId: string;
  role: string;
  convexUrl: string;
}

/**
 * Generate the commands reference section with handoff, progress, and get-next-task commands.
 */
export function getCommandsReferenceSection(params: CommandsReferenceParams): PromptSection {
  const cliEnvPrefix = getCliEnvPrefix(params.convexUrl);

  const handoffCmd = handoffCommand({
    chatroomId: params.chatroomId,
    role: params.role,
    nextRole: '<target>',
    cliEnvPrefix,
  });

  const waitCmd = getNextTaskCommand({
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

${getNextTaskReminder()}

**Re-fetch your system prompt (after context reset):**
\`\`\`
${cliEnvPrefix}chatroom get-system-prompt --chatroom-id="${params.chatroomId}" --role="${params.role}"
\`\`\``;

  return createSection('commands-reference', 'knowledge', content);
}
