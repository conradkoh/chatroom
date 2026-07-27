/**
 * Shared guidance for handoff template headers — report templates require
 * every section; per-section HTML comments disclose when Not Applicable applies.
 */

/** Header line for report-style templates (planner/solo → user, builder → planner). */
export function getHandoffReportTemplateIntro(templateLabel: string): string {
  return `**${templateLabel}** — complete every section below. Do not omit sections, principles, or XML wrappers:`;
}

/** Header line for delegation brief (planner → builder). */
export function getDelegationBriefIntro(): string {
  return `**Delegation Brief (Planner → Builder)** — paste into the handoff message. Include every field that applies. **Omit fields that do not apply** — do not write \`Not Applicable\` as filler.`;
}
