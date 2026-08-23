import { getNextTaskCommand } from '../cli/get-next-task/command';
import { getNextTaskReminder } from '../cli/get-next-task/reminder';
import { handoffCommand } from '../cli/handoff/command';
import type { PromptSection } from '../types/sections';
import { createSection } from '../types/sections';
import { getCliEnvPrefix } from '../utils/index';
import { getGeneralCommandsReferenceContent, type GeneralKnowledgeParams } from './general-knowledge';
const HANDOFF_BODY_GUIDANCE = `Fill in the message using the matching template from \`<handoff-templates>\` in your task delivery output. Replace \`[Your message here]\` with that template content. The closing line must be exactly \`CHATROOM_HANDOFF_END\` (not \`EOF\`).`;
export interface CommandsReferenceParams extends GeneralKnowledgeParams {}
function handoffContent(params: CommandsReferenceParams, native: boolean): string { const cliEnvPrefix = getCliEnvPrefix(params.convexUrl); const handoffCmd = handoffCommand({ chatroomId: params.chatroomId, role: params.role, nextRole: '<target>', cliEnvPrefix }); return `### Commands

**Complete chatroom task and hand off:**
\`\`\`bash
${handoffCmd}
\`\`\`

${HANDOFF_BODY_GUIDANCE}
${native ? '\n**Do not run `register-agent`** — your session was registered when the harness started.\n' : `\n**Continue receiving messages after \`handoff\`:**\n\`\`\`\n${getNextTaskCommand({ chatroomId: params.chatroomId, role: params.role, cliEnvPrefix })}\n\`\`\`\n\n${getNextTaskReminder()}\n`}
${getGeneralCommandsReferenceContent(params)}`; }
export function getCommandsReferenceSection(params: CommandsReferenceParams): PromptSection { return createSection('commands-reference', 'knowledge', handoffContent(params, false)); }
export function getNativeCommandsReferenceSection(params: CommandsReferenceParams): PromptSection { return createSection('commands-reference-native', 'knowledge', handoffContent(params, true)); }
