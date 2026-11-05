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
 * decision and message id it needs.
 */
export function getCoordinatorSpecifierCodeTemplate(_query: HandoffTemplateQuery): string {
  return `${getDelegationBriefIntro()}

Instructions (not part of the message): Delegate ONE work package to the \`specifier\`. The specifier turns it into file-level builder slices, drives the builder through every build pass, and hands one consolidated report back to you. Clear every required gate first (researcher, triage, architect, uiux-engineer, game-asset-designer) and include the decisions from their briefs, citing message ids — the specifier cannot contact those roles. Do not write file-level code instructions yourself; state outcomes, constraints, and acceptance criteria. Each package starts the specifier in a fresh session: include everything it needs, or name the message ids it must read with \`chatroom messages download\`.

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

## Acceptance criteria
- <verifiable outcome; include at least one end-to-end check>

## Delivery expectations
<commit, branch, push, and PR expectations from the user; or \`None stated.\`>

## History pointers
<message ids or a \`--since-message-id\` anchor the specifier should download for context; or \`None.\`>
\`\`\``;
}
