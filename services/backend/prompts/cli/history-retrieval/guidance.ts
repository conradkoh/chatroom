import {
  messagesAnchorCommand,
  messagesDownloadSinceCommand,
} from '../../utils/proof-of-verification';
import { contextReadCommand } from '../context/read';

export interface HistoryRetrievalGuidanceParams {
  chatroomId?: string | undefined;
  role: string;
  cliEnvPrefix: string;
}

export function getHistoryRetrievalGuidance(params: HistoryRetrievalGuidanceParams): string {
  const { chatroomId, role, cliEnvPrefix } = params;
  const contextReadCmd = contextReadCommand({ chatroomId, role, cliEnvPrefix });
  const anchorCmd = messagesAnchorCommand({ chatroomId, role, cliEnvPrefix });
  const downloadCmd = messagesDownloadSinceCommand({
    chatroomId,
    role,
    cliEnvPrefix,
    sinceMessageId: '<id-from-anchor>',
    limit: 100,
  });
  return `### History Retrieval

**When to use which source:**
- \`${contextReadCmd}\` — Current-task grounding only (pinned goal, recent inline history). Not sufficient for cross-task summaries.
- \`${cliEnvPrefix}chatroom messages download --chatroom-id="${chatroomId}" --role="${role}" --format=linear --limit=10\` — Searchable message history on disk. **Always use for history summaries** spanning more than the current context window.
- \`${anchorCmd}\` — Locate the user's last message and print the \`--since-message-id\` to download history since that anchor (proof of verification before handing off to \`user\`).

**If sources disagree:** \`messages download\` is authoritative for message content.

**Pagination:** Start with \`--limit=10\`. If output shows \`truncated=true\`, re-run with a higher \`--limit\` (e.g. 50, 100). No cursor — increasing limit fetches further back from newest. \`--since-message-id\` downloads forward from an anchor message (inclusive).

**After download:** Use the **absolute path printed by the CLI** (paths are relative to your working directory, which may not be the repo root).

\`\`\`bash
${cliEnvPrefix}chatroom messages anchor --chatroom-id="${chatroomId}" --role="${role}"
${cliEnvPrefix}chatroom messages download --chatroom-id="${chatroomId}" --role="${role}" --format=linear --limit=10
${downloadCmd}
# Then use the path printed in output:
ls "<printed-path>/"
cat "<printed-path>/manifest.json"
rg "pattern" "<printed-path>/"
\`\`\``;
}
