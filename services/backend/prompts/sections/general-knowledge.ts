import { getActivatedSkillsSection } from './activated-skills';
import { getGlossarySection } from './glossary';
import { contextReadCommand } from '../cli/context/read';
import { getHistoryRetrievalGuidance } from '../cli/history-retrieval/guidance';
import { roleGuidanceCommand } from '../cli/role-guidance/command';
import type { ActivatedSkillSnapshot } from '../types/init-prompt';
import type { PromptSection } from '../types/sections';
import { createSection } from '../types/sections';
import { getCliEnvPrefix } from '../utils/index';
import { messagesDownloadSinceCommand } from '../utils/proof-of-verification';
import { isVerifierRole } from '../utils/verifier-role';

export interface GeneralKnowledgeParams {
  chatroomId: string;
  role: string;
  convexUrl: string;
  compactSkills?: boolean | undefined;
  nativeIntegration?: boolean | undefined;
  activatedSkills?: ActivatedSkillSnapshot[] | undefined;
}
export function getGeneralCommandsReferenceContent(params: GeneralKnowledgeParams): string {
  const cliEnvPrefix = getCliEnvPrefix(params.convexUrl);
  const { chatroomId, role } = params;
  const verifier = isVerifierRole(role);
  const contextReadCmd = contextReadCommand({ chatroomId, role, cliEnvPrefix });
  const messagesDownloadCmd = messagesDownloadSinceCommand({
    chatroomId,
    role,
    cliEnvPrefix,
    sinceMessageId: '<from-anchor>',
    limit: 100,
  });
  // The verifier reads logs by message id, so every context-read line is omitted.
  // Each optional line carries its own leading newline, so omitting it leaves the
  // surrounding lines byte-identical for every other role.
  const contextReadLine = verifier
    ? ''
    : `- Read current chatroom task context: \`${contextReadCmd}\`\n`;
  // Every variant opens with "Run", so the sentence stays capitalised for the verifier.
  const historyRetrievalSentence = verifier
    ? `Run \`${messagesDownloadCmd}\``
    : `Run \`${contextReadCmd}\` for current-task grounding; run \`${messagesDownloadCmd}\``;
  return `### Reference commands
- Download message history: \`${cliEnvPrefix}chatroom messages download --chatroom-id="${chatroomId}" --role="${role}" --format=linear --limit=10\`
- Anchor on the user's last message: \`${cliEnvPrefix}chatroom messages anchor --chatroom-id="${chatroomId}" --role="${role}"\`
${contextReadLine}- Git log: \`git log --oneline -10\`

**Recovery commands** (only needed after compaction/restart):
- Reload system prompt: \`${cliEnvPrefix}chatroom get-system-prompt --chatroom-id="${chatroomId}" --role="${role}"\`
- Reload role guidance: \`${roleGuidanceCommand({ chatroomId, role, cliEnvPrefix })}\`
${contextReadLine}
**History retrieval:** ${historyRetrievalSentence} for searchable history (required for cross-task summaries). Use the absolute path printed by the CLI.`;
}
export function getGeneralKnowledgeSections(
  params: GeneralKnowledgeParams,
  options: { includeHistory?: boolean | undefined } = {}
): PromptSection[] {
  const sections: PromptSection[] = [
    getGlossarySection({
      convexUrl: params.convexUrl,
      chatroomId: params.chatroomId,
      role: params.role,
      nativeIntegration: params.nativeIntegration,
      compactSkills: params.compactSkills,
    }),
  ];
  const activated = getActivatedSkillsSection(params.activatedSkills ?? []);
  if (activated) sections.push(activated);
  if (options.includeHistory !== false)
    sections.push(
      createSection(
        'history-retrieval',
        'knowledge',
        getHistoryRetrievalGuidance({
          chatroomId: params.chatroomId,
          role: params.role,
          cliEnvPrefix: getCliEnvPrefix(params.convexUrl),
        })
      )
    );
  sections.push(
    createSection(
      'general-commands-reference',
      'knowledge',
      getGeneralCommandsReferenceContent(params)
    )
  );
  return sections;
}
