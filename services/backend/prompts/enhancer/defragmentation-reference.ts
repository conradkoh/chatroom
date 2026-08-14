/** Canonical workflow for reviewing large or multi-surface revisions. */
export function renderDefragmentationHandoffReference(): string {
  return [
    '### Defragmentation workflow checklist',
    'Complete the optional **Defragmentation** section when the planner check-in addresses a large or multi-surface system revision, including refactoring, consolidation, or consistency work. Write exactly "Not Applicable." only when no such revision is proposed.',
    '',
    '1. **Study surfaces** — map all call sites, use cases, and complexity variants before proposing slices; name every relevant file/module',
    '2. **Golden implementation** — build a standalone canonical solution first; introduce canonical domain entities/types only when the studied variants require them, then shared use cases, UI components, or utilities; do not patch duplicates in place',
    '3. **Migrate callers** — refactor all consumers to the golden path; each slice must be shippable end-to-end',
    '4. **Delete legacy** — remove old implementations only after migration is complete; no dead-code leftovers',
    '',
    '### Anti-patterns to flag',
    '- Incremental copy-paste fixes across N files without a golden SSOT',
    '- New abstraction without studying all existing variants',
    '- Leaving old code "for safety" after migration',
    '- Slices that add helpers/infra without a runnable end-to-end outcome',
    '- Parallel implementations coexisting without a deletion plan',
    '',
    '### Structural decisions',
    '- Identify SSOT locations for domain entities, shared use cases, and UI components',
    '- Align with `structural-decisions` glossary: folder structure, file naming, interface locations',
    '- Flag when the plan scatters the canonical implementation across unrelated modules',
  ].join('\n');
}

export function getDefragmentationReviewTriggerDescription(): string {
  return 'when the planner check-in addresses a large or multi-surface system revision, including refactoring, consolidation, or consistency improvements';
}
