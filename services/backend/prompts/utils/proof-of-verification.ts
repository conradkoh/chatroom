/**
 * Proof of verification workflow for entry-point user handoffs.
 *
 * Entry-point agents (planner/solo) must read the latest page (the user's last
 * message and all work since) and the earlier pages a terse follow-up depends
 * on before handing off to the user — especially on long multi-phase tasks that
 * survive compaction.
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
  /** Start message id of the page to begin from (omit = latest page). */
  pageId?: string | undefined;
  /** Earlier pages to include (omit = 0). */
  before?: number | undefined;
  /** Later pages to include (omit = 0). */
  after?: number | undefined;
}

/** Generate the `messages pages` command string. */
export function messagesPagesCommand(params: ProofOfVerificationParams = {}): string {
  const prefix = params.cliEnvPrefix ?? '';
  const chatroomId = params.chatroomId ?? '<chatroom-id>';
  const role = params.role ?? '<role>';
  return `${prefix}chatroom messages pages --chatroom-id="${chatroomId}" --role="${role}"`;
}

/** Generate the `messages download` command string (latest page by default). */
// fallow-ignore-next-line complexity
export function messagesDownloadCommand(params: ProofOfVerificationDownloadParams = {}): string {
  const prefix = params.cliEnvPrefix ?? '';
  const chatroomId = params.chatroomId ?? '<chatroom-id>';
  const role = params.role ?? '<role>';
  const flags = [
    `--chatroom-id="${chatroomId}"`,
    `--role="${role}"`,
    ...(params.pageId !== undefined ? [`--page-id="${params.pageId}"`] : []),
    ...(params.before !== undefined ? [`--before=${params.before}`] : []),
    ...(params.after !== undefined ? [`--after=${params.after}`] : []),
  ];
  return `${prefix}chatroom messages download ${flags.join(' ')}`;
}

const PROOF_OF_VERIFICATION_CHECKBOX =
  "- [ ] I confirm I verified the user's full request: reviewed the latest page (the user's last message and all work since), reviewed earlier pages when the latest was a terse follow-up, and validated every requirement below before this handoff";

const VERIFIER_REVIEW_CHECKBOX =
  "- [ ] I checked the verifier verdict for this task: its user message id is the user's current last message, it is round 1 or 2 (maximum 2), and the verdict is `ACHIEVED` — or every unmet item is listed under Unresolved / action required";

/** The verifier verdict values accepted by the disclosure, derived from the single source. */
const VERIFIER_REVIEW_VALUES = `${VERIFIER_VERDICTS.join(' | ')} | UNAVAILABLE (<reason>) | not required (conversation only)`;

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
  const pagesCmd = messagesPagesCommand(params);
  const downloadCmd = messagesDownloadCommand(params);
  const earlierCmd = messagesDownloadCommand({ ...params, before: 1 });
  return `<!-- Entry-point proof-of-completion workflow — run before filling this section:
1. \`${downloadCmd}\` — download the latest page: the user's last message and all work since; read handoffs and goals
2. If the user's last message was terse (e.g. "do it", "raise a PR"), run \`${pagesCmd}\` and download the earlier page with \`${earlierCmd}\`
3. Validate commits/PRs against ALL requirements — not just the last slice. Incomplete → rework; do NOT hand off to user.
Then: \`${downloadCmd}\` (re-check the latest page before handing off) -->`;
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
