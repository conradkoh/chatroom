/**
 * Shared plan-authoring text for the trio specialist handoff templates.
 *
 * A plan is optional and is never authored by the specifier. The coordinator
 * asks for one only when a task needs two or more dependent work packages; the
 * architect (default) or product-manager publishes it before its handoff.
 */

import type { HandoffTemplateQuery } from '../cli/handoff-templates/contracts';
import { planPublishCommand } from '../cli/plan/command';

export interface PlanPublishingOptions {
  /** Trio only: appends the `Plan: required` request / plan-publishing instruction. Default false. */
  planPublishing?: boolean;
}

/** Coordinator-side paragraph: when to ask a specialist for a plan. */
export function getPlanRequestParagraph(
  deliverable: 'design' | 'specification' = 'design'
): string {
  return `**Plan (optional — default none).** Add \`Plan: required\` plus the reason ONLY when the task needs two or more dependent builder work packages across surfaces or workspaces, or the user asked for a plan. Otherwise ask for the ${deliverable} only.`;
}

/** Specialist-side instruction: how and when to publish a plan before its handoff. */
export function getPlanAuthoringInstruction(
  role: 'architect' | 'product-manager',
  query: HandoffTemplateQuery
): string {
  const publishCommand = planPublishCommand({
    cliEnvPrefix: '',
    chatroomId: query.chatroomId,
    role,
  });
  const deliverable = role === 'architect' ? 'design' : 'specification';
  const eligibility =
    role === 'product-manager' ? ' Use this only for a plan that needs no technical design.' : '';

  return `When the request says \`Plan: required\`: after the ${deliverable} is complete and BEFORE you run \`handoff\` (publishing needs an active task), run \`chatroom plan view-template\`, fill it with ordered phases (each phase is a deliverable the coordinator can place in a package; a package carries one or more phases, and a phase is never split across packages; Sources cite the request and your ${deliverable}), publish it with the command below, and write \`Plan ID: <planId>\` as the first line of \`## Summary\`. Do not publish otherwise.${eligibility} Publish a revision only when asked, with \`--supersedes\`.

\`\`\`bash
${publishCommand}
\`\`\``;
}
