/**
 * Shared guidance for handoff template headers — sections that don't apply
 * should be omitted rather than filled with "Not Applicable" filler.
 */

/** Header line for report-style templates (planner/solo → user, builder → planner). */
export function getHandoffReportTemplateIntro(templateLabel: string): string {
  return `**${templateLabel}** — include every section that applies to this handoff. **Omit sections that do not apply** — do not write \`Not Applicable\` as filler:`;
}

/** Header line for delegation brief (planner → builder). */
export function getDelegationBriefIntro(): string {
  return `**Delegation Brief (Planner → Builder)** — paste into the handoff message. Include every field that applies. **Omit fields that do not apply** — do not write \`Not Applicable\` as filler.`;
}
