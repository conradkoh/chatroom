import {
  getGeneralCommandsReferenceContent,
  type GeneralKnowledgeParams,
} from './general-knowledge';
import { getNextTaskCommand } from '../cli/get-next-task/command';
import { getNextTaskReminder } from '../cli/get-next-task/reminder';
import { handoffCommand } from '../cli/handoff/command';
import { notifyUserCommand } from '../cli/notify-user/command';
import type { PromptSection } from '../types/sections';
import { createSection } from '../types/sections';
import { getCliEnvPrefix } from '../utils/index';

const HANDOFF_BODY_GUIDANCE = `Fill in the message using the matching template from \`<handoff-templates>\` in your task delivery output. Replace \`[Your message here]\` with that template content. The closing line must be exactly \`CHATROOM_HANDOFF_END\` (not \`EOF\`).`;
export interface CommandsReferenceParams extends GeneralKnowledgeParams {}
function handoffContent(params: CommandsReferenceParams, native: boolean): string {
  const cliEnvPrefix = getCliEnvPrefix(params.convexUrl);
  const handoffCmd = handoffCommand({
    chatroomId: params.chatroomId,
    role: params.role,
    nextRole: '<target>',
    cliEnvPrefix,
  });
  return `### Commands

**Complete chatroom task and hand off:**
\`\`\`bash
${handoffCmd}
\`\`\`

${HANDOFF_BODY_GUIDANCE}

**Send the user an interim update (does not complete your task):**
\`\`\`bash
${notifyUserCommand({ chatroomId: params.chatroomId, role: params.role, cliEnvPrefix })}
\`\`\`
When you need to tell the user about a status change or an external wait (for example, waiting on CI) while you keep working on your current task, run \`notify-user\` before you run \`handoff\`. It does not complete, reassign, or transition your task. When you cannot continue until the user answers, run \`handoff\` to \`user\` with the question instead. When your work on the task is complete, run \`handoff\` once; do not run a second \`handoff\` to report progress. The closing line of the \`notify-user\` heredoc must be exactly \`CHATROOM_NOTIFY_END\`.
${native ? '\n**Do not run `register-agent`** — your session was registered when the harness started.\n' : `\n**Continue receiving messages after \`handoff\`:**\n\`\`\`\n${getNextTaskCommand({ chatroomId: params.chatroomId, role: params.role, cliEnvPrefix })}\n\`\`\`\n\n${getNextTaskReminder()}\n`}
${native ? '' : `\n${getGeneralCommandsReferenceContent(params)}`}`;
}
export function getCommandsReferenceSection(params: CommandsReferenceParams): PromptSection {
  return createSection('commands-reference', 'knowledge', handoffContent(params, false));
}
export function getNativeCommandsReferenceSection(params: CommandsReferenceParams): PromptSection {
  return createSection('commands-reference-native', 'knowledge', handoffContent(params, true));
}
