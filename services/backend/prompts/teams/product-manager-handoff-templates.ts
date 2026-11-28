import {
  getPlanAuthoringInstruction,
  getPlanRequestParagraph,
  type PlanPublishingOptions,
} from './plan-authoring-guidance';
import { handoffCommand } from '../cli/handoff/command';
import type { HandoffTemplateQuery } from '../cli/handoff-templates/contracts';

/** Body for an entry-point role (planner, solo, or coordinator) delegating a product specification to the product manager. */
export function getEntryPointToProductManagerHandoffTemplate(
  query: HandoffTemplateQuery,
  options: PlanPublishingOptions = {}
): string {
  const entryPoint = query.fromRole;
  const planParagraph = options.planPublishing
    ? `\n\n${getPlanRequestParagraph('specification')}`
    : '';

  return `The automatically injected \`<user-message>\` is the authoritative request. Pass the feature request in the user's words, the problem it solves and who it is for, any constraints or decisions already made, and the areas of the app it likely touches. List the domain nouns the product manager must check for existing equivalents in the repository. Ask the product manager for a specification only: do not edit files, implement code, or design the technical architecture.

Use this for a new, ambiguous feature request whose scope is not yet decided. Skip it for small bug fixes and for requests whose scope is already unambiguous, unless a bug fix needs a scope decision.

After completing the specification, the product manager must return it to \`${entryPoint}\` with the normal handoff command.${planParagraph}

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: entryPoint,
  nextRole: 'product-manager',
  cliEnvPrefix: '',
})}
\`\`\``;
}

/** Body for the product manager returning its specification to the entry-point role. */
export function getProductManagerToEntryPointHandoffTemplate(
  query: HandoffTemplateQuery,
  options: PlanPublishingOptions = {}
): string {
  const entryPoint = query.toRole;
  const planInstruction = options.planPublishing
    ? `\n\n${getPlanAuthoringInstruction('product-manager', query)}`
    : '';

  return `Instructions (not part of the message): Return a complete product specification for the authoritative feature request. The product manager is advisory and read-only: do not edit files, build, or implement. Base every consistency claim on the existing app behavior you inspected, citing concrete repository paths and symbols, documentation, or decision records. Decide every development-scope product decision yourself with a recommended default and rationale; return non-development product questions (copy, pricing, opinions, general product talk) to \`${entryPoint}\` in \`## Summary\`; list a question for the user only if it meets the escalation criteria. Begin with the \`## Summary\` section, then use the remaining sections below in order. Use \`###\` for sub-items within a section.${planInstruction}

## Summary
<state the feature, the recommended scope in two to four sentences, and whether any escalation item blocks planning>

## Problem statement
<the problem the user is trying to solve, who is affected, and the outcome they want, recovered from the request and relevant history>

## User stories
<one \`###\` per story in the form "As a <user>, I want <capability>, so that <outcome>", each followed by a bullet list of testable acceptance criteria>

## In scope
<every capability, behavior, and state the feature includes, including the states needed to make it feature complete (loading, empty, error, permissions, and migration of existing data where they apply)>

## Out of scope
<each excluded or deferred item with a one-line reason; write exactly \`None observed.\` if nothing is excluded>

## Consistency with existing functionality
<the existing capabilities the feature must stay consistent with, with concrete paths and symbols as evidence; where the feature extends or conflicts with existing behavior, say so and record each conflict as a product decision under \`## Product decisions made\`; the gaps the feature would leave if the proposed scope is not accepted>

## UI and UX review
<if the feature has any UI surface (a new screen, panel, flow, interaction, or visible state), state that \`${entryPoint}\` must get a \`uiux-engineer\` design before any UI work on this feature, and name each surface; do not design layout yourself. If the feature has no UI surface, write exactly \`No UI surface: no uiux-engineer design needed.\`>

## Product decisions made
<one \`###\` per development-scope product decision you made (scope, user stories, in and out of scope, consistency with existing behavior), each with the options considered, the recommended default you chose, and a one-line rationale; write exactly \`None observed.\` if you made none>

## Open questions for the user
<only items that meet the escalation criteria: (a) the request is clearly ambiguous or insufficient, and no specialist can settle the question from the request, the code, the decision records, or the documentation; (b) the decision involves deletion, data loss, an irreversible migration, an externally visible or production-affecting action, or spending money. For each, give the options, the consequence of each, and a recommended default. Do not list ordinary product choices here: decide them under \`## Product decisions made\`. Write exactly \`None observed.\` if no item meets the criteria>

Instructions after the body (not part of the message): run the normal handoff command to \`${entryPoint}\` with the complete body above, then stop.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: 'product-manager',
  nextRole: entryPoint,
  cliEnvPrefix: '',
})}
\`\`\``;
}
