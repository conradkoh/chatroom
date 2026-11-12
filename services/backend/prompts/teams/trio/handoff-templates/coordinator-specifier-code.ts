/**
 * Key: `trio:coordinator->specifier@code` (bucket `code`).
 * Coordinator → specifier work-package brief. Body only: the pair resolver prepends
 * the recipient callout and the title line.
 */

import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getFileReferenceGuidanceComment } from '../../../utils/file-reference-guidance';
import { getDelegationBriefIntro } from '../../../utils/handoff-section-guidance';

/**
 * Returns the work-package brief the coordinator sends to the specifier. The
 * specifier cannot contact specialists, so the package must carry every
 * decision and message id it needs. Each package carries one slice of work to
 * the specifier; follow-on slices are new packages.
 */
export function getCoordinatorSpecifierCodeTemplate(_query: HandoffTemplateQuery): string {
  return `Instructions (not part of the message): Delegate ONE work package to the \`specifier\`. The specifier plans the package as file-level builder slices, drives the builder through ONE slice, and hands a slice report back to you that names the slices still to do. Send each remaining slice as a new work package that names the slice to build. Clear every required gate first (researcher, triage, architect, uiux-engineer, game-asset-designer) and include the decisions from their briefs, citing message ids — the specifier cannot contact those roles. Do not write file-level code instructions yourself; state outcomes, constraints, and acceptance criteria. Each package starts the specifier in a fresh session: include everything it needs, or name the message ids it must read with \`chatroom messages download\`.

${getDelegationBriefIntro()}

\`\`\`markdown
## Summary
<the user's intent in plain terms and where this package fits in the larger task>

## Goal
<one sentence: the outcome this work package delivers>

## User requirements
<the user's requirements and constraints, quoted or paraphrased, each with its source message id>

## Inputs from specialists
<for each architect / researcher / triage / uiux-engineer / game-asset-designer brief this package depends on: message id and the decisions to adopt; or \`None.\`>
${getFileReferenceGuidanceComment()}

## Scope
- In scope: <surfaces and behaviors>
- Out of scope: <surfaces the specifier and builder must not touch>

## Rework findings (prior round)
<message id of the specifier, reviewer, or verifier report and the blocking findings to fix (paste each with file and line where known); or \`None.\`>

## Acceptance criteria
- <verifiable outcome; include at least one end-to-end check>

## Delivery expectations
<commit, branch, push, and PR expectations from the user; or \`None stated.\`>

## History pointers
<message ids or a \`--since-message-id\` anchor the specifier should download for context, including the prior slice report when this package continues a slice plan; or \`None.\`>
\`\`\``;
}
