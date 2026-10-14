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

const [ACHIEVED, NOT_ACHIEVED, INCONCLUSIVE] = VERIFIER_VERDICTS;

function normalizeEntryPointRole(entryPointRole: string): string {
  return entryPointRole.trim().toLowerCase() || 'planner';
}

/** Template for a planner requesting a verdict on whether its claimed outcome was achieved. */
export function getEntryPointToVerifierHandoffTemplate(entryPointRole: string): string {
  const entryPoint = normalizeEntryPointRole(entryPointRole);

  return `${getHandoffRecipientVisibilityCallout('verifier')}

## Handoff Template (${entryPoint} → verifier)

The verifier judges, from chatroom logs only, whether the user's last message was achieved; it executes nothing — no tests, builds, or repository inspection. Treat the claimed outcome as a claim, not as evidence: the verifier does not trust it and checks every requirement against the logs themselves. Request this review only in \`code\` or \`code:enhanced\` mode, never in \`chat\` mode. The verdict returns to \`${entryPoint}\`.

## Round
<1 or 2; for 2, cite the round-1 verdict message id>

## Mode
<code | code:enhanced>

## User message id
<id of the user's last message: the origin message id of the user task, or from \`chatroom messages anchor\`>

## Context id
<id from \`chatroom context read\`, or \`none\`>

## Claimed outcome
<requirement-by-requirement what you believe is complete>

## Evidence pointers
<builder handoff message ids, commits, PRs, and test results as quoted in those handoffs>

## Known gaps
<anything incomplete, or exactly \`None.\`>

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

Return one advisory verdict for the authoritative request. This review is non-binding: it uses chatroom logs only and executes nothing (no tests, builds, or repository inspection), deciding every requirement from the evidence those logs actually contain. Never accept the claimed outcome as proof. Use the exact sections below, in this order.

## Verdict
<exactly one of ${VERIFIER_VERDICTS.join(', ')} as the value; ${ACHIEVED} only if every requirement is met; ${NOT_ACHIEVED} if any requirement is unmet (logs show it was not done, or contradict it); ${INCONCLUSIVE} if none is unmet but any is unverified (logs are silent)>

## Objective
<user message id, any prior user messages used, objective in 1-2 sentences>

## Requirements
<numbered \`R1 — <requirement> — met | unmet | unverified — <evidence ref>\`>

## Evidence
<bullets: \`<message id or handoff> — "<short quote>" — supports R#\`>

## Missing or unmet
<per unmet or unverified requirement: what is missing and what evidence would resolve it; exactly \`None.\` if ${ACHIEVED}>

## Scope and limits
<state "Verified from chatroom logs only. No tests, builds, or repository inspection were run."; log range read; whether the download was truncated; context id read and whether it matched the request>

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
