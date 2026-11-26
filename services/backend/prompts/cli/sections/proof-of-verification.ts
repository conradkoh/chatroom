/**
 * "Proof of verification" section for entry-point operating models.
 *
 * Entry-point agents (planner/solo) must verify the user's full request before
 * handing off to `user`, using page-based message commands to recover
 * requirements that may have been lost to compaction.
 */

import { messagesDownloadCommand, messagesPagesCommand } from '../../utils/proof-of-verification';
import type { HistoryRetrievalGuidanceParams } from '../history-retrieval/guidance';

/**
 * Generate the proof-of-verification workflow section for entry-point roles.
 */
export function getProofOfVerificationSection(params: HistoryRetrievalGuidanceParams): string {
  const pagesCmd = messagesPagesCommand(params);
  const downloadCmd = messagesDownloadCommand(params);
  const earlierCmd = messagesDownloadCommand({ ...params, before: 1 });

  return `**Before handoff to \`user\` (proof of verification):**
1. \`${downloadCmd}\` — download the latest page: the user's last message and all work since; re-check it before handing off
2. If the user's last message was terse, run \`${pagesCmd}\` and download the earlier page with \`${earlierCmd}\`
3. If the download is truncated, re-run with the \`--max-messages\` value the hint prints
4. Validate commits and PRs against **all** requirements (not just the last slice)
5. Incomplete → continue next phase or rework; **do not** hand off to user
6. Complete → hand off to user with Proof of Completion verified (requirements + evidence attested) (in \`chat\` mode, verify the same way and reply concisely)`;
}
