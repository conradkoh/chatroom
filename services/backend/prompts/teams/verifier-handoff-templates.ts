// fallow-ignore-file unused-type
import { handoffCommand } from '../cli/handoff/command';
import type { HandoffTemplateQuery } from '../cli/handoff-templates/contracts';

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

/**
 * Deliverable types a verifier request names. Mixed work names several,
 * comma-separated. Pure conversation has no deliverable and is never requested.
 */
export const VERIFIER_DELIVERABLE_TYPES = ['code', 'docs', 'review', 'research', 'asset'] as const;
type VerifierDeliverableType = (typeof VERIFIER_DELIVERABLE_TYPES)[number];

/**
 * The evidence the verifier reads for each deliverable type. The entry point
 * records it in a chatroom message before it requests the review. Shared by the
 * gate and the request template so the coordinator sees one list.
 */
const VERIFIER_DELIVERABLE_EVIDENCE: Record<VerifierDeliverableType, string> = {
  code: 'commit hashes; pushed and clean-tree evidence (a push result, or a clean `git status`, quoted in a message); the PR URL when a PR was raised; typecheck, lint, and test results quoted in a message',
  docs: 'the changed documentation file paths; commit and push evidence when the docs are tracked in the repository; the PR URL when a PR was raised',
  review:
    'the review report message, naming the reviewed target (commit range, PR, or file list) and each finding',
  research:
    'the findings message that answers each research question, with its sources (URLs, file paths, or message ids)',
  asset:
    'the generated asset output paths; the game-asset-designer checklist results with their evidence labels; the asset-in-rig render when the brief required one',
};

/** One bullet per deliverable type, for the gate and the request instructions. */
export function getVerifierDeliverableEvidenceList(): string {
  return VERIFIER_DELIVERABLE_TYPES.map(
    (type) => `- \`${type}\`: ${VERIFIER_DELIVERABLE_EVIDENCE[type]}`
  ).join('\n');
}

/**
 * The entry point's bookkeeping rule. A user-required step that can run before
 * the verdict is finished and recorded in a message before the request. A step
 * that can only follow the verdict is listed under Known gaps, and the verifier
 * does not judge it.
 */
export const VERIFIER_BOOKKEEPING_RULE =
  'Finish every other user-required step first (for example a push, or a PR the user asked for), and record its command and result in a message listed under Log message ids. A step that can only follow the verdict, such as backlog `chatroom backlog mark-for-review` for an attached backlog item, goes under Known gaps as `pending after verdict: <step>`; the verifier does not count it as unmet or unverified.';

const [ACHIEVED, NOT_ACHIEVED, INCONCLUSIVE] = VERIFIER_VERDICTS;

/** Body for a planner requesting a verdict on whether its claimed outcome was achieved. */
export function getEntryPointToVerifierHandoffTemplate(query: HandoffTemplateQuery): string {
  const entryPoint = query.fromRole;

  return `Instructions (not part of the message): The verifier judges, from chatroom logs only, whether the user's last message was achieved. It ${VERIFIER_TEST_RULE}; list any user-requested tests under Requested test runs. Treat the claimed outcome as a claim, not as evidence: the verifier does not trust it and checks every requirement against the logs themselves. List every message id that carries the claimed work under Log message ids, so the verifier can read those messages from the logs. Request this review whenever the task produced a deliverable (code, docs, review, research, or asset), in any conversation mode; skip it only for pure conversation with no deliverable. ${VERIFIER_BOOKKEEPING_RULE}

Evidence to record for each deliverable type you name, in a message before you send this request, and list that message under Log message ids:
${getVerifierDeliverableEvidenceList()}

The verdict returns to \`${entryPoint}\`.

## Round
<1 or 2; for 2, cite the round-1 verdict message id>

## Mode
<chat | code>

## Deliverable type
<${VERIFIER_DELIVERABLE_TYPES.join(' | ')}; comma-separated when the work produced more than one>

## User message id
<id of the user's last message: the origin message id of the user task, or from \`chatroom messages anchor\`>

## Log message ids
<one per line as \`<message id> — <sender role> — <what it shows>\`: every message that carries the claimed work, in order: builder and specialist handoff reports, the reviewer report, and the evidence messages for each deliverable type; or exactly \`None beyond the user message.\`>

## Requested test runs
<the test commands the user explicitly asked for, one per line, or exactly \`None requested.\`>

## Claimed outcome
<requirement-by-requirement what you believe is complete>

## Evidence pointers
<the evidence for each deliverable type named above, as quoted in the messages listed under Log message ids>

## Known gaps
<anything incomplete, including each \`pending after verdict: <step>\` line, or exactly \`None.\`>

Instructions after the body (not part of the message): run the normal handoff command to \`${entryPoint}\` with the complete body above, then stop.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: entryPoint,
  nextRole: 'verifier',
  cliEnvPrefix: '',
})}
\`\`\``;
}

/** Body for the verifier returning its advisory verdict to the entry role. */
export function getVerifierToEntryPointHandoffTemplate(query: HandoffTemplateQuery): string {
  const entryPoint = query.toRole;

  return `Instructions (not part of the message): Return one advisory verdict for the authoritative request. This review is non-binding: it uses chatroom logs, plus the requested test runs listed in the request, if any, deciding every requirement from the evidence those logs and runs actually contain. It also checks the work against the user's expectations (\`## User Expectations\`) under the same logs-only, claim-is-not-evidence rule. It ${VERIFIER_TEST_RULE}. Never accept the claimed outcome as proof. Use the exact sections below, in this order.

## Verdict
<exactly one of ${VERIFIER_VERDICTS.join(', ')} as the value; ${ACHIEVED} only if every requirement and user expectation is met; ${NOT_ACHIEVED} if any requirement or user expectation is unmet (logs show it was not done, or contradict it); ${INCONCLUSIVE} if none is unmet but any is unverified (logs are silent)>

## Objective
<user message id, any prior user messages used, objective in 1-2 sentences>

## Requirements
<numbered \`R1 — <requirement> — met | unmet | unverified — <evidence ref>\`>

## User Expectations
<numbered \`U1 — <expectation from the user's handoff template that applies to the deliverable type(s) named in the request> — met | unmet | unverified — <evidence ref>\`; exactly \`None applicable.\` in chat mode or when no expectation applies>

## Evidence
<bullets: \`<message id or handoff> — "<short quote>" — supports R#\`; for a requested test run, \`<command> — exit <result> — supports R#\`>

## Missing or unmet
<per unmet or unverified requirement or user expectation: what is missing and what evidence would resolve it; exactly \`None.\` if ${ACHIEVED}>

## Scope and limits
<state the test runs the verifier executed (command and exit result), or "No tests were run; none were requested."; the log range read (first and last message id, and the message count); whether the download was truncated; which Log message ids were found in that range and which were not; each \`pending after verdict\` step the request listed, named as not checked>

Instructions after the body (not part of the message): run the normal handoff command to \`${entryPoint}\` with the complete body above, then stop.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: 'verifier',
  nextRole: entryPoint,
  cliEnvPrefix: '',
})}
\`\`\``;
}
