import { handoffCommand } from '../cli/handoff/command';
import { getHandoffRecipientVisibilityCallout } from '../native/handoff-visibility';

function normalizeEntryPointRole(entryPointRole: string): string {
  return entryPointRole.trim().toLowerCase() || 'planner';
}

/** Template for a planner or solo agent delegating grounded research before planning. */
export function getEntryPointToResearcherHandoffTemplate(entryPointRole: string): string {
  const entryPoint = normalizeEntryPointRole(entryPointRole);

  return `${getHandoffRecipientVisibilityCallout('researcher')}

## Handoff Template (${entryPoint} → researcher)

The automatically injected \`<user-message>\` is the authoritative request. Pass the decisions the research must ground, the specific research questions, known constraints, and the files or areas already suspected. Ask the researcher for a report only: do not edit files, implement code, or design alternative architectures.

### When to research

Research before delegating when the slice introduces something not already grounded in this repository:
- a new library, API, external service, platform behavior, or version-sensitive dependency;
- an unfamiliar subsystem;
- a change with several plausible designs;
- any ambiguity the user has not resolved.

Skip research when the change is a small, well-understood edit in code you have already inspected.

After completing the research, the researcher must return the evidence-backed brief to \`${entryPoint}\` with the normal handoff command.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: entryPoint,
  nextRole: 'researcher',
  cliEnvPrefix: '',
})}
\`\`\``;
}

/** Template for the researcher returning its grounded research brief to its entry point. */
export function getResearcherToEntryPointHandoffTemplate(entryPointRole: string): string {
  const entryPoint = normalizeEntryPointRole(entryPointRole);

  return `${getHandoffRecipientVisibilityCallout(entryPoint)}

## Handoff Template (Researcher → ${entryPoint})

Return a complete, evidence-backed research brief for the authoritative request. The researcher is advisory: do not edit files, implement code, or present alternative architectures beyond what grounds the decision. Answer only the questions asked. Separate every finding into confirmed (with evidence), inferred (with reasoning), or unknown. Never present a guess as fact. External claims must cite the source URL together with the version or date checked. Use the exact sections below, in this order.

## Summary
<state the answer to the core question in two to four sentences and whether any decision remains open>

## Research questions
<list each question exactly as asked or as derived from the request, numbered>

## Answers
<one entry per question, each tagged \`confirmed\` (with evidence), \`inferred\` (with reasoning), or \`unknown\`>

## Repository evidence
<concrete repository paths and symbols with what each shows; quote the relevant lines briefly>

## External sources
<URL, version or date checked, and the specific claim each source supports; write exactly \`None consulted.\` if no external source was needed, and say why>

## Grounded facts for the plan
<the facts the planner can rely on when decomposing and delegating, each tagged confirmed or inferred>

## Remaining ambiguity
<each open decision, who must decide it, and a recommended default; write exactly \`None observed.\` if none remain>

## Risks and constraints
<constraints from the repository or external platform, and risks the plan must account for>

## Work completed
<paths inspected, searches run, and sources opened, with the result of each>

## Handoff
Run the normal handoff command to \`${entryPoint}\` with this complete brief, then stop.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: 'researcher',
  nextRole: entryPoint,
  cliEnvPrefix: '',
})}
\`\`\``;
}
