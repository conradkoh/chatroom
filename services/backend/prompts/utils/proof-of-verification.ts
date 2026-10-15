/**
 * Proof of verification workflow for entry-point user handoffs.
 *
 * Entry-point agents (planner/solo) must re-anchor on the user's last message
 * and download grep-friendly history since that anchor before handing off to
 * the user — especially on long multi-phase tasks that survive compaction.
 *
 * The verification workflow is rolled up INTO the Proof of Completion section
 * (not a separate `## Proof of Verification` heading), so the agent answers
 * "was the goal met?" once, with requirement-by-requirement evidence.
 *
 * It also discloses the verifier review: the command the entry point sent to
 * request the verifier verdict, and the requirement to check that verdict
 * before delivering to the user. This too lives inside Proof of Completion.
 */

import { VERIFIER_VERDICTS } from '../teams/verifier-handoff-templates';

export interface ProofOfVerificationParams {
  chatroomId?: string | undefined;
  role?: string | undefined;
  /** CLI environment prefix for non-production environments (empty string for production) */
  cliEnvPrefix?: string | undefined;
}

export interface ProofOfVerificationDownloadParams extends ProofOfVerificationParams {
  sinceMessageId?: string | undefined;
  limit?: number | undefined;
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
  "- [ ] I confirm I verified the user's full request: anchored on the last user message, downloaded history since that anchor, reviewed handoffs/goals (including prior user messages when the latest was a terse follow-up), and validated every requirement below before this handoff";

const VERIFIER_REVIEW_CHECKBOX =
  "- [ ] I checked the verifier verdict for this task: its user message id is the user's current last message, it is round 1 or 2 (maximum 2), and the verdict is `ACHIEVED` — or every unmet item is listed under Unresolved / action required";

/** The verifier verdict values accepted by the disclosure, derived from the single source. */
const VERIFIER_REVIEW_VALUES = `${VERIFIER_VERDICTS.join(' | ')} | UNAVAILABLE (<reason>) | not required (no code changes)`;

/** Command prefix for the verifier request, matching the `handoff` command shape. */
function verifierRequestCommand(params: ProofOfVerificationParams = {}): string {
  const prefix = params.cliEnvPrefix ?? '';
  const chatroomId = params.chatroomId ?? '<chatroom-id>';
  const role = params.role ?? '<role>';
  return `${prefix}chatroom handoff --chatroom-id="${chatroomId}" --role="${role}" --next-role="verifier"`;
}

/**
 * Verifier review disclosure for the entry-point Proof of Completion.
 * Discloses the verifier request command actually sent, and requires the entry
 * point to check the verdict before handing off to `user`.
 */
// fallow-ignore-next-line unused-export
export function getVerifierReviewDisclosureBlock(params: ProofOfVerificationParams = {}): string {
  return `**Proof of verification (verifier review):**
${VERIFIER_REVIEW_CHECKBOX}
- Verifier review: <${VERIFIER_REVIEW_VALUES}>
- Verifier request command (disclose the command you sent): \`${verifierRequestCommand(params)}\`
- Verifier request message id: <id of your verifier handoff> · Round: <1 | 2>
- Verdict message id: <id of the verifier's verdict handoff> · Verdict user message id: <id> (must equal the current last user message)
- Verdict gaps (only if not ACHIEVED): <each unmet item, or \`None.\`>`;
}

/** HTML comment with the entry-point proof-of-completion workflow commands. */
function getProofOfVerificationComment(params: ProofOfVerificationParams = {}): string {
  const anchorCmd = messagesAnchorCommand(params);
  const downloadCmd = messagesDownloadSinceCommand({
    ...params,
    sinceMessageId: '<from-anchor>',
    limit: 100,
  });
  return `<!-- Entry-point proof-of-completion workflow — run before filling this section:
1. \`${anchorCmd}\` — locate the user's last message (and prior user messages for context)
2. \`${downloadCmd}\` — download grep-friendly history since anchor; read handoffs and goals
3. If the user's last message was terse (e.g. "do it", "raise a PR"), review prior user messages from anchor output and widen --limit before validating
4. Validate commits/PRs against ALL requirements — not just the last slice. Incomplete → rework; do NOT hand off to user.
Then: \`${anchorCmd}\` → \`${downloadCmd}\` (use the message ID from anchor output as --since-message-id) -->`;
}

/**
 * Entry-point Proof of Completion extension: verification workflow comment +
 * verification checkbox + verifier-review disclosure. Rendered INSIDE Proof of
 * Completion (not a separate `## Proof of Verification` section).
 */
export function getEntryPointProofOfCompletionVerificationBlock(
  params: ProofOfVerificationParams = {}
): string {
  return `${getProofOfVerificationComment(params)}\n${PROOF_OF_VERIFICATION_CHECKBOX}\n${getVerifierReviewDisclosureBlock(params)}`;
}
