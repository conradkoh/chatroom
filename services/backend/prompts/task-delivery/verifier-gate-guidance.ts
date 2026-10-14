/**
 * Entry-point verifier gate — single source of truth for when a task delivery
 * requires a `verifier` review before the entry point's final handoff to `user`.
 *
 * Prompt policy only: nothing enforces the gate at runtime. The mode decision
 * lives solely in `shouldIncludeVerifierGate` (no mode list exists anywhere
 * else), and the verdict tokens are derived from `VERIFIER_VERDICTS` so they
 * cannot drift from the handoff templates. The rework step adapts to whether a
 * `builder` is advertised, so a solo entry point reworks its own work.
 */

import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';

import { VERIFIER_TEST_RULE, VERIFIER_VERDICTS } from '../teams/verifier-handoff-templates';

/** Advertised handoff target that triggers the gate. */
const VERIFIER_ROLE = 'verifier';

/** Maximum verification rounds requested per user message. */
const VERIFIER_MAX_ROUNDS = 2;

const [ACHIEVED, NOT_ACHIEVED, INCONCLUSIVE] = VERIFIER_VERDICTS;

/**
 * Whether the verifier gate applies to this task delivery.
 *
 * True for an entry-point role (planner in duo, solo in solo) in a non-chat
 * mode whose advertised handoff targets include the `verifier` role.
 * Deliberately independent of the message sender (user-origin and builder-return
 * tasks alike) and of the legacy `plannerEnhancerEnabled` flag.
 */
export function shouldIncludeVerifierGate(params: {
  isEntryPoint?: boolean | undefined;
  conversationMode?: ConversationMode | undefined;
  availableHandoffTargets: readonly string[];
}): boolean {
  return (
    params.isEntryPoint === true &&
    params.conversationMode !== 'chat' &&
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
    '## Verifier Gate (required in code and code:enhanced modes)',
    `**Before your final handoff to \`user\`, get the \`verifier\` review.** It judges whether the user's last message was achieved, from chatroom logs and any test runs the user requested; it ${VERIFIER_TEST_RULE}. This does not apply to Chat mode, and does not apply when you are handing off to builder/architect/researcher/triage/uiux-engineer.`,
    "1. Send the request with the `verifier` template in `<handoff-templates>` (round 1). Include the user's last message id, the context id, the mode, the Requested test runs (the user's test requests, or `None requested.`), your claimed outcome, and evidence pointers (builder handoff ids, commits, test results quoted in the logs).",
    `2. \`${ACHIEVED}\`: deliver to \`user\` and cite the verdict message id in the report (Summary or Proof of Completion).`,
    `3. \`${NOT_ACHIEVED}\`: treat "Missing or unmet" as rework${reworkClause}, then request round 2.`,
    `4. \`${INCONCLUSIVE}\`: ${inconclusiveClause}, or deliver with the gaps disclosed.`,
    `5. Maximum ${VERIFIER_MAX_ROUNDS} verification rounds per user message. After round ${VERIFIER_MAX_ROUNDS}, deliver and list unmet items as unresolved/action required.`,
    "6. Ignore a verdict whose user message id is not the user's current last message.",
    '7. If the verifier is unavailable (you are re-woken by the user or any non-verifier task while a request has no verdict), deliver with `Verifier review: UNAVAILABLE (<reason>)` plus your own requirement-by-requirement self-check. Do not re-request for the same user message.',
    '</verifier-gate>'
  );
}
