/**
 * Key: `trio:coordinator->specifier@code` (bucket `code`).
 * Coordinator → specifier work-package brief. Body only: the pair resolver prepends
 * the recipient callout and the title line.
 */

import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { planReadCommand } from '../../../cli/plan/command';
import { getFileReferenceGuidanceComment } from '../../../utils/file-reference-guidance';
import { getDelegationBriefIntro } from '../../../utils/handoff-section-guidance';

/**
 * Returns the work-package brief the coordinator sends to the specifier. The
 * specifier cannot contact specialists, so the package must carry every
 * decision and message id it needs. The specifier makes exactly one builder
 * pass, so the package must be deliverable in one brief; the coordinator cites
 * only the plan phases this package carries.
 */
export function getCoordinatorSpecifierCodeTemplate(query: HandoffTemplateQuery): string {
  const readPhaseCommand = planReadCommand({
    cliEnvPrefix: query.cliEnvPrefix ?? '',
    chatroomId: query.chatroomId,
    role: 'specifier',
    planId: '<planId>',
    phase: '<Pn>',
  });

  return `Instructions (not part of the message): Delegate one work package to the \`specifier\`. A package is a group of requirements one builder pass can deliver and verify: the specifier writes ONE builder brief, makes one builder handoff, reviews, and reports. It cannot run more passes or plan phases; you own grouping, sequencing and rework. State the outcome, the grouped requirements, specialist decisions, delivery expectations and what earlier packages delivered. Builder passes are slow — it may be a while before you hear back. Do not size passes or write file-level code instructions. Clear every required gate first (researcher, triage, architect, uiux-engineer, game-asset-designer) and include the decisions from their briefs, citing message ids — the specifier cannot contact those roles. Each package starts the specifier in a fresh session: include everything it needs, or name the message ids it must read with \`chatroom messages download\`.

${getDelegationBriefIntro()}

\`\`\`markdown
## Summary
<the user's intent in plain terms and where this package fits in the larger task>

## Goal
<one sentence: the outcome this work package delivers>

## User requirements
<the requirements grouped into THIS package, quoted or paraphrased, each with its source message id>

## Inputs from specialists
<for each architect / researcher / triage / uiux-engineer / game-asset-designer brief this package depends on, including a plan author's design or plan message id: message id and the decisions to adopt; or \`None.\`>
${getFileReferenceGuidanceComment()}

## Scope
- In scope: <surfaces and behaviors>
- Out of scope: <later packages, surfaces, and behaviors the specifier and builder must not touch>

## Plan phases
Plan ID: <planId>, or \`None — no plan for this task\`
Phases in this package: <planId>#Pn, … ; or \`None.\`
Read a cited phase: \`${readPhaseCommand}\`

## Prior deliveries
<earlier packages in this task: report message ids, what landed, and open items; or \`Nothing yet.\`>

## Rework findings (prior delivery)
<message id of the specifier, reviewer, or verifier report and the blocking findings to fix (paste each with file and line where known); or \`None.\`>

## Acceptance criteria
- <verifiable outcome; include at least one end-to-end check>

## Delivery expectations
<commit, branch, push, and PR expectations from the user; or \`None stated.\`>

## History pointers
<message ids or a \`--page-id\` the specifier should download (page ids come from \`chatroom messages pages\`), including the latest package report when this package continues a task; or \`None.\`>
\`\`\``;
}
