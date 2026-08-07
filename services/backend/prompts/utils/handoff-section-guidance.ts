/**
 * Shared guidance for handoff template headers — report templates require
 * every section; per-section HTML comments disclose when Not Applicable applies.
 */

/** Exact text agents must write when a handoff section has no content. */
export const HANDOFF_NOT_APPLICABLE_EXACT_TEXT = 'Not Applicable.';

/**
 * HTML comment for sections that may be N/A.
 * Agents must write exactly HANDOFF_NOT_APPLICABLE_EXACT_TEXT with no explanation.
 */
export function getHandoffNotApplicableSectionComment(context: string): string {
  return `<!-- REQUIRED. ${context}, or write exactly "${HANDOFF_NOT_APPLICABLE_EXACT_TEXT}" with no explanation. Do not omit this section. -->`;
}

/** Header line for report-style templates (planner/solo → user, builder → planner). */
export function getHandoffReportTemplateIntro(templateLabel: string): string {
  return `**${templateLabel}** — complete every section below. Do not omit sections, principles, or XML wrappers:

When a section has no content, write exactly \`${HANDOFF_NOT_APPLICABLE_EXACT_TEXT}\` — no explanation, no em-dash, no additional text.`;
}

/** Header line for delegation brief (planner → builder). */
export function getDelegationBriefIntro(): string {
  return `**Delegation Brief (Planner → Builder)** — paste into the handoff message. Include every field that applies. **Omit fields that do not apply** — do not write \`Not Applicable\` as filler.`;
}
