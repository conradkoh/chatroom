/**
 * "Proof of verification" section for entry-point operating models.
 *
 * Entry-point agents (planner/solo) must verify the user's full request before
 * handing off to `user`, using `messages anchor` + `messages download` to
 * recover requirements that may have been lost to compaction.
 */

import {
  messagesAnchorCommand,
  messagesDownloadSinceCommand,
} from '../../utils/proof-of-verification';
import type { HistoryRetrievalGuidanceParams } from '../history-retrieval/guidance';

/**
 * Generate the proof-of-verification workflow section for entry-point roles.
 */
export function getProofOfVerificationSection(params: HistoryRetrievalGuidanceParams): string {
  return `**Before handoff to \`user\` (proof of verification):**
1. \`messages anchor\` — locate the user's last message
2. \`messages download --since-message-id=<id>\` — download grep-friendly history; read handoffs and goals
3. If the user message was terse, review prior user messages from anchor output and widen \`--limit\`
4. Validate commits and PRs against **all** requirements (not just the last slice)
5. Incomplete → continue next phase or rework; **do not** hand off to user
6. Complete → hand off to user with Proof of Completion verified (requirements + evidence attested)

\`${messagesAnchorCommand(params)}\`
\`${messagesDownloadSinceCommand({ ...params, sinceMessageId: '<from-anchor>', limit: 100 })}\``;
}
