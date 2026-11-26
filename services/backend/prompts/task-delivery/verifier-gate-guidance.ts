/**
 * Entry-point verifier gate — single source of truth for when a task delivery
 * requires a `verifier` review before the entry point's final handoff to `user`.
 *
 * Prompt policy only: nothing enforces the gate at runtime. The gate applies to
 * every deliverable the task produced (code, docs, review, research, or asset) in
 * every conversation mode. Only pure conversation with no deliverable is skipped,
 * and the skip is disclosed. The verdict tokens are derived from `VERIFIER_VERDICTS`
 * so they cannot drift from the handoff templates. The rework step adapts to the
 * advertised rework role: a builder or specifier delegates the rework, while a solo
 * entry point reworks its own work.
 */

import {
  VERIFIER_BOOKKEEPING_RULE,
  VERIFIER_DELIVERABLE_TYPES,
  VERIFIER_TEST_RULE,
  VERIFIER_VERDICTS,
  getVerifierDeliverableEvidenceList,
} from '../teams/verifier-handoff-templates';
import { isVerifierRole } from '../utils/verifier-role';

/** Maximum verification rounds requested per user message. */
const VERIFIER_MAX_ROUNDS = 2;

const [ACHIEVED, NOT_ACHIEVED, INCONCLUSIVE] = VERIFIER_VERDICTS;

/**
 * Appended to gate steps 3-5: a delivery without ACHIEVED never runs a deferred step
 * that depends on verified work. Such a step is listed as unresolved instead.
 */
const PENDING_WITHOUT_ACHIEVED_RULE =
  'When you deliver without `ACHIEVED`, do not run a `pending after verdict:` step that depends on verified work (the backlog `mark-for-review` example); list each as unresolved / action required.';

/**
 * Whether the verifier gate applies to this task delivery.
 *
 * True for an entry-point role (planner in duo, solo in solo) whose advertised
 * handoff targets include the `verifier` role, in every conversation mode.
 * Deliberately independent of the message sender and of any legacy enhancer
 * state.
 */
export function shouldIncludeVerifierGate(params: {
  isEntryPoint?: boolean | undefined;
  availableHandoffTargets: readonly string[];
}): boolean {
  return params.isEntryPoint === true && params.availableHandoffTargets.some(isVerifierRole);
}

/**
 * Appends the `<verifier-gate>` block to the task-delivery lines.
 *
 * `reworkRole` selects the rework-dependent clauses: a team that advertises a
 * builder or specifier delegates the rework and asks that role for missing
 * evidence, while a team without one (solo) acts itself. Only those clauses
 * differ between renderings.
 */
export function appendVerifierGateGuidance(
  lines: string[],
  options: { reworkRole: string | null }
): void {
  const reworkClause = options.reworkRole
    ? `, delegate to \`${options.reworkRole}\``
    : ' and do it yourself';
  const inconclusiveClause = options.reworkRole
    ? `get the missing evidence from \`${options.reworkRole}\` once`
    : 'gather the missing evidence yourself once';

  lines.push(
    '',
    '<verifier-gate>',
    '## Verifier Gate',
    `**If this task produced a deliverable, get the \`verifier\` review before your final handoff to \`user\`.** A deliverable is anything the user receives or relies on from the work: code or repository changes (any file edited or commit made for this task, by you or a team member), documentation, a review, a research or analysis finding, or a generated asset. Pure conversation with no deliverable (a direct answer, a clarification, or a status) needs no review: skip it, deliver directly, and disclose the skip as \`Verifier review: not required (conversation only)\`. The verifier judges whether the user's last message was achieved and whether the work meets the user's handoff-template expectations, from chatroom logs and any test runs the user requested; it ${VERIFIER_TEST_RULE}. Do not request it on any handoff to a role other than the final handoff to \`user\`.`,
    `1. Send the request with the \`verifier\` template in \`<handoff-templates>\` (round 1). ${VERIFIER_BOOKKEEPING_RULE} Name the deliverable type in the request (${VERIFIER_DELIVERABLE_TYPES.join(', ')}), and record each named deliverable's evidence in a message before the request:\n${getVerifierDeliverableEvidenceList()}\nThen include the user's last message id, the log message ids (every message carrying the claimed work: builder and specialist handoffs, the reviewer report, and the evidence messages above), the mode, the Requested test runs (the user's test requests, or \`None requested.\`), your claimed outcome, and evidence pointers (the evidence for each deliverable type, quoted from those messages).`,
    `2. \`${ACHIEVED}\`: first run any \`pending after verdict:\` step your request listed, and record its result in a message. Then deliver to \`user\`. In code modes, fill the "Proof of verification (verifier review)" block in the report's Proof of Completion with the verdict message id, the verifier request command, and the round. In \`chat\` mode, add one line instead: \`Verifier review: ACHIEVED (<verdict message id>)\`.`,
    `3. \`${NOT_ACHIEVED}\`: treat "Missing or unmet" as rework${reworkClause}, then request round 2. ${PENDING_WITHOUT_ACHIEVED_RULE}`,
    `4. \`${INCONCLUSIVE}\`: ${inconclusiveClause}, or deliver with the gaps disclosed. ${PENDING_WITHOUT_ACHIEVED_RULE}`,
    `5. Maximum ${VERIFIER_MAX_ROUNDS} verification rounds per user message. After round ${VERIFIER_MAX_ROUNDS}, deliver and list unmet items as unresolved/action required. ${PENDING_WITHOUT_ACHIEVED_RULE}`,
    "6. Ignore a verdict whose user message id is not the user's current last message.",
    '7. If the verifier is unavailable (you are re-woken by the user or any non-verifier task while a request has no verdict), deliver with `Verifier review: UNAVAILABLE (<reason>)` plus your own requirement-by-requirement self-check. Do not re-request for the same user message. In `chat` mode, use one line and a one-sentence self-check.',
    '</verifier-gate>'
  );
}
