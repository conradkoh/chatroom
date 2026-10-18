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

/**
 * Title line naming the addressed `(sender → recipient)` pair.
 *
 * Single source for the line every rendered handoff template carries directly
 * under its recipient callout: the pair resolver composes it, so the getters
 * return body text only and never repeat the pair in prose.
 */
export function getHandoffTemplateTitleLine(pair: { fromRole: string; toRole: string }): string {
  return `Handoff template \`${pair.fromRole}\` → \`${pair.toRole}\` (copy only the body sections below; do not copy this line, the notice, or the instructions after the body):`;
}

/** Header line for report-style templates (planner/solo → user, builder → planner). */
export function getHandoffReportTemplateIntro(): string {
  return `Instructions (not part of the message): complete every section below. Do not omit sections, principles, or XML wrappers.

When a section has no content, write exactly \`${HANDOFF_NOT_APPLICABLE_EXACT_TEXT}\` — no explanation, no em-dash, no additional text.`;
}

/** Header line for the delegation brief; the resolver's title line names the pair. */
export function getDelegationBriefIntro(): string {
  return `**Delegation Brief** — paste into the handoff message. Include every field that applies. **Omit fields that do not apply** — do not write \`Not Applicable\` as filler.`;
}
