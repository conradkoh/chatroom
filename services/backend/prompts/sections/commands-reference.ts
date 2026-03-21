/**
 * Commands Reference Section
 *
 * CLI command reference (handoff, report-progress, get-next-task).
 */

import { getNextTaskCommand } from '../cli/get-next-task/command';
import { getNextTaskReminder } from '../cli/get-next-task/reminder';
import { handoffCommand } from '../cli/handoff/command';
import { reportProgressCommand } from '../cli/report-progress/command';
import type { PromptSection } from '../types/sections';
import { createSection } from '../types/sections';
import { getCliEnvPrefix } from '../utils/index';

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

**Progress format:** Use short, single-line plain text (no markdown). Example: "Starting Phase 1: implementing the data model. Delegating to builder."

**Continue receiving messages after \`handoff\`:**
\`\`\`
${waitCmd}
\`\`\`

${getNextTaskReminder()}

**Reference commands:**
- List recent messages: \`${cliEnvPrefix}chatroom messages list --chatroom-id="${params.chatroomId}" --role="${params.role}" --sender-role=user --limit=5 --full\`
- Git log: \`git log --oneline -10\`

**Recovery commands** (only needed after compaction/restart):
- Reload system prompt: \`${cliEnvPrefix}chatroom get-system-prompt --chatroom-id="${params.chatroomId}" --role="${params.role}"\`
- Read current task context: \`${cliEnvPrefix}chatroom context read --chatroom-id="${params.chatroomId}" --role="${params.role}"\``;

  return createSection('commands-reference', 'knowledge', content);
}
