import {
  messagesAnchorCommand,
  messagesDownloadSinceCommand,
} from '../utils/proof-of-verification';
import { getHistoryRetrievalGuidance } from '../cli/history-retrieval/guidance';

export interface EnhancerHistoryRetrievalParams {
  chatroomId: string;
  cliEnvPrefix: string;
  originUserMessageId?: string;
}

/**
 * The enhancer is memoryless, so every job reconstructs context from the
 * originating user message rather than relying on entry-point-authored summaries.
 */
export function getEnhancerHistoryRetrievalGuidance(
  params: EnhancerHistoryRetrievalParams
): string {
  const anchorCmd = messagesAnchorCommand({
    chatroomId: params.chatroomId,
    role: 'enhancer',
    cliEnvPrefix: params.cliEnvPrefix,
  });
  const originMessageId = params.originUserMessageId ?? '<origin-user-message-id>';
  const downloadCmd = messagesDownloadSinceCommand({
    chatroomId: params.chatroomId,
    role: 'enhancer',
    cliEnvPrefix: params.cliEnvPrefix,
    sinceMessageId: originMessageId,
    limit: 100,
  });
  const originLine = params.originUserMessageId
    ? `The backend identified \`${params.originUserMessageId}\` as the originating user message. Treat it as the authoritative anchor for this job.`
    : 'This legacy job has no origin message ID. Run the anchor command first, then replace `<origin-user-message-id>` below with the ID it prints.';

  const sharedGuidance = getHistoryRetrievalGuidance({ chatroomId: params.chatroomId, role: 'enhancer', cliEnvPrefix: params.cliEnvPrefix });
  return `## Recover user context (do this first)

${originLine}

Use the current anchor + \`--since-message-id\` history convention:

\`\`\`bash
${anchorCmd}
${downloadCmd}
\`\`\`

For jobs with a supplied origin ID, the download command is the primary path; \`messages anchor\` is useful for seeing prior user-message previews when the request is terse. Use the **absolute path** printed by the CLI and read the downloaded messages before forming conclusions.

${sharedGuidance}

Treat actual user messages as authoritative.`;
}
