/**
 * Entry-point verifier gate — single source of truth for when a task delivery
 * requires a `verifier` review before the entry point's final handoff to `user`.
 *
 * Prompt policy only: nothing enforces the gate at runtime. The gate is the same
 * in every conversation mode; its only condition is whether the task involved
 * code changes, which the entry point judges from the prompt text. The verdict
 * tokens are derived from `VERIFIER_VERDICTS` so they cannot drift from the
 * handoff templates. The rework step adapts to whether a `builder` is advertised,
 * so a solo entry point reworks its own work.
 */

import { VERIFIER_TEST_RULE, VERIFIER_VERDICTS } from '../teams/verifier-handoff-templates';

/** Advertised handoff target that triggers the gate. */
const VERIFIER_ROLE = 'verifier';

/** Maximum verification rounds requested per user message. */
const VERIFIER_MAX_ROUNDS = 2;

const [ACHIEVED, NOT_ACHIEVED, INCONCLUSIVE] = VERIFIER_VERDICTS;

/**
 * Whether the verifier gate applies to this task delivery.
 *
 * True for an entry-point role (planner in duo, solo in solo) whose advertised
 * handoff targets include the `verifier` role, in every conversation mode.
 * Deliberately independent of the message sender and of the legacy
 * `plannerEnhancerEnabled` flag.
 */
export function shouldIncludeVerifierGate(params: {
  isEntryPoint?: boolean | undefined;
  availableHandoffTargets: readonly string[];
}): boolean {
  return (
    params.isEntryPoint === true &&
    params.availableHandoffTargets.some((target) => target.trim().toLowerCase() === VERIFIER_ROLE)
  );
}

/**
 * Appends the `<verifier-gate>` block to the task-delivery lines.
 *
 * `hasBuilder` selects the builder-dependent clauses: a team with a builder
 * delegates the rework and asks the builder for missing evidence, while a team
 * without one (solo) acts itself. Only those clauses differ between renderings.
 */
export function appendVerifierGateGuidance(
  lines: string[],
  options: { hasBuilder: boolean }
): void {
  const reworkClause = options.hasBuilder ? ', delegate to `builder`' : ' and do it yourself';
  const inconclusiveClause = options.hasBuilder
    ? 'get the missing evidence from `builder` once'
    : 'gather the missing evidence yourself once';

  lines.push(
    '',
    '<verifier-gate>',
    '## Verifier Gate',
    `**If this task involved code changes, get the \`verifier\` review before your final handoff to \`user\`.** Code changes means any repository file was edited or any commit was made for this task, by you or by a team member. If none were made, skip the review and deliver directly. The verifier judges whether the user's last message was achieved and whether the work meets the user's handoff-template expectations, from chatroom logs and any test runs the user requested; it ${VERIFIER_TEST_RULE}. Do not request it when you are handing off to builder/architect/researcher/triage/uiux-engineer.`,
    "1. Send the request with the `verifier` template in `<handoff-templates>` (round 1). Include the user's last message id, the context id, the mode, the Requested test runs (the user's test requests, or `None requested.`), your claimed outcome, and evidence pointers (builder handoff ids, commit hashes, test results quoted in the logs).",
    `2. \`${ACHIEVED}\`: deliver to \`user\` and fill the "Proof of verification (verifier review)" block in the report's Proof of Completion with the verdict message id, the verifier request command, and the round.`,
    `3. \`${NOT_ACHIEVED}\`: treat "Missing or unmet" as rework${reworkClause}, then request round 2.`,
    `4. \`${INCONCLUSIVE}\`: ${inconclusiveClause}, or deliver with the gaps disclosed.`,
    `5. Maximum ${VERIFIER_MAX_ROUNDS} verification rounds per user message. After round ${VERIFIER_MAX_ROUNDS}, deliver and list unmet items as unresolved/action required.`,
    "6. Ignore a verdict whose user message id is not the user's current last message.",
    '7. If the verifier is unavailable (you are re-woken by the user or any non-verifier task while a request has no verdict), deliver with `Verifier review: UNAVAILABLE (<reason>)` plus your own requirement-by-requirement self-check. Do not re-request for the same user message.',
    '</verifier-gate>'
  );
}
