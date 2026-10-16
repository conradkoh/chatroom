// fallow-ignore-file unused-type
import { handoffCommand } from '../cli/handoff/command';
import { getHandoffRecipientVisibilityCallout } from '../native/handoff-visibility';

/**
 * The single source of truth for verifier verdict tokens.
 *
 * The `ACHIEVED` / `NOT_ACHIEVED` / `INCONCLUSIVE` literals live only here; every
 * template, test, and consumer derives them from this constant so the verdict
 * set cannot drift.
 */
export const VERIFIER_VERDICTS = ['ACHIEVED', 'NOT_ACHIEVED', 'INCONCLUSIVE'] as const;
export type VerifierVerdict = (typeof VERIFIER_VERDICTS)[number];

/**
 * The verifier's single execution exception, shared by the verifier role
 * guidance, both verifier handoff templates, and the planner gate so this
 * behavior has one source: it runs only the tests the user explicitly asked
 * for, and nothing else.
 */
export const VERIFIER_TEST_RULE =
  'runs no test the user did not ask for, and never builds, lints, or edits';

const [ACHIEVED, NOT_ACHIEVED, INCONCLUSIVE] = VERIFIER_VERDICTS;

function normalizeEntryPointRole(entryPointRole: string): string {
  return entryPointRole.trim().toLowerCase() || 'planner';
}

/** Template for a planner requesting a verdict on whether its claimed outcome was achieved. */
export function getEntryPointToVerifierHandoffTemplate(entryPointRole: string): string {
  const entryPoint = normalizeEntryPointRole(entryPointRole);

  return `${getHandoffRecipientVisibilityCallout('verifier')}

## Handoff Template (${entryPoint} → verifier)

The verifier judges, from chatroom logs only, whether the user's last message was achieved. It ${VERIFIER_TEST_RULE}; list any user-requested tests under Requested test runs. Treat the claimed outcome as a claim, not as evidence: the verifier does not trust it and checks every requirement against the logs themselves. Request this review only when the task involved code changes, in any conversation mode. The verdict returns to \`${entryPoint}\`.

For each backlog item in the Backlog checklist, the verifier checks in the logs that it was marked pending review. If the logs show it was not, the verifier runs \`chatroom backlog mark-for-review --chatroom-id=<chatroom-id> --role=<role> --backlog-item-id=<id>\` once per item, records the command and exit result under Scope and limits, and counts that requirement as met. This is the only state-changing action the verifier takes. It is not a build, lint, or edit. The verdict is ${ACHIEVED} when every other requirement is met, including the backlog requirement.

## Round
<1 or 2; for 2, cite the round-1 verdict message id>

## Mode
<chat | code | code:enhanced>

## User message id
<id of the user's last message: the origin message id of the user task, or from \`chatroom messages anchor\`>

## Context id
<id from \`chatroom context read\`, or \`none\` if no context was read for this task>

## Requested test runs
<the test commands the user explicitly asked for, one per line, or exactly \`None requested.\`>

## Claimed outcome
<requirement-by-requirement what you believe is complete>

## Evidence pointers
<builder handoff message ids, commits, PRs, and test results as quoted in those handoffs>

## Known gaps
<anything incomplete, or exactly \`None.\`>

## Backlog checklist
<one line per backlog item attached to this task: \`backlog-item-id: <id>\`, copied from the task's backlog attachment; or exactly \`None.\` when the task has no backlog attachment>

## Handoff
Send this request to the verifier with the command below, then stop. The verdict returns to \`${entryPoint}\`.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: entryPoint,
  nextRole: 'verifier',
  cliEnvPrefix: '',
})}
\`\`\``;
}

/** Template for the verifier returning its advisory verdict to its entry point. */
export function getVerifierToEntryPointHandoffTemplate(entryPointRole: string): string {
  const entryPoint = normalizeEntryPointRole(entryPointRole);

  return `${getHandoffRecipientVisibilityCallout(entryPoint)}

## Handoff Template (Verifier → ${entryPoint})

Return one advisory verdict for the authoritative request. This review is non-binding: it uses chatroom logs, plus the requested test runs listed in the request, if any, deciding every requirement from the evidence those logs and runs actually contain. It also checks the work against the user's expectations (\`## User Expectations\`) under the same logs-only, claim-is-not-evidence rule. It ${VERIFIER_TEST_RULE}. Never accept the claimed outcome as proof. Use the exact sections below, in this order.

## Verdict
<exactly one of ${VERIFIER_VERDICTS.join(', ')} as the value; ${ACHIEVED} only if every requirement and user expectation is met; ${NOT_ACHIEVED} if any requirement or user expectation is unmet (logs show it was not done, or contradict it); ${INCONCLUSIVE} if none is unmet but any is unverified (logs are silent)>

## Objective
<user message id, any prior user messages used, objective in 1-2 sentences>

## Requirements
<numbered \`R1 — <requirement> — met | unmet | unverified — <evidence ref>\`>
For each backlog item listed in the request: \`R<n> — backlog item <id> is marked pending review — met | unmet | unverified — <evidence ref>\`. Met if the logs show \`mark-for-review\` for it, or if the verifier ran \`mark-for-review\` this round (cite the command and exit result under Scope and limits). Unmet only if it could not be marked.

## User Expectations
<numbered \`U1 — <expectation from the user's handoff template> — met | unmet | unverified — <evidence ref>\`; exactly \`None applicable.\` in chat mode or when no expectation applies>

## Evidence
<bullets: \`<message id or handoff> — "<short quote>" — supports R#\`; for a requested test run, \`<command> — exit <result> — supports R#\`>

## Missing or unmet
<per unmet or unverified requirement or user expectation: what is missing and what evidence would resolve it; exactly \`None.\` if ${ACHIEVED}>

## Scope and limits
<state the test runs the verifier executed (command and exit result), or "No tests were run; none were requested."; each backlog \`mark-for-review\` the verifier ran this round, with command and exit result; log range read; whether the download was truncated; context id read and whether it matched the request>

## Handoff
Run the normal handoff command to \`${entryPoint}\` with this complete verdict, then stop.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: 'verifier',
  nextRole: entryPoint,
  cliEnvPrefix: '',
})}
\`\`\``;
}
