import { handoffCommand } from '../cli/handoff/command';
import type { HandoffTemplateQuery } from '../cli/handoff-templates/contracts';

/** Body for a planner or solo agent delegating grounded research before planning. */
export function getEntryPointToResearcherHandoffTemplate(query: HandoffTemplateQuery): string {
  const entryPoint = query.fromRole;

  return `The automatically injected \`<user-message>\` is the authoritative request. Pass the decisions the research must ground, the specific research questions, known constraints, and the files or areas already suspected. List the domain nouns the research must check for existing equivalents in the repository, and any source the researcher must prefer or avoid. Ask the researcher for a report only: do not edit files, implement code, or design alternative architectures.

### When to research

Research before delegating when the slice introduces something not already grounded in this repository:
- a new library, API, external service, platform behavior, or version-sensitive dependency;
- an unfamiliar subsystem;
- a choice between several plausible approaches that depends on facts not yet in the repository (the \`architect\` still owns backend contract, API, and schema/persistence design);
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

/** Body for the researcher returning its grounded research brief to the entry role. */
export function getResearcherToEntryPointHandoffTemplate(query: HandoffTemplateQuery): string {
  const entryPoint = query.toRole;

  return `Instructions (not part of the message): Return a complete, evidence-backed research brief for the authoritative request. The researcher is advisory: do not edit files, implement code, or present alternative architectures beyond what grounds the decision. Answer only the questions asked. Separate every finding into confirmed (with evidence), inferred (with reasoning), or unknown. Never present a guess as fact. External claims must cite the source URL together with the version or date checked. Prefer primary sources (official documentation, the package's own source or changelog, the platform's release notes) over blog posts and summaries; if only a secondary source was found, label the claim as resting on it. Use the exact sections below, in this order.

## Summary
<state the answer to the core question in two to four sentences and whether any decision remains open>

## Research questions
<list each question exactly as asked or as derived from the request, numbered>

## Answers
<one entry per question, each tagged \`confirmed\` (with evidence), \`inferred\` (with reasoning), or \`unknown\`>

## Repository evidence
<concrete repository paths and symbols with what each shows; quote the relevant lines briefly; before recommending any new library, type, module, or abstraction, search the repository for an existing concept that does the same job under another name (search the domain nouns and their synonyms), and list each match with whether it fits and why>

## External sources
<one line per source: URL, the version or date checked, whether it is primary (official documentation, source code, changelog, release notes) or secondary, and the specific claim it supports; write exactly \`None consulted.\` if no external source was needed, and say why>

## Grounded facts for the plan
<the facts the planner can rely on when decomposing and delegating, each tagged confirmed or inferred>

## Remaining ambiguity
<each open decision, who must decide it, and a recommended default; write exactly \`None observed.\` if none remain>

## Risks and constraints
<constraints from the repository or external platform, and risks the plan must account for>

## Work completed
<paths inspected, searches run, and sources opened, with the result of each>

Instructions after the body (not part of the message): run the normal handoff command to \`${entryPoint}\` with the complete body above, then stop.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: 'researcher',
  nextRole: entryPoint,
  cliEnvPrefix: '',
})}
\`\`\``;
}
