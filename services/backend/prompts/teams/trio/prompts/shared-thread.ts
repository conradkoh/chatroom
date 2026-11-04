/**
 * Shared thread-knowledge bullet for every trio role.
 *
 * The trio routes most coordination through the coordinator, so each role must
 * be able to rebuild context from the chatroom thread when a brief references
 * decisions made before its own session started.
 */

import type { HistoryRetrievalGuidanceParams } from '../../../cli/history-retrieval/guidance';

/** One bullet telling a trio role to build common knowledge from the thread. */
export function getTrioSharedThreadLine(p: HistoryRetrievalGuidanceParams): string {
  const id = p.chatroomId ? `"${p.chatroomId}"` : '"<chatroom-id>"';
  return `- **Shared thread knowledge:** every role can read the whole thread. When a brief references earlier messages, or you need decisions made before this task, run \`${p.cliEnvPrefix}chatroom messages download --chatroom-id=${id} --role="${p.role}" --format=linear --limit=10\` (add \`--since-message-id=<id>\` to start from a referenced message) and read the files at the printed path, instead of asking for a restatement.`;
}
