import { messagesDownloadCommand, messagesPagesCommand } from '../../utils/proof-of-verification';

export interface HistoryRetrievalGuidanceParams {
  chatroomId?: string | undefined;
  role: string;
  cliEnvPrefix: string;
}

export function getHistoryRetrievalGuidance(params: HistoryRetrievalGuidanceParams): string {
  const { chatroomId, role, cliEnvPrefix } = params;
  const pagesCmd = messagesPagesCommand({ chatroomId, role, cliEnvPrefix });
  const latestCmd = messagesDownloadCommand({ chatroomId, role, cliEnvPrefix });
  const earlierCmd = messagesDownloadCommand({ chatroomId, role, cliEnvPrefix, before: 1 });
  const selectedCmd = messagesDownloadCommand({
    chatroomId,
    role,
    cliEnvPrefix,
    pageId: '<page-id>',
    after: 1,
  });
  return `### History Retrieval

**Pages:** a page is one user message and everything after it, up to the next user message. Its id is that user message's id. The **latest page** is the user's current request and all work since.

**When to use which source:**
- \`${pagesCmd}\` — list recent pages with ids, start times and previews. Use it to find an earlier request.
- \`${latestCmd}\` — download the latest page to disk. **Always use for history summaries** spanning more than the current context window.

**If sources disagree:** \`messages download\` is authoritative for message content.

**Navigating pages:** \`--before=<n>\` adds n earlier pages, \`--after=<n>\` adds n later pages, and \`--page-id=<id>\` starts from a page you picked in the \`messages pages\` output (default: latest). Example: \`${selectedCmd}\` adds the page after it.

**Truncation:** if output shows \`truncated=true\`, re-run with the \`--max-messages\` value the hint prints.

**After download:** Use the **absolute path printed by the CLI** (paths are relative to your working directory, which may not be the repo root).

\`\`\`bash
${pagesCmd}
${latestCmd}
${earlierCmd}
# Then use the path printed in output:
ls "<printed-path>/"
cat "<printed-path>/manifest.json"
rg "pattern" "<printed-path>/"
\`\`\``;
}
