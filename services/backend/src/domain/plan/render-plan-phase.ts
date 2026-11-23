/**
 * Render Plan Phase
 *
 * Projects one phase of a parsed plan to markdown for `plan read --phase`.
 * The output is a human-facing projection, not a re-parseable plan: the
 * selected phase is bold-marked in the phase list, `Sources`/`Remarks` are
 * omitted, and only the selected phase's detail block is rendered.
 *
 * Constraints:
 * - Pure: no I/O, no Convex types.
 * - Omits the phase "Depends on" sub-section when the phase has no dependencies.
 * - Empty lists render as a single `- None.` bullet.
 * - Multi-line items keep their continuation lines indented by two spaces.
 */

import type { ParsedPhase, ParsedPlan } from './parse-plan';
import {
  PLAN_HEADINGS,
  PLAN_NONE_TOKEN,
  PLAN_PHASE_SEPARATOR,
  planPhaseHeading,
  planPhaseSectionHeading,
  planSectionHeading,
} from './plan-template-spec';

/** Append a bullet list, falling back to `- None.` for an empty list. */
function appendBullets(lines: string[], items: string[]): void {
  if (items.length === 0) {
    lines.push(`- ${PLAN_NONE_TOKEN}`);
    return;
  }
  for (const item of items) {
    const [firstLine, ...rest] = item.split('\n');
    lines.push(`- ${firstLine}`);
    for (const line of rest) lines.push(`  ${line}`);
  }
}

function renderPhaseListEntry(phase: ParsedPhase, targetId: string): string {
  if (phase.id === targetId) {
    return `- **${phase.id} ${PLAN_PHASE_SEPARATOR} ${phase.title}** (selected phase)`;
  }
  return `- ${phase.id} ${PLAN_PHASE_SEPARATOR} ${phase.title}`;
}

function appendPhaseList(lines: string[], plan: ParsedPlan, targetId: string): void {
  for (const phase of plan.phases) lines.push(renderPhaseListEntry(phase, targetId));
}

function appendPhaseBlock(lines: string[], target: ParsedPhase): void {
  lines.push(planPhaseHeading(target.id, target.title), '');

  if (target.dependsOn.length > 0) {
    lines.push(planPhaseSectionHeading('dependsOn'));
    appendBullets(lines, target.dependsOn);
    lines.push('');
  }

  lines.push(planPhaseSectionHeading('requirements'));
  appendBullets(lines, target.requirements);
  lines.push('');

  lines.push(planPhaseSectionHeading('constraints'));
  appendBullets(lines, target.constraints);
  lines.push('');

  lines.push(planPhaseSectionHeading('acceptance'));
  appendBullets(lines, target.acceptance);
}

export function renderPlanPhase(plan: ParsedPlan, phaseId: string): string | null {
  const target = plan.phases.find((phase) => phase.id === phaseId);
  if (!target) return null;

  const lines: string[] = [];
  lines.push(`${PLAN_HEADINGS.title}${plan.title}`, '');

  lines.push(planSectionHeading('requirements'));
  appendBullets(lines, plan.requirements);
  lines.push('', planSectionHeading('constraints'));
  appendBullets(lines, plan.constraints);
  lines.push('', planSectionHeading('phases'));
  appendPhaseList(lines, plan, target.id);
  lines.push('', planSectionHeading('phaseDetails'), '');

  appendPhaseBlock(lines, target);
  return lines.join('\n');
}
