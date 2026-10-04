import { handoffCommand } from '../cli/handoff/command';
import { getHandoffRecipientVisibilityCallout } from '../native/handoff-visibility';

function normalizeEntryPointRole(entryPointRole: string): string {
  return entryPointRole.trim().toLowerCase() || 'planner';
}

/** Template for a planner or solo agent delegating a bug investigation to triage. */
export function getEntryPointToTriageHandoffTemplate(entryPointRole: string): string {
  const entryPoint = normalizeEntryPointRole(entryPointRole);

  return `${getHandoffRecipientVisibilityCallout('triage')}

## Handoff Template (${entryPoint} → triage)

The automatically injected \`<user-message>\` is the authoritative request. Pass the reported bug, observed and expected behavior, reproduction details and commands, relevant constraints, and the files or symbols already suspected. Ask triage to investigate and report only. Triage may inspect code and attempt a focused automated regression test as evidence, but must not edit implementation files or implement a fix.

After completing the investigation, triage must return the evidence-backed report to \`${entryPoint}\` with the normal handoff command.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: entryPoint,
  nextRole: 'triage',
  cliEnvPrefix: '',
})}
\`\`\``;
}

/** Template for triage returning its investigation report to its entry point. */
export function getTriageToEntryPointHandoffTemplate(entryPointRole: string): string {
  const entryPoint = normalizeEntryPointRole(entryPointRole);

  return `${getHandoffRecipientVisibilityCallout(entryPoint)}

## Handoff Template (Triage → ${entryPoint})

Return a complete, evidence-backed investigation of the authoritative reported bug. Triage is advisory: do not edit implementation files or implement the proposed fix. Use the exact sections below. Cite concrete repository paths and symbols, observed behavior, commands, and test output. Distinguish confirmed findings from hypotheses; never claim a test proved behavior unless its failing assertion demonstrates the report.

## Summary
<briefly state the diagnosis and whether the root cause was confirmed or remains a hypothesis>

## Reported behavior
<state the reported symptoms and expected behavior, including reproduction details and constraints recovered from the request or relevant history>

## Root cause
<trace the relevant ownership, data, and control flow using concrete repository paths and symbols; explain the causal reasoning and explicitly label the finding as confirmed or a hypothesis>

## Reproduction attempt
<give the focused test path and exact command, the failing assertion or exact blocker, and the outcome; if reproduction was blocked, state what was tried and what additional information would help; do not fabricate proof>

## Proposed immediate fix
<recommend the smallest appropriate change, naming the likely files and the specific change; do not implement it>

## Systemic issues
<list each separate systemic concern with repository evidence, impact, and follow-up concern, or write exactly: None observed.>

## Work completed
<state the code paths inspected and every test or reproduction action taken, including results>

## Handoff
Run the normal handoff command to \`${entryPoint}\` with this complete report, then stop.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: 'triage',
  nextRole: entryPoint,
  cliEnvPrefix: '',
})}
\`\`\``;
}
