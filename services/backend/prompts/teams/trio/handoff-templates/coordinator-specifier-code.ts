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
 * decision and message id it needs. Each package states the outcome and what the
 * plan has already delivered; a follow-on package cites the plan by ID instead
 * of restating it.
 */
export function getCoordinatorSpecifierCodeTemplate(query: HandoffTemplateQuery): string {
  const readPlanCommand = planReadCommand({
    cliEnvPrefix: query.cliEnvPrefix ?? '',
    chatroomId: query.chatroomId,
    role: 'specifier',
    planId: '<planId>',
  });

  return `Instructions (not part of the message): Delegate one work package to the \`specifier\`. State the outcome, the user's requirements and constraints, the specialist decisions, the delivery expectations, and what the plan has already delivered. The specifier plans the slices, decides which phases it delegates in this round, drives the builder through them, and reports back. Builder rounds are slow — it may be a while before you hear back. Do not size its rounds or write file-level code instructions. Clear every required gate first (researcher, triage, architect, uiux-engineer, game-asset-designer) and include the decisions from their briefs, citing message ids — the specifier cannot contact those roles. Each package starts the specifier in a fresh session: include everything it needs, or name the message ids it must read with \`chatroom messages download\`.

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

## Plan reference
Plan ID: <planId>, or \`None — first pass: publish the plan\`
Delivered so far: <phases the plan already landed and anything left open; or \`Nothing yet.\`>
Read the plan when useful: \`${readPlanCommand}\`

## Rework findings (prior round)
<message id of the specifier, reviewer, or verifier report and the blocking findings to fix (paste each with file and line where known); or \`None.\`>

## Acceptance criteria
- <verifiable outcome; include at least one end-to-end check>

## Delivery expectations
<commit, branch, push, and PR expectations from the user; or \`None stated.\`>

## History pointers
<message ids or a \`--since-message-id\` anchor the specifier should download for context, including the prior round report when this package continues a plan; or \`None.\`>
\`\`\``;
}
