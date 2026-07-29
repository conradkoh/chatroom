/**
 * Commands Reference Section
 *
 * CLI command reference (handoff, get-next-task).
 */

import { getNextTaskCommand } from '../cli/get-next-task/command';
import { getNextTaskReminder } from '../cli/get-next-task/reminder';
import { handoffCommand } from '../cli/handoff/command';
import { roleGuidanceCommand } from '../cli/role-guidance/command';
import type { PromptSection } from '../types/sections';
import { createSection } from '../types/sections';
import { getCliEnvPrefix } from '../utils/index';

const HANDOFF_BODY_GUIDANCE = `Fill in the message using the matching template from \`<handoff-templates>\` in your task delivery output. Replace \`[Your message here]\` with that template content. The closing line must be exactly \`CHATROOM_HANDOFF_END\` (not \`EOF\`).`;

export interface CommandsReferenceParams {
  chatroomId: string;
  role: string;
  convexUrl: string;
}

/**
 * Generate the commands reference section with handoff and get-next-task commands.
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

  const content = `### Commands

**Complete chatroom task and hand off:**

\`\`\`bash
${handoffCmd}
\`\`\`

${HANDOFF_BODY_GUIDANCE}

**Continue receiving messages after \`handoff\`:**
\`\`\`
${waitCmd}
\`\`\`

${getNextTaskReminder()}

**History retrieval:** Use \`context read\` for current-task grounding; use \`messages download\` for searchable history (required for cross-task summaries). Use the absolute path printed by the CLI.

**Reference commands:**
- Download message history: \`${cliEnvPrefix}chatroom messages download --chatroom-id="${params.chatroomId}" --role="${params.role}" --format=linear --limit=10\`
- Read current chatroom task context: \`${cliEnvPrefix}chatroom context read --chatroom-id="${params.chatroomId}" --role="${params.role}"\`
- Git log: \`git log --oneline -10\`

**Recovery commands** (only needed after compaction/restart):
- Reload system prompt: \`${cliEnvPrefix}chatroom get-system-prompt --chatroom-id="${params.chatroomId}" --role="${params.role}"\`
- Reload role guidance: \`${roleGuidanceCommand({ chatroomId: params.chatroomId, role: params.role, cliEnvPrefix })}\`
- Read current chatroom task context: \`${cliEnvPrefix}chatroom context read --chatroom-id="${params.chatroomId}" --role="${params.role}"\``;

  return createSection('commands-reference', 'knowledge', content);
}

/** ... */
export function getNativeCommandsReferenceSection(params: CommandsReferenceParams): PromptSection {
  const cliEnvPrefix = getCliEnvPrefix(params.convexUrl);

  const handoffCmd = handoffCommand({
    chatroomId: params.chatroomId,
    role: params.role,
    nextRole: '<target>',
    cliEnvPrefix,
  });

  const content = `### Commands

**Complete chatroom task and hand off:**

\`\`\`bash
${handoffCmd}
\`\`\`

${HANDOFF_BODY_GUIDANCE}

**Do not run \`register-agent\`** — your session was registered when the harness started.

**History retrieval:** Use \`context read\` for current-task grounding; use \`messages download\` for searchable history (required for cross-task summaries). Use the absolute path printed by the CLI.

**Reference commands:**
- Download message history: \`${cliEnvPrefix}chatroom messages download --chatroom-id="${params.chatroomId}" --role="${params.role}" --format=linear --limit=10\`
- Read current chatroom task context: \`${cliEnvPrefix}chatroom context read --chatroom-id="${params.chatroomId}" --role="${params.role}"\`
- Git log: \`git log --oneline -10\`

**Recovery commands** (only needed after compaction/restart):
- Reload system prompt: \`${cliEnvPrefix}chatroom get-system-prompt --chatroom-id="${params.chatroomId}" --role="${params.role}"\`
- Reload role guidance: \`${roleGuidanceCommand({ chatroomId: params.chatroomId, role: params.role, cliEnvPrefix })}\`
- Read current chatroom task context: \`${cliEnvPrefix}chatroom context read --chatroom-id="${params.chatroomId}" --role="${params.role}"\``;

  return createSection('commands-reference-native', 'knowledge', content);
}
