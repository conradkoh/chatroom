/**
 * Proof of verification attestation for entry-point user handoffs.
 *
 * Entry-point agents (planner/solo) must re-anchor on the user's last message
 * and download grep-friendly history since that anchor before handing off to
 * the user — especially on long multi-phase tasks that survive compaction.
 */

export interface ProofOfVerificationParams {
  chatroomId?: string;
  role?: string;
  /** CLI environment prefix for non-production environments (empty string for production) */
  cliEnvPrefix?: string;
}

export interface ProofOfVerificationDownloadParams extends ProofOfVerificationParams {
  sinceMessageId?: string;
  limit?: number;
}

/** Generate the `messages anchor` command string. */
export function messagesAnchorCommand(params: ProofOfVerificationParams = {}): string {
  const prefix = params.cliEnvPrefix ?? '';
  const chatroomId = params.chatroomId ?? '<chatroom-id>';
  const role = params.role ?? '<role>';
  return `${prefix}chatroom messages anchor --chatroom-id="${chatroomId}" --role="${role}"`;
}

/** Generate the `messages download --since-message-id` command string. */
// fallow-ignore-next-line complexity
export function messagesDownloadSinceCommand(
  params: ProofOfVerificationDownloadParams = {}
): string {
  const prefix = params.cliEnvPrefix ?? '';
  const chatroomId = params.chatroomId ?? '<chatroom-id>';
  const role = params.role ?? '<role>';
  const sinceMessageId = params.sinceMessageId ?? '<id>';
  const limit = params.limit ?? 100;
  return `${prefix}chatroom messages download --chatroom-id="${chatroomId}" --role="${role}" --since-message-id="${sinceMessageId}" --limit=${limit}`;
}

const PROOF_OF_VERIFICATION_CHECKBOX =
  "- [ ] I confirm I ran proof of verification: anchored on the user's last message, downloaded history since that anchor, reviewed handoffs/goals, and validated commits/PRs against all user requirements before this handoff";

/** HTML comment with the exact proof-of-verification workflow commands. */
function getProofOfVerificationComment(params: ProofOfVerificationParams = {}): string {
  return `<!-- ${messagesAnchorCommand(params)} then messages download --since-message-id=<id> from anchor output -->`;
}

/** Checkbox + HTML comment for entry-point Proof of Verification sections. */
export function getProofOfVerificationDisclosureBlock(
  params: ProofOfVerificationParams = {}
): string {
  return `${PROOF_OF_VERIFICATION_CHECKBOX}\n${getProofOfVerificationComment(params)}`;
}
