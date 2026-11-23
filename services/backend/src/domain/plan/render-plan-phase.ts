/**
 * Render Plan Phase
 *
 * Pure renderer that projects one phase of a parsed plan back to markdown for
 * `plan read --phase` (CLI slice). It reuses the same template tokens as the
 * parser so rendered output round-trips through `parsePlan`.
 *
 * Constraints:
 * - Pure: no I/O, no Convex types.
 * - Omits `#### Depends on` when the phase has no dependencies.
 * - Empty lists render as a single `- None.` bullet.
 * - Multi-line items keep their continuation lines indented by two spaces.
 */

import type { ParsedPlan } from './parse-plan';
import { PLAN_NONE_TOKEN } from './plan-template-spec';

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

export function renderPlanPhase(plan: ParsedPlan, phaseId: string): string | null {
  const target = plan.phases.find((phase) => phase.id === phaseId);
  if (!target) return null;

  const lines: string[] = [];

  lines.push(`# ${plan.title}`);
  lines.push('');

  lines.push('## Requirements');
  appendBullets(lines, plan.requirements);
  lines.push('');

  lines.push('## Constraints');
  appendBullets(lines, plan.constraints);
  lines.push('');

  lines.push('## Phases');
  for (const phase of plan.phases) {
    if (phase.id === target.id) {
      lines.push(`- **${phase.id} — ${phase.title}** (selected phase)`);
    } else {
      lines.push(`- ${phase.id} — ${phase.title}`);
    }
  }
  lines.push('');

  lines.push('## Phase details');
  lines.push('');

  lines.push(`### ${target.id} — ${target.title}`);
  lines.push('');

  if (target.dependsOn.length > 0) {
    lines.push('#### Depends on');
    appendBullets(lines, target.dependsOn);
    lines.push('');
  }

  lines.push('#### Requirements');
  appendBullets(lines, target.requirements);
  lines.push('');

  lines.push('#### Constraints');
  appendBullets(lines, target.constraints);
  lines.push('');

  lines.push('#### Acceptance criteria');
  appendBullets(lines, target.acceptance);

  return lines.join('\n');
}
